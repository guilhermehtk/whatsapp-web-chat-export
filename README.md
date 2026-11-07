# Chat Exporter for WhatsApp Web

A Chrome extension that exports WhatsApp Web conversations to **JSON**, **plain text**, or **self-contained HTML** (with embedded images).

> Independent extension. Not affiliated with WhatsApp or Meta. WhatsApp is a trademark of its respective owner.

## Features

- Export any open WhatsApp Web chat to JSON, plain text, or HTML
- **"Scroll all + export"** — auto-scrolls the full chat history (handles virtual scrolling)
- Captures emoji reactions (👍 ❤️ etc.) placed on messages
- Renders emoji correctly in HTML exports on all platforms
- Embeds photos inline in HTML — fully viewable offline, no internet needed
- Self-contained HTML styled like WhatsApp's dark theme
- Date format auto-detected from your browser locale — sorts correctly everywhere
- All processing is local — no data ever leaves your browser
- Works with individual chats and group chats

## Installation

### From Chrome Web Store

*(Coming soon)*

### Developer Mode (manual)

1. Download or clone this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select this folder

## Usage

1. Open [WhatsApp Web](https://web.whatsapp.com) and click on a chat
2. Click the extension icon in the toolbar
3. Choose a format: **JSON**, **Plain text**, or **HTML**
4. **Export visible messages** — exports whatever is currently loaded in the DOM
5. **Scroll all + export** — scrolls the entire chat history from bottom to top, then exports everything

> **Tip:** Use "Scroll all + export" for complete history. It takes longer but captures everything.

### Export several chats

1. Open WhatsApp Web (a chat does not need to be open) and click the extension icon
2. Expand **Export several chats** and click **Load chat list**. The extension scrolls the sidebar to read every chat name
3. Filter by name, tick the chats you want (or **Select all shown**), pick a format
4. Click **Export selected**. Each chat is opened in turn, scrolled to the top, and saved as its own file, with a 2 to 4 second pause between chats
5. **Stop** ends the run after the current chat. You can close the popup; the export keeps running, and reopening the popup shows its progress

Chrome may ask once to allow multiple downloads from web.whatsapp.com.

## Export Formats

### JSON
```json
{
  "conversation": "John Doe",
  "exported_at": "2026-04-14T12:00:00.000Z",
  "total": 142,
  "messages": [
    {
      "sender": "John Doe",
      "timestamp": "14:30, 14/04/2026",
      "text": "Hey! How's it going?",
      "images": [],
      "reactions": "👍"
    }
  ]
}
```

### Plain text
```
[14:30, 14/04/2026] John Doe: Hey! How's it going?  [👍]

[14:31, 14/04/2026] You: Great, thanks!
```

### HTML
A self-contained `.html` file styled like WhatsApp's dark theme. Photos are embedded as base64 — no internet connection required to view it. Emoji and reactions render correctly on Windows, Mac, and Linux.

## Notes & Limitations

- **Virtual scrolling:** WhatsApp Web only keeps a window of messages in the DOM at any time. "Scroll all + export" handles this by scrolling incrementally and collecting messages at each step.
- **WhatsApp DOM changes:** Uses `data-pre-plain-text` attributes which have been stable for years, but WhatsApp occasionally updates its DOM. Open an issue if something breaks.
- **Images:** The HTML export fetches images through your active WhatsApp session — no re-authentication needed. Only images already loaded in the browser are embedded.
- **Reactions:** Captured when visible in the DOM. May not appear for very old messages that were never scrolled into view.
- **Several chats:** Chats are found by their sidebar name, so two chats with the same name resolve to the first one in the list.

## Privacy

See [PRIVACY.md](PRIVACY.md). Short version: everything stays on your device.

## License

MIT
