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

            // Set Rule
            const ruleType = task.ruleType || 'change';
            document.getElementById('taskRuleType').value = ruleType;
            document.getElementById('taskRuleValue').value = task.ruleValue || '';
            document.getElementById('taskRuleValue').style.display = (ruleType === 'change' || ruleType === 'always') ? 'none' : 'block';

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
        const method = document.querySelector('input[name="method"]:checked').value;
        const browserNotify = document.getElementById('taskBrowserNotify').checked;
        const ruleType = taskRuleType.value;
        const ruleValue = taskRuleValue.value;

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
                    (task.lastValue ? `<div class="task-result" style="display:block">Result: <span class="success">"${task.lastValue.substring(0, 100)}${task.lastValue.length > 100 ? '...' : ''}"</span></div>` : '')
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

                // We don't need to handle response here because storage listener will reload the list
                // with the new result/error when background updates it.
                chrome.runtime.sendMessage({ type: 'CHECK_NOW', taskId: id });
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
