document.addEventListener('DOMContentLoaded', () => {
    const taskList = document.getElementById('taskList');
    const addTaskView = document.getElementById('addTaskView');
    const addTaskBtn = document.getElementById('addTaskBtn');
    const cancelAddBtn = document.getElementById('cancelAddBtn');
    const saveTaskBtn = document.getElementById('saveTaskBtn');
    const addTaskForm = document.getElementById('addTaskForm');
    const testNotifyBtn = document.getElementById('testNotifyBtn');
    const testConnectionBtn = document.getElementById('testConnectionBtn');
    const testWebhookBtn = document.getElementById('testWebhookBtn');
    const testResult = document.getElementById('testResult');

    let editingTaskId = null;

    // Test Notification
    testNotifyBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'TEST_NOTIFICATION' });
    });

    // Test Webhook
    testWebhookBtn.addEventListener('click', async () => {
        const webhookUrl = document.getElementById('taskWebhook').value;
        const resultEl = document.getElementById('webhookTestResult');

        if (!webhookUrl) {
            resultEl.style.display = 'block';
            resultEl.className = 'error';
            resultEl.style.color = '#c5221f';
            resultEl.textContent = 'Please enter a Webhook URL first';
            return;
        }

        testWebhookBtn.textContent = 'Sending...';
        testWebhookBtn.disabled = true;
        resultEl.style.display = 'none';

        try {
            const response = await chrome.runtime.sendMessage({ type: 'CHECK_NOW', taskId: editingTaskId }); // Assuming editingTaskId is the current task's ID
            resultEl.style.display = 'block';
            if (response && response.success) {
                resultEl.innerHTML = `Result: <span class="success">"${response.content.substring(0, 100)}${response.content.length > 100 ? '...' : ''}"</span>`;
            } else {
                resultEl.innerHTML = `Error: <span class="error">${response ? response.error : 'Unknown error'}</span>`;
            }
        } catch (err) {
            resultEl.style.display = 'block';
            resultEl.innerHTML = `Error: <span class="error">Error communicating with background script</span>`;
        } finally {
            testWebhookBtn.textContent = 'Test';
            testWebhookBtn.disabled = false;
        }
    });

    // Test Connection
    testConnectionBtn.addEventListener('click', async () => {
        const url = document.getElementById('taskUrl').value;
        const selector = document.getElementById('taskSelector').value;
        const method = document.querySelector('input[name="method"]:checked').value;

        if (!url || !selector) {
            testResult.style.display = 'block';
            testResult.style.color = 'red';
            testResult.textContent = 'Please enter URL and Selector first.';
            return;
        }

        testResult.style.display = 'block';
        testResult.style.color = 'blue';
        testResult.textContent = 'Testing...';
        testConnectionBtn.disabled = true;

        try {
            const response = await chrome.runtime.sendMessage({
                type: 'TEST_CONNECTION',
                url,
                selector,
                method
            });

            if (response.success) {
                testResult.style.color = 'green';
                testResult.textContent = `Success! Found: "${response.content.substring(0, 50)}${response.content.length > 50 ? '...' : ''}"`;
            } else {
                testResult.style.color = 'red';
                testResult.textContent = `Error: ${response.error}`;
            }
        } catch (e) {
            testResult.style.color = 'red';
            testResult.textContent = 'Error: Could not communicate with background script.';
        } finally {
            testConnectionBtn.disabled = false;
        }
    });

    // Export Configuration
    const exportBtn = document.getElementById('exportBtn');
    exportBtn.addEventListener('click', async () => {
        const result = await chrome.storage.local.get(['tasks']);
        const tasks = result.tasks || [];
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tasks, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "web_monitor_config.json");
        document.body.appendChild(downloadAnchorNode); // required for firefox
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    });

    // Import Configuration
    const importBtn = document.getElementById('importBtn');
    const importFile = document.getElementById('importFile');

    importBtn.addEventListener('click', () => {
        importFile.click();
    });

    importFile.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const importedTasks = JSON.parse(e.target.result);
                if (!Array.isArray(importedTasks)) {
                    alert('Invalid configuration file format.');
                    return;
                }

                const result = await chrome.storage.local.get(['tasks']);
                let currentTasks = result.tasks || [];
                let addedCount = 0;

                for (const task of importedTasks) {
                    // Basic validation
                    if (!task.name || !task.url || !task.selector) continue;

                    // Generate new ID to avoid conflicts
                    const newTask = {
                        ...task,
                        id: (Date.now() + Math.random()).toString().replace('.', ''),
                        lastCheck: null,
                        lastValue: null,
                        lastError: null
                    };

                    currentTasks.push(newTask);
                    // Notify background to schedule
                    chrome.runtime.sendMessage({ type: 'TASK_UPDATED', task: newTask });
                    addedCount++;
                }

                await chrome.storage.local.set({ tasks: currentTasks });
                alert(`Successfully imported ${addedCount} tasks.`);
                loadTasks();

            } catch (err) {
                console.error('Import failed', err);
                alert('Failed to import configuration: ' + err.message);
            }
            // Reset input
            importFile.value = '';
        };
        reader.readAsText(file);
    });

    // Navigation
    addTaskBtn.addEventListener('click', () => {
        openTaskForm();
    });

    cancelAddBtn.addEventListener('click', () => {
        showTaskList();
    });

    function openTaskForm(task = null) {
        taskList.classList.remove('active');
        taskList.classList.add('hidden');
        addTaskView.classList.remove('hidden');
        addTaskView.classList.add('active');
        addTaskBtn.style.display = 'none';

        const title = addTaskView.querySelector('h2');
        if (task) {
            title.textContent = 'Edit Task';
            document.getElementById('taskName').value = task.name;
            document.getElementById('taskUrl').value = task.url;
            document.getElementById('taskSelector').value = task.selector;
            document.getElementById('taskWebhook').value = task.webhookUrl || '';
            document.getElementById('taskBrowserNotify').checked = task.browserNotify !== false; // Default to true
            document.getElementById('taskInterval').value = task.interval;
            document.getElementById('taskTimeout').value = task.timeout || 30;

            // Set Rule
            const ruleType = task.ruleType || 'change';
            document.getElementById('taskRuleType').value = ruleType;
            document.getElementById('taskRuleValue').value = task.ruleValue || '';
            document.getElementById('taskRuleValue').style.display = (ruleType === 'change' || ruleType === 'always') ? 'none' : 'block';

            document.getElementById('taskMatchMsg').value = task.matchMsg || '';
            document.getElementById('taskNoMatchMsg').value = task.noMatchMsg || '';

            // Handle radio button if needed, assuming default DOM for now or check value
            editingTaskId = task.id;
        } else {
            title.textContent = 'Add Task';
            addTaskForm.reset();
            editingTaskId = null;
        }
    }

    function showTaskList() {
        addTaskView.classList.remove('active');
        addTaskView.classList.add('hidden');
        taskList.classList.remove('hidden');
        taskList.classList.add('active');
        addTaskBtn.style.display = 'block';
        editingTaskId = null;
        loadTasks();
    }

    const taskRuleType = document.getElementById('taskRuleType');
    const taskRuleValue = document.getElementById('taskRuleValue');

    // Toggle rule value input visibility
    taskRuleType.addEventListener('change', () => {
        if (taskRuleType.value === 'change' || taskRuleType.value === 'always') {
            taskRuleValue.style.display = 'none';
        } else {
            taskRuleValue.style.display = 'block';
        }
    });

    // Save Task
    saveTaskBtn.addEventListener('click', async () => {
        const name = document.getElementById('taskName').value;
        const url = document.getElementById('taskUrl').value;
        const selector = document.getElementById('taskSelector').value;
        const webhookUrl = document.getElementById('taskWebhook').value;
        const interval = parseInt(document.getElementById('taskInterval').value);
        const timeout = parseInt(document.getElementById('taskTimeout').value) || 30;
        const method = document.querySelector('input[name="method"]:checked').value;
        const browserNotify = document.getElementById('taskBrowserNotify').checked;
        const ruleType = taskRuleType.value;
        const ruleValue = taskRuleValue.value;
        const matchMsg = document.getElementById('taskMatchMsg').value;
        const noMatchMsg = document.getElementById('taskNoMatchMsg').value;

        if (!name || !url || !selector || !interval) {
            alert('Please fill in all fields');
            return;
        }

        if (ruleType !== 'change' && ruleType !== 'always' && !ruleValue) {
            alert('Please enter a value for the notification rule');
            return;
        }

        const taskData = {
            name,
            url,
            selector,
            webhookUrl,
            interval,
            method,
            browserNotify,
            ruleType,
            ruleValue,
            matchMsg,
            noMatchMsg,
            timeout,
            status: 'active'
        };

        await saveTask(taskData);
        addTaskForm.reset();
        showTaskList();
    });

    async function saveTask(taskData) {
        const result = await chrome.storage.local.get(['tasks']);
        let tasks = result.tasks || [];

        if (editingTaskId) {
            // Update existing
            const index = tasks.findIndex(t => t.id === editingTaskId);
            if (index !== -1) {
                tasks[index] = { ...tasks[index], ...taskData };
                // Notify background to reschedule
                chrome.runtime.sendMessage({ type: 'TASK_UPDATED', task: tasks[index] });
            }
        } else {
            // Create new
            const newTask = {
                id: Date.now().toString(),
                ...taskData,
                lastCheck: null,
                lastValue: null
            };
            tasks.push(newTask);
            chrome.runtime.sendMessage({ type: 'TASK_UPDATED', task: newTask });
        }

        await chrome.storage.local.set({ tasks });
    }

    // Load Tasks
    async function loadTasks() {
        const result = await chrome.storage.local.get(['tasks']);
        const tasks = result.tasks || [];

        const container = document.getElementById('taskList');
        container.innerHTML = '';

        if (tasks.length === 0) {
            container.innerHTML = '<div class="empty-state">No tasks yet. Click + to add one.</div>';
            return;
        }

        tasks.forEach(task => {
            const el = document.createElement('div');
            el.className = 'task-item';
            el.innerHTML = `
                <div class="task-header">
                    <span class="task-name">${task.name}</span>
                    <span class="task-meta">${task.interval}m</span>
                </div>
                <div class="task-meta">
                    URL: ${new URL(task.url).hostname}
                </div>
                <div class="task-meta">
                    Time: ${formatDate(task.lastCheck)}
                </div>
                ${task.lastError ?
                    `<div class="task-result" style="display:block">Error: <span class="error">${task.lastError}</span></div>` :
                    (task.lastValue ? `<div class="task-result" style="display:block">Result: <span class="${task.lastMatchStatus === false ? 'error' : 'success'}">"${task.lastValue.substring(0, 100)}${task.lastValue.length > 100 ? '...' : ''}"</span></div>` : '')
                }
                 <div class="task-actions">
                    <button class="action-btn edit-btn" data-id="${task.id}">Edit</button>
                    <button class="action-btn delete-btn" data-id="${task.id}">Delete</button>
                    <button class="action-btn check-btn" data-id="${task.id}">Check</button>
                </div>
            `;
            container.appendChild(el);
        });

        // Add event listeners for buttons
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.dataset.id;
                const result = await chrome.storage.local.get(['tasks']);
                const task = result.tasks.find(t => t.id === id);
                if (task) {
                    openTaskForm(task);
                }
            });
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.dataset.id;
                await deleteTask(id);
                loadTasks();
            });
        });

        document.querySelectorAll('.check-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.dataset.id;
                const btnEl = e.target;
                btnEl.textContent = 'Checking...';
                btnEl.disabled = true;

                try {
                    const response = await chrome.runtime.sendMessage({ type: 'CHECK_NOW', taskId: id });
                    if (!response || !response.success) {
                        // If failed, we might want to revert button or show error
                        // But usually storage change will handle it. 
                        // If storage change didn't happen (e.g. background error), we revert here.
                        console.warn('Check failed:', response ? response.error : 'Unknown error');
                        // Optional: alert(response.error);
                        // We rely on loadTasks to update UI, but if it doesn't, we should reset button
                        // However, if we reset button here, it might flicker if loadTasks is about to run.
                        // Let's just catch the case where sendMessage fails entirely.
                    }
                } catch (err) {
                    console.error('Communication error:', err);
                    alert('Failed to communicate with background script.');
                    btnEl.textContent = 'Check';
                    btnEl.disabled = false;
                }
            });
        });
    }

    // Listen for storage changes to update UI
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.tasks) {
            loadTasks();
        }
    });

    async function deleteTask(id) {
        const result = await chrome.storage.local.get(['tasks']);
        let tasks = result.tasks || [];
        tasks = tasks.filter(t => t.id !== id);
        await chrome.storage.local.set({ tasks });
        chrome.runtime.sendMessage({ type: 'TASK_DELETED', taskId: id });
    }

    // Initial load
    loadTasks();
    function formatDate(timestamp) {
        if (!timestamp) return 'Never';
        const d = new Date(timestamp);
        const pad = (n) => n.toString().padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
});
