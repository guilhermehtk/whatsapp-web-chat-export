# Privacy Policy — Chat Exporter for WhatsApp Web

**Last updated:** August 2026

This is an independent extension and is not affiliated with WhatsApp or Meta.

## What this extension does

Chat Exporter reads message content from the currently open WhatsApp Web chat tab in your browser and exports it to a file on your device.

## Data collection

**None.** This extension:

- Does **not** send any data to any server
- Does **not** collect analytics, telemetry, or usage statistics
- Does **not** store any data beyond your browser session
- Does **not** access any tab other than the active WhatsApp Web tab

## Data processing

All processing happens locally in your browser:

1. The content script reads the visible DOM of the WhatsApp Web page
2. Messages, senders, and timestamps are extracted in-memory
3. If you choose HTML export, images are fetched from WhatsApp's servers using your existing browser session (the same request your browser would make to display them) and embedded as base64 data in the exported file
4. The exported file is downloaded directly to your device through the browser

## Permissions used

| Permission | Why |
|---|---|
| `activeTab` | Access the currently open WhatsApp Web tab |
| `host_permissions: web.whatsapp.com` | Restrict the extension to WhatsApp Web only |

## Your data

The exported file is yours. It stays on your device. The extension author has no access to it.

## Contact

Questions? Open an issue on the GitHub repository.
