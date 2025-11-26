chrome.runtime.onMessage.addListener(handleMessages);

function handleMessages(message, sender, sendResponse) {
    if (message.type === 'PARSE_DOM') {
        parseDOM(message.html, message.selector, sendResponse);
        return true; // Keep channel open for async response
    }
}

function parseDOM(html, selector, sendResponse) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const element = doc.querySelector(selector);
    const content = element ? element.innerText.trim() : 'Element not found';
    sendResponse(content);
}
