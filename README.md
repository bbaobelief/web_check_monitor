# 网页监控 (Web Check Monitor)

A Chrome extension to monitor web page content changes and send notifications via Browser and WeChat Work.

## Features

- **Monitor Dynamic Content**: Supports monitoring Single Page Applications (SPAs) using a background browser tab.
- **Custom Selectors**: Use CSS selectors to target specific elements on a page.
- **Flexible Notifications**:
  - Browser Notifications (Toggleable per task)
  - WeChat Work Webhook Integration
- **Notification Rules**:
  - Notify on Change (Default)
  - Always Notify
  - Conditional Rules (Contains, Regex, Numeric Comparison)
- **Scheduled Checks**: Configure check intervals in minutes.
- **Manual Check**: Instantly verify content and test notifications.

## Installation

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable "Developer mode" in the top right corner.
4. Click "Load unpacked" and select the extension directory.

## Usage

1. Click the extension icon to open the popup.
2. Click the "+" button to add a new task.
3. Enter the Task Name, URL, and CSS Selector.
4. (Optional) Configure WeChat Work Webhook URL.
5. Select the Check Method (DOM Text is recommended).
6. Configure Notification Rules and Interval.
7. Click "Save".

## Development

- `manifest.json`: Extension configuration (Manifest V3).
- `background.js`: Service worker handling alarms, checks, and notifications.
- `popup.html` / `popup.js`: UI for managing tasks.
- `offscreen.html` / `offscreen.js`: Helper for DOM parsing (legacy support).

## License

MIT
