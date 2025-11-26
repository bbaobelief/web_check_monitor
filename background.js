chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name.startsWith('task-')) {
        const taskId = alarm.name.replace('task-', '');
        await checkTask(taskId);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TASK_UPDATED') {
        const task = message.task;
        chrome.alarms.create(`task-${task.id}`, {
            periodInMinutes: task.interval
        });
        // Removed immediate check as per user request
    } else if (message.type === 'TASK_DELETED') {
        chrome.alarms.clear(`task-${message.taskId}`);
    } else if (message.type === 'CHECK_NOW') {
        checkTask(message.taskId, true).then(sendResponse);
        return true; // Keep channel open
    } else if (message.type === 'TEST_NOTIFICATION') {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: 'Test Notification',
            message: 'This is a test notification from Web Check Monitor.'
        });
    } else if (message.type === 'TEST_CONNECTION') {
        testConnection(message.url, message.selector, message.method).then(sendResponse);
        return true; // Keep channel open
    } else if (message.type === 'TEST_WEBHOOK') {
        sendWeChatNotification(message.webhookUrl, {
            msgtype: "text",
            text: {
                content: `[网页监控] This is a test message.`
            }
        }).then(() => sendResponse({ success: true }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }
});

async function testConnection(url, selector, method) {
    try {
        let content = '';

        if (method === 'browser') {
            content = await fetchViaBrowser(url, selector);
        } else {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();

            if (method === 'dom') {
                await setupOffscreenDocument('offscreen.html');
                content = await chrome.runtime.sendMessage({
                    type: 'PARSE_DOM',
                    target: 'offscreen',
                    html: text,
                    selector: selector
                });
            } else {
                const json = JSON.parse(text);
                content = JSON.stringify(json);
            }
        }

        if (content === 'Element not found' || content === null) {
            return { success: false, error: 'Element not found' };
        }

        return { success: true, content };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function checkTask(taskId, isManual = false) {
    const result = await chrome.storage.local.get(['tasks']);
    const tasks = result.tasks || [];
    const taskIndex = tasks.findIndex(t => t.id === taskId);

    if (taskIndex === -1) return { success: false, error: 'Task not found' };

    const task = tasks[taskIndex];

    try {
        let content = '';

        if (task.method === 'browser') {
            content = await fetchViaBrowser(task.url, task.selector);
        } else {
            const response = await fetch(task.url);
            const text = await response.text();

            if (task.method === 'dom') {
                // Use Offscreen API for DOM parsing
                await setupOffscreenDocument('offscreen.html');
                content = await chrome.runtime.sendMessage({
                    type: 'PARSE_DOM',
                    target: 'offscreen',
                    html: text,
                    selector: task.selector
                });

            } else {
                // JSON
                const json = JSON.parse(text);
                // Simple dot notation access could be implemented here, but for now let's just stringify
                content = JSON.stringify(json);
            }
        }

        const now = Date.now();

        let shouldNotify = false;
        let notifyMsg = '';

        const ruleType = task.ruleType || 'change';
        const ruleValue = task.ruleValue;

        if (ruleType === 'change') {
            if (task.lastValue !== null && task.lastValue !== content) {
                shouldNotify = true;
                notifyMsg = `The content for ${task.name} has changed!`;
            }
        } else if (ruleType === 'always') {
            shouldNotify = true;
            notifyMsg = `Routine Check: ${task.name}`;
        } else {
            // Conditional Rules
            let matched = false;

            if (ruleType === 'contains') {
                matched = content.includes(ruleValue);
            } else if (ruleType === 'not_contains') {
                matched = !content.includes(ruleValue);
            } else if (ruleType === 'regex') {
                try {
                    const regex = new RegExp(ruleValue);
                    matched = regex.test(content);
                } catch (e) {
                    console.error('Invalid Regex', e);
                }
            } else if (ruleType === 'gt') {
                const num = parseFloat(content);
                const target = parseFloat(ruleValue);
                if (!isNaN(num) && !isNaN(target)) {
                    matched = num > target;
                }
            } else if (ruleType === 'lt') {
                const num = parseFloat(content);
                const target = parseFloat(ruleValue);
                if (!isNaN(num) && !isNaN(target)) {
                    matched = num < target;
                }
            }

            if (matched) {
                shouldNotify = true;
                notifyMsg = `Rule Matched: ${task.name} (${ruleType} ${ruleValue})`;
            }
        }

        if (shouldNotify || isManual) {
            // Remove newlines from content to keep it on one line
            const cleanContent = content.replace(/[\r\n]+/g, ' ').trim();

            const msg = shouldNotify
                ? notifyMsg
                : `${task.name}: ${cleanContent.substring(0, 100)}`;

            // Default to true if undefined for backward compatibility
            if (task.browserNotify !== false) {
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon48.png',
                    title: 'Web Monitor Alert',
                    message: msg
                });
            }

            if (task.webhookUrl) {
                const nowStr = formatDate(now);
                sendWeChatNotification(task.webhookUrl, {
                    msgtype: "text",
                    text: {
                        content: `[网页监控] ${msg}\nURL: ${task.url}\nTime: ${nowStr}\nResult: ${cleanContent.substring(0, 100)}...`
                    }
                });
            }
        }

        // Update task
        tasks[taskIndex].lastCheck = now;
        tasks[taskIndex].lastValue = content;
        tasks[taskIndex].lastError = null; // Clear error
        await chrome.storage.local.set({ tasks });

        return { success: true, content };

    } catch (error) {
        console.error('Check failed', error);
        // Update task with error
        tasks[taskIndex].lastCheck = Date.now();
        tasks[taskIndex].lastError = error.message;
        await chrome.storage.local.set({ tasks });

        return { success: false, error: error.message };
    }
}

