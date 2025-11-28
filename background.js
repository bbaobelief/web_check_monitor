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
                content: `This is a test message.`
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
        const content = await fetchContent(task);

        if (content === 'Element not found' || content === null) {
            // Handle "Element not found" case
            if (task.noMatchMsg) {
                const title = isManual ? `[${task.name}] Manual Check` : `[${task.name}] Element Not Found`;
                await sendNotifications(task, title, task.noMatchMsg);

                // Record as a result with the custom message
                await updateTaskStatus(taskId, task.noMatchMsg, null, false);
                return { success: true, content: task.noMatchMsg };
            } else {
                // Also record error state for standard "Element not found"
                await updateTaskStatus(taskId, null, 'Element not found', false);
                return { success: false, error: 'Element not found' };
            }
        }

        const { shouldNotify, notifyMsg } = evaluateRules(task, content);

        if (shouldNotify || isManual) {
            // Remove newlines from content to keep it on one line
            const cleanContent = content.replace(/[\r\n]+/g, ' ').trim();

            const msg = isManual
                ? `[${task.name}] Manual Check`
                : notifyMsg;

            // Prepare Result content
            let resultContent = cleanContent.substring(0, 100);
            if (shouldNotify && task.matchMsg) {
                resultContent = task.matchMsg.replace('{content}', cleanContent);
            } else if (cleanContent.length > 100) {
                resultContent += '...';
            }

            await sendNotifications(task, msg, resultContent);
        }

        // Update task success
        await updateTaskStatus(taskId, content, null, true);

        return { success: true, content };

    } catch (error) {
        console.error('Check failed', error);
        // Update task with error
        await updateTaskStatus(taskId, null, error.message, false);

        return { success: false, error: error.message };
    }
}

async function updateTaskStatus(taskId, lastValue, lastError, lastMatchStatus) {
    const result = await chrome.storage.local.get(['tasks']);
    const tasks = result.tasks || [];
    const index = tasks.findIndex(t => t.id === taskId);
    if (index !== -1) {
        tasks[index].lastCheck = Date.now();
        if (lastValue !== undefined) tasks[index].lastValue = lastValue;
        tasks[index].lastError = lastError;
        if (lastMatchStatus !== undefined) tasks[index].lastMatchStatus = lastMatchStatus;
        await chrome.storage.local.set({ tasks });
    }
}

async function fetchContent(task) {
    const timeoutMs = (task.timeout || 30) * 1000;

    if (task.method === 'browser') {
        return await fetchViaBrowser(task.url, task.selector, timeoutMs);
    } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(task.url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();

            if (task.method === 'dom') {
                // Use Offscreen API for DOM parsing
                await setupOffscreenDocument('offscreen.html');
                return await chrome.runtime.sendMessage({
                    type: 'PARSE_DOM',
                    target: 'offscreen',
                    html: text,
                    selector: task.selector
                });
            } else {
                // JSON
                const json = JSON.parse(text);
                return JSON.stringify(json);
            }
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }
}

function evaluateRules(task, content) {
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

    return { shouldNotify, notifyMsg };
}

async function sendNotifications(task, title, resultContent) {
    const nowStr = formatDate(Date.now());
    // Browser Notification
    if (task.browserNotify !== false) {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: title,
            message: `Time: ${nowStr}\nResult: ${resultContent}`
        });
    }

    // WeChat Notification
    if (task.webhookUrl) {
        await sendWeChatNotification(task.webhookUrl, {
            msgtype: "text",
            text: {
                content: `${title}\nURL: ${task.url}\nTime: ${nowStr}\nResult: ${resultContent}`
            }
        }).catch(err => console.error('WeChat Notification failed for task:', task.name, err));
    }
}

async function fetchViaBrowser(url, selector, timeoutMs = 30000) {
    return new Promise(async (resolve, reject) => {
        let tabId;
        const timeout = setTimeout(() => {
            if (tabId) chrome.tabs.remove(tabId).catch(() => { });
            reject(new Error('Timeout: Page took too long to load'));
        }, timeoutMs); // 30 seconds timeout

        try {
            // Create a new tab (active: false to try to keep it in background)
            const tab = await chrome.tabs.create({
                url: url,
                active: false
            });

            tabId = tab.id;

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

                            chrome.tabs.remove(tabId).catch(() => { });
                            clearTimeout(timeout);

                            if (results && results[0] && results[0].result) {
                                resolve(results[0].result);
                            } else {
                                resolve('Element not found');
                            }
                        } catch (err) {
                            chrome.tabs.remove(tabId).catch(() => { });
                            clearTimeout(timeout);
                            if (err.message.includes('Frame with ID 0 is showing error page')) {
                                reject(new Error('Page failed to load (Network Error or Invalid URL)'));
                            } else {
                                reject(err);
                            }
                        }
                    }, 3000); // Wait 3 seconds for JS to render
                }
            });
        } catch (e) {
            clearTimeout(timeout);
            if (tabId) chrome.tabs.remove(tabId).catch(() => { });
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
    if (!webhookUrl || !webhookUrl.startsWith('http')) {
        console.error('Invalid Webhook URL:', webhookUrl);
        throw new Error('Invalid Webhook URL');
    }

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            mode: 'cors',
            credentials: 'omit',
            keepalive: true,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Try to read response to ensure it completed
        await response.text();

    } catch (error) {
        console.error('Failed to send WeChat notification:', error);
        // Re-throw to allow caller to handle or log
        throw error;
    }
}

function formatDate(timestamp) {
    if (!timestamp) return 'Never';
    const d = new Date(timestamp);
    const pad = (n) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