async function fetchViaBrowser(url, selector) {
    return new Promise(async (resolve, reject) => {
        try {
            // Create a new tab (active: false to try to keep it in background)
            const tab = await chrome.tabs.create({
                url: url,
                active: false
            });

            const tabId = tab.id;

            // Wait for page load
            chrome.tabs.onUpdated.addListener(function listener(tid, changeInfo, tab) {
                if (tid === tabId && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);

                    // Inject script to extract content
                    // We need a slight delay for JS frameworks to render
                    setTimeout(async () => {
                        try {
                            const results = await chrome.scripting.executeScript({
                                target: { tabId: tabId },
                                func: (sel) => {
                                    const el = document.querySelector(sel);
                                    return el ? el.innerText.trim() : null;
                                },
                                args: [selector]
                            });

                            chrome.tabs.remove(tabId);

                            if (results && results[0] && results[0].result) {
                                resolve(results[0].result);
                            } else {
                                resolve('Element not found');
                            }
                        } catch (err) {
                            chrome.tabs.remove(tabId);
                            reject(err);
                        }
                    }, 3000); // Wait 3 seconds for JS to render
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}

let creating; // A global promise to avoid concurrency issues
async function setupOffscreenDocument(path) {
    // Check all windows controlled by the service worker to see if one 
    // of them is the offscreen document with the given path
    const offscreenUrl = chrome.runtime.getURL(path);
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
    });

    if (existingContexts.length > 0) {
        return;
    }

    // create offscreen document
    if (creating) {
        await creating;
    } else {
        creating = chrome.offscreen.createDocument({
            url: path,
            reasons: ['DOM_PARSER'],
            justification: 'Parse DOM to extract content for monitoring',
        });
        await creating;
        creating = null;
    }
}

async function sendWeChatNotification(webhookUrl, data) {
    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
    } catch (error) {
        console.error('Failed to send WeChat notification', error);
    }
}

function formatDate(timestamp) {
    if (!timestamp) return 'Never';
    const d = new Date(timestamp);
    const pad = (n) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
