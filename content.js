'use strict';

// ─── Selector constants ────────────────────────────────────────────────────
// NOTE: WhatsApp Web uses obfuscated CSS class names that can change with
// deployments. Selectors below use data-attributes and roles where possible.
// If something stops working, open DevTools on web.whatsapp.com and verify.

const MAIN_PANEL        = '#main';                          // right-side chat panel
const CHAT_TITLE_SEL    = '#main header span[dir="auto"]';  // contact/group name
// Messages have a data-pre-plain-text attr: "[HH:MM, DD/MM/YYYY] Sender: "
const MESSAGE_ATTR      = 'data-pre-plain-text';
// Text content inside a message bubble
const TEXT_SEL          = `span[dir="ltr"], span[dir="rtl"]`;
// Images sent/received in chat
const IMAGE_SEL         = 'img[src]';
// System messages (e.g. "John joined") — usually in a div with role="row" but no data-pre-plain-text
const SYSTEM_MSG_SEL    = 'div[role="row"] span[dir="ltr"]';
// Left sidebar with the chat list (virtualized: only visible rows are in the DOM)
const SIDEBAR_SEL       = '#pane-side';
const CHAT_ROW_SEL      = '[role="listitem"], [role="row"]';

// ─── State ─────────────────────────────────────────────────────────────────
let isScrolling = false;
// Progress of a multi-chat export, kept here so a reopened popup can show it
let batch = null;

// ─── Utilities ─────────────────────────────────────────────────────────────

/**
 * Get the chat title from the header.
 */
function getChatName() {
  const el = document.querySelector(CHAT_TITLE_SEL);
  return el ? el.textContent.trim() : 'WhatsApp Chat';
}

/**
 * Find the scrollable message container inside #main.
 * Anchors from an actual message element and walks UP to its scrollable ancestor,
 * which is more reliable than walking down (avoids picking up header/toolbar scrollables).
 */
function findScrollContainer() {
  // Prefer walking UP from a message element — that guarantees we find the right container
  const msg = document.querySelector(`[${MESSAGE_ATTR}]`);
  if (msg) {
    let el = msg.parentElement;
    while (el && el.id !== 'main' && el !== document.body) {
      const style = window.getComputedStyle(el);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 50) {
        return el;
      }
      el = el.parentElement;
    }
  }

  // Fallback: walk down from #main and pick the first scrollable child
  const main = document.querySelector(MAIN_PANEL);
  if (!main) return null;
  const all = main.querySelectorAll('*');
  for (const el of all) {
    const style = window.getComputedStyle(el);
    const overflow = style.overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight + 50) {
      return el;
    }
  }
  return main;
}

/**
 * Parse the data-pre-plain-text attribute into { timestamp, sender }.
 * Format examples:
 *   "[14:30, 14/04/2026] John Doe: "
 *   "[2:30 PM, 4/14/2026] Jane: "
 *   "[9:05 AM, 4/14/2026] You: "
 */
function parseMetaAttr(raw) {
  if (!raw) return { timestamp: null, sender: null };
  // Capture everything inside brackets as timestamp, rest as sender
  const m = raw.match(/^\[([^\]]+)\]\s*(.+?):\s*$/);
  if (!m) return { timestamp: null, sender: null };
  return { timestamp: m[1].trim(), sender: m[2].trim() };
}

/**
 * Detect whether the browser locale formats dates as M/D/YYYY or D/M/YYYY.
 * Formats January 14 (day 14 > 12, so unambiguous) and checks which number
 * appears first. Result is cached after the first call.
 */
let _dateOrder = null;
function getDateOrder() {
  if (_dateOrder) return _dateOrder;
  try {
    const probe = new Date(2026, 0, 14); // Jan 14 — day(14) > 12, unambiguous
    const str = new Intl.DateTimeFormat(navigator.language, {
      month: 'numeric', day: 'numeric', year: 'numeric',
    }).format(probe);
    const first = parseInt(str.split(/[\/\-\.]/)[0], 10);
    _dateOrder = (first === 1) ? 'MDY' : 'DMY';
  } catch {
    _dateOrder = 'MDY'; // safe default
  }
  return _dateOrder;
}

/**
 * Parse WhatsApp timestamp string into a sortable number.
 * Handles:
 *   "14:30, 14/04/2026"   → DD/MM/YYYY HH:MM (24h)
 *   "2:30 PM, 4/14/2026"  → M/D/YYYY H:MM AM/PM
 * Ambiguous dates (both parts ≤ 12) are resolved using the browser locale.
 */
function parseTimestamp(ts) {
  if (!ts) return 0;
  try {
    // Split on ", " to get time and date parts
    const commaIdx = ts.indexOf(',');
    if (commaIdx === -1) return 0;
    const timePart = ts.slice(0, commaIdx).trim();
    const datePart = ts.slice(commaIdx + 1).trim();

    // Try to parse the date
    // Detect format: DD/MM/YYYY vs M/D/YYYY by checking which side > 12
    const datePieces = datePart.split('/').map(Number);
    if (datePieces.length !== 3) return 0;
    let [a, b, year] = datePieces;

    let month, day;
    if (a > 12) {
      // a must be day (DD/MM/YYYY)
      day = a; month = b;
    } else if (b > 12) {
      // b must be day (M/D/YYYY)
      month = a; day = b;
    } else {
      // Ambiguous — detect from browser locale
      if (getDateOrder() === 'MDY') { month = a; day = b; }
      else                          { day = a; month = b; }
    }

    // Parse time
    let hours, minutes;
    const ampmMatch = timePart.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (ampmMatch) {
      hours   = parseInt(ampmMatch[1], 10);
      minutes = parseInt(ampmMatch[2], 10);
      const isPM = ampmMatch[3].toUpperCase() === 'PM';
      if (isPM && hours !== 12) hours += 12;
      if (!isPM && hours === 12) hours = 0;
    } else {
      const hhmm = timePart.match(/^(\d{1,2}):(\d{2})$/);
      if (!hhmm) return 0;
      hours   = parseInt(hhmm[1], 10);
      minutes = parseInt(hhmm[2], 10);
    }

    return new Date(year, month - 1, day, hours, minutes).getTime();
  } catch {
    return 0;
  }
}

/**
 * Test whether an <img> is an actual photo (not an emoji/sticker icon/UI element).
 * Returns true if we consider it a real photo to embed.
 */
function isPhotoMessage(img) {
  const src = img.src || '';
  // Blob URLs are likely actual images sent in chat
  if (src.startsWith('blob:')) return true;
  // WhatsApp CDN images
  if (src.includes('mmg.whatsapp.net') || src.includes('media.whatsapp.com')) return true;
  // Skip tiny icons (emoji, avatars, UI)
  if (img.width > 0 && img.width < 40) return false;
  if (img.height > 0 && img.height < 40) return false;
  // Skip data: URIs that are tiny (avatars etc.)
  if (src.startsWith('data:') && src.length < 500) return false;
  // Skip if alt text is an emoji character
  const alt = img.alt || '';
  if (alt.length > 0 && alt.length <= 2 && /\p{Emoji}/u.test(alt)) return false;
  return false; // conservative: only accept the explicit patterns above
}

/**
 * Extract text from a message element, including emoji rendered as <img alt="😊">.
 */
function getMessageText(el) {
  const parts = [];
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent);
    } else if (node.nodeName === 'IMG') {
      const alt = node.getAttribute('alt');
      if (alt) parts.push(alt);
    } else {
      for (const child of node.childNodes) walk(child);
    }
  };
  walk(el);
  return parts.join('').trim();
}

/**
 * Detect special message types (audio, video, sticker, doc, etc.)
 * Returns a label string or null if it's a regular text message.
 */
function detectSpecialType(msgEl) {
  // Audio/voice message
  if (msgEl.querySelector('audio') || msgEl.querySelector('[data-testid="audio-player"]') ||
      msgEl.querySelector('[data-icon="audio"]') || msgEl.querySelector('[aria-label*="voice"]')) {
    return '[Voice message]';
  }
  // Video
  if (msgEl.querySelector('video')) return '[Video]';
  // Document/file
  const doc = msgEl.querySelector('[data-testid="document-thumb"]') ||
              msgEl.querySelector('[data-icon="document"]');
  if (doc) {
    const nameEl = msgEl.querySelector('span[dir="ltr"]');
    const name = nameEl ? nameEl.textContent.trim() : '';
    return name ? `[Document: ${name}]` : '[Document]';
  }
  // Sticker (usually an img with specific size 100–200px)
  const imgs = [...msgEl.querySelectorAll('img')];
  const sticker = imgs.find(img => {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    return w >= 80 && w <= 250 && h >= 80 && h <= 250 && !img.alt;
  });
  if (sticker) return '[Sticker]';
  // GIF
  if (msgEl.querySelector('[data-testid="gif"]') || msgEl.querySelector('[aria-label*="GIF"]')) {
    return '[GIF]';
  }
  return null;
}

/**
 * Extract emoji reactions placed on a message (👍, ❤️, etc.).
 * Reactions live outside the [data-pre-plain-text] element, in a sibling container
 * inside the same role="row" ancestor.
 * Returns a string like "👍❤️" or "" if none.
 */
function getReactions(msgEl) {
  // Walk up to the role="row" container
  let row = msgEl.parentElement;
  while (row && row !== document.body) {
    if (row.getAttribute('role') === 'row') break;
    row = row.parentElement;
  }
  if (!row || row === document.body) return '';

  // Reactions containers use data-testid containing "reaction"
  const containers = row.querySelectorAll('[data-testid*="reaction"]');
  if (containers.length === 0) return '';

  const emojis = [];
  for (const c of containers) {
    // Walk the container to pick up emoji img[alt] and text nodes
    const parts = [];
    const walkC = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent);
      } else if (node.nodeName === 'IMG') {
        const alt = node.getAttribute('alt');
        if (alt) parts.push(alt);
      } else {
        for (const child of node.childNodes) walkC(child);
      }
    };
    walkC(c);
    const combined = parts.join('').trim();
    // Strip digits/whitespace — we only want emoji chars
    const emojiOnly = combined.replace(/[\d\s]/g, '');
    if (emojiOnly) emojis.push(emojiOnly);
  }
  return emojis.join('');
}

// ─── Core extraction ────────────────────────────────────────────────────────

/**
 * Extract all visible messages from the current chat.
 * Returns an array of { sender, timestamp, text, images, tsNum }.
 */
function extractMessages() {
  const results = new Map(); // key → message, for dedup

  // All elements with the metadata attribute (one per message bubble)
  const msgEls = document.querySelectorAll(`[${MESSAGE_ATTR}]`);

  for (const el of msgEls) {
    const rawAttr = el.getAttribute(MESSAGE_ATTR);
    const { timestamp, sender } = parseMetaAttr(rawAttr);
    if (!sender || !timestamp) continue;

    // Detect special media types first
    const specialType = detectSpecialType(el);

    // Get text content
    let text = '';
    if (specialType) {
      text = specialType;
    } else {
      // Only consider LEAF-level dir spans (those that don't contain another dir span).
      // WhatsApp sometimes nests the timestamp span inside the message text span, so
      // selecting the outer span would double-count and include the timestamp in the text.
      const allDirSpans = el.querySelectorAll(TEXT_SEL);
      const textSpans = [...allDirSpans].filter(
        s => !s.querySelector('span[dir="ltr"], span[dir="rtl"]')
      );
      if (textSpans.length > 0) {
        const parts = [];
        for (const span of textSpans) {
          const t = getMessageText(span).trim();
          // Skip timestamp-like strings (e.g. "2:30 PM", "14:30")
          if (t && t.length > 1 && !/^\d{1,2}:\d{2}(\s*[AP]M)?$/.test(t)) {
            parts.push(t);
          }
        }
        text = parts.join(' ').trim();
      }
      if (!text) {
        // Fallback: walk the element but skip any node whose ENTIRE text content is a
        // timestamp — this prevents "15" + "8:44 AM" collapsing into "158:44 AM".
        const parts = [];
        const walkSkipTimestamps = (node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            parts.push(node.textContent);
          } else if (node.nodeName === 'IMG') {
            const alt = node.getAttribute('alt');
            if (alt) parts.push(alt);
          } else {
            const t = (node.textContent || '').trim();
            if (node.nodeType === Node.ELEMENT_NODE && /^\d{1,2}:\d{2}(\s*[AP]M)?$/.test(t)) {
              return; // skip this timestamp node entirely
            }
            for (const child of node.childNodes) walkSkipTimestamps(child);
          }
        };
        walkSkipTimestamps(el);
        text = parts.join('').trim();
      }
    }

    // Skip if no text and no special type
    if (!text) continue;

    // Find photo images in this message
    const images = [...el.querySelectorAll(IMAGE_SEL)]
      .filter(isPhotoMessage)
      .map(img => img.src);

    // Extract emoji reactions (👍, ❤️, etc.) placed on this message
    const reactions = getReactions(el);

    const key = `${sender}|${timestamp}|${text.slice(0, 60)}`;
    if (!results.has(key)) {
      results.set(key, {
        sender,
        timestamp,
        tsNum: parseTimestamp(timestamp),
        text,
        images,
        reactions,
      });
    }
  }

  // Sort by parsed timestamp
  return [...results.values()].sort((a, b) => a.tsNum - b.tsNum);
}

// ─── Export helpers ─────────────────────────────────────────────────────────

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'chat';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function trigger(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function downloadJSON(messages, chatName) {
  const data = {
    conversation: chatName,
    exported_at: new Date().toISOString(),
    total: messages.length,
    messages: messages.map(({ sender, timestamp, text, images, reactions }) => ({
      sender, timestamp, text, images, ...(reactions ? { reactions } : {}),
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  trigger(blob, `${slugify(chatName)}-${today()}.json`);
}

function downloadText(messages, chatName) {
  const lines = messages.map(m => {
    const reaction = m.reactions ? `  [${m.reactions}]` : '';
    return `[${m.timestamp}] ${m.sender}: ${m.text}${reaction}`;
  });
  const blob  = new Blob([lines.join('\n\n')], { type: 'text/plain;charset=utf-8' });
  trigger(blob, `${slugify(chatName)}-${today()}.txt`);
}

async function fetchAsDataURL(url) {
  try {
    const resp = await fetch(url, { credentials: 'include' });
    const blob = await resp.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return url; // fallback to original URL if fetch fails
  }
}

async function downloadHTML(messages, chatName) {
  // Collect unique image URLs
  const allImageUrls = [...new Set(messages.flatMap(m => m.images))];
  const imageMap = new Map();

  // Fetch all images as base64 data URLs
  await Promise.all(allImageUrls.map(async (url) => {
    const dataUrl = await fetchAsDataURL(url);
    imageMap.set(url, dataUrl);
  }));

  // Determine "you" — sent messages use "message-out" direction
  // We infer the user's name by finding which senders are on the right side
  // In WhatsApp, the current user's messages don't have a distinct marker in data-pre-plain-text,
  // but checking message-out elements can tell us who "you" are.
  const outEls = document.querySelectorAll(`[${MESSAGE_ATTR}]`);
  let myName = null;
  for (const el of outEls) {
    // Walk up to find if it's inside a message-out container
    let p = el.parentElement;
    while (p && p !== document.body) {
      if (p.classList && [...p.classList].some(c => c.includes('message-out'))) {
        const { sender } = parseMetaAttr(el.getAttribute(MESSAGE_ATTR));
        if (sender) { myName = sender; break; }
      }
      p = p.parentElement;
    }
    if (myName) break;
  }

  const rows = messages.map(m => {
    const isMine = myName && m.sender === myName;
    const bubbleClass = isMine ? 'mine' : 'theirs';
    const textHtml = escapeHtml(m.text).replace(/\n/g, '<br>');
    const imagesHtml = m.images.map(url => {
      const src = imageMap.get(url) || url;
      return `<img class="msg-img" src="${src}" alt="image">`;
    }).join('');
    const reactionsHtml = m.reactions
      ? `<span class="reactions">${escapeHtml(m.reactions)}</span>`
      : '';
    return `
      <div class="msg-row ${bubbleClass}">
        <div class="bubble">
          ${!isMine ? `<span class="sender">${escapeHtml(m.sender)}</span>` : ''}
          ${imagesHtml}
          ${m.text ? `<span class="text">${textHtml}</span>` : ''}
          <span class="time">${escapeHtml(m.timestamp)}</span>
        </div>
        ${reactionsHtml}
      </div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(chatName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Segoe UI Emoji',
                 'Noto Color Emoji', 'Apple Color Emoji', sans-serif;
    background: #0b141a;
    color: #e9edef;
    padding: 0;
  }
  .chat-header {
    background: #202c33;
    padding: 14px 20px;
    font-size: 16px;
    font-weight: 600;
    color: #e9edef;
    position: sticky;
    top: 0;
    z-index: 10;
    border-bottom: 1px solid #2a3942;
  }
  .chat-header small {
    display: block;
    font-size: 12px;
    font-weight: 400;
    color: #8696a0;
    margin-top: 2px;
  }
  .messages {
    max-width: 900px;
    margin: 0 auto;
    padding: 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .msg-row {
    display: flex;
    margin-bottom: 2px;
  }
  .msg-row.mine    { justify-content: flex-end; }
  .msg-row.theirs  { justify-content: flex-start; }
  .bubble {
    max-width: 70%;
    padding: 8px 12px 6px;
    border-radius: 8px;
    font-size: 14px;
    line-height: 1.5;
    word-break: break-word;
  }
  .mine .bubble   { background: #005c4b; border-top-right-radius: 2px; }
  .theirs .bubble { background: #202c33; border-top-left-radius: 2px; }
  .sender {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: #53bdeb;
    margin-bottom: 3px;
  }
  .text {
    display: block;
    white-space: pre-wrap;
  }
  .time {
    display: block;
    font-size: 11px;
    color: #8696a0;
    margin-top: 4px;
    text-align: right;
  }
  .msg-img {
    display: block;
    max-width: 100%;
    max-height: 300px;
    border-radius: 6px;
    margin-bottom: 6px;
  }
  .reactions {
    display: inline-block;
    margin-top: 3px;
    font-size: 16px;
    background: #2a3942;
    border-radius: 12px;
    padding: 2px 6px;
    font-family: 'Segoe UI Emoji', 'Noto Color Emoji', 'Apple Color Emoji', sans-serif;
  }
  .mine + .reactions, .mine .reactions   { margin-left: auto; }
  .theirs .reactions                      { margin-right: auto; }
</style>
</head>
<body>
<div class="chat-header">
  ${escapeHtml(chatName)}
  <small>Exported ${new Date().toLocaleString()} · ${messages.length} messages</small>
</div>
<div class="messages">
${rows}
</div>
</body>
</html>`;

  const blob = new Blob(['\uFEFF' + html], { type: 'text/html;charset=utf-8' });
  trigger(blob, `${slugify(chatName)}-${today()}.html`);
}

async function exportMessages(messages, chatName, format) {
  if (format === 'json')       { downloadJSON(messages, chatName); }
  else if (format === 'text')  { downloadText(messages, chatName); }
  else if (format === 'html')  { await downloadHTML(messages, chatName); }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Scroll the open chat bottom to top and return every message seen, oldest first. */
async function collectAllMessages(onProgress) {
  const collected = new Map(); // key → message

  const addMessages = (msgs) => {
    for (const m of msgs) {
      const key = `${m.sender}|${m.timestamp}|${m.text.slice(0, 60)}`;
      if (!collected.has(key)) collected.set(key, m);
    }
    onProgress(collected.size);
  };

  const scrollEl = findScrollContainer();
  let stableRounds = 0;
  const MAX_STABLE = 10;
  const SCROLL_WAIT_MS = 3500;

  // Track the oldest visible message key instead of scrollHeight.
  // Works for both real DOM growth AND virtual/fixed-height scroll containers,
  // where scrollHeight stays constant while only the oldest DOM node changes.
  const getOldestKey = () => {
    const el = document.querySelector(`[${MESSAGE_ATTR}]`);
    return el ? el.getAttribute(MESSAGE_ATTR) : null;
  };

  // ── Phase 1: scroll DOWN to capture the most recent messages ───────────
  // Do this BEFORE disabling overflow-anchor.
  // Each jump to 9999999 lands at the bottom of the currently-rendered virtual
  // window. After WhatsApp loads the next batch, scrollHeight grows and the next
  // jump reaches further. We repeat until scrollTop stops changing (true bottom).
  // Capped at 8 rounds so this never takes more than ~12 seconds.
  if (scrollEl) {
    let prevTop = -1;
    for (let i = 0; i < 8; i++) {
      scrollEl.scrollTop = 9999999;
      await sleep(1500);
      addMessages(extractMessages());
      const curTop = scrollEl.scrollTop;
      if (curTop === prevTop) break; // no new content loaded, we're at the true bottom
      prevTop = curTop;
    }
  }

  // ── Phase 2: disable overflow-anchor, then scroll up to load history ──
  // Only disable now — overflow-anchor was needed above so the browser could
  // keep us at the bottom as WhatsApp appended new messages.
  let savedAnchor = '';
  if (scrollEl) {
    savedAnchor = scrollEl.style.overflowAnchor;
    scrollEl.style.overflowAnchor = 'none';
  }

  // Helper: nudge to top, ensuring a scroll event always fires even if already at 0.
  const nudgeToTop = async () => {
    if (scrollEl.scrollTop < 5) {
      scrollEl.scrollTop = 80;
      await sleep(120);
    }
    scrollEl.scrollTop = 0;
  };

  let lastOldestKey = '';

  while (isScrolling) {
    addMessages(extractMessages());

    if (!scrollEl) break;

    // First push — triggers WhatsApp to load the next batch of older messages
    await nudgeToTop();
    await sleep(1500);

    // Second push mid-wait — in case WhatsApp needs another scroll event to load a second batch
    await nudgeToTop();
    await sleep(SCROLL_WAIT_MS - 1620);

    const newOldestKey = getOldestKey();
    if (newOldestKey === lastOldestKey) {
      stableRounds++;
      if (stableRounds >= MAX_STABLE) break; // Reached the top
    } else {
      stableRounds = 0;
    }
    lastOldestKey = newOldestKey;
  }

  // Restore original scroll anchoring behaviour
  if (scrollEl) {
    scrollEl.style.overflowAnchor = savedAnchor;
  }

  // Final capture
  addMessages(extractMessages());

  return [...collected.values()].sort((a, b) => a.tsNum - b.tsNum);
}

// ─── Chat list (sidebar) ────────────────────────────────────────────────────

/** Scroll the sidebar top to bottom and return every chat name, in sidebar order. */
async function listChats() {
  const pane = document.querySelector(SIDEBAR_SEL);
  if (!pane) throw new Error(`Chat list not found (expected ${SIDEBAR_SEL})`);
  const names = new Set();
  pane.scrollTop = 0;
  await sleep(400);
  let prevTop = -1;
  while (pane.scrollTop !== prevTop) {
    ChatList.visibleTitles(pane, CHAT_ROW_SEL).forEach(name => names.add(name));
    prevTop = pane.scrollTop;
    pane.scrollTop += Math.max(200, pane.clientHeight * 0.8);
    await sleep(400);
  }
  ChatList.visibleTitles(pane, CHAT_ROW_SEL).forEach(name => names.add(name));
  pane.scrollTop = 0;
  return [...names];
}

/** Scroll the sidebar until a row titled `name` is rendered, and return it. */
async function findChatRow(name) {
  const pane = document.querySelector(SIDEBAR_SEL);
  if (!pane) return null;
  const visibleRow = () => [...pane.querySelectorAll(CHAT_ROW_SEL)].find(row => ChatList.rowTitle(row) === name);
  pane.scrollTop = 0;
  await sleep(400);
  let prevTop = -1;
  while (pane.scrollTop !== prevTop) {
    const row = visibleRow();
    if (row) return row;
    prevTop = pane.scrollTop;
    pane.scrollTop += Math.max(200, pane.clientHeight * 0.8);
    await sleep(400);
  }
  return visibleRow() || null;
}

/** Open the chat titled `name` and wait until its header shows that name. */
async function openChat(name) {
  if (getChatName() === name) return;
  const row = await findChatRow(name);
  if (!row) throw new Error(`Chat "${name}" not found in the chat list`);
  const target = row.querySelector('span[title]') || row;
  // WhatsApp opens chats on mousedown; click alone is not always enough
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  target.click();
  for (let waited = 0; waited < 10000; waited += 250) {
    if (getChatName() === name && document.querySelector(`[${MESSAGE_ATTR}]`)) return;
    await sleep(250);
  }
  throw new Error(`Chat "${name}" did not open within 10s (header shows "${getChatName()}")`);
}

/** Export each named chat in turn, one file per chat, pausing between chats. */
async function exportChats(names, format) {
  isScrolling = true;
  batch = { total: names.length, done: 0, current: null, messages: 0, failed: [] };
  const report = () => chrome.runtime.sendMessage({ action: 'batch_progress', ...batch }).catch(() => {});
  for (const name of names) {
    if (!isScrolling) break;
    batch.current = name;
    report();
    try {
      await openChat(name);
      const messages = await collectAllMessages(count => { batch.messages = count; report(); });
      await exportMessages(messages, name, format);
    } catch (err) {
      batch.failed.push({ name, error: err.message });
    }
    batch.done++;
    report();
    if (isScrolling && batch.done < batch.total) await sleep(ChatList.jitter(2000, 4000));
  }
  const summary = { ...batch, current: null, stopped: !isScrolling };
  isScrolling = false;
  batch = null;
  chrome.runtime.sendMessage({ action: 'batch_done', ...summary }).catch(() => {});
  return summary;
}

// ─── Message listener ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  (async () => {
    const chatName = getChatName();

    if (msg.action === 'ping') {
      // Only respond OK if we're actually on a chat page (main panel present)
      const main = document.querySelector(MAIN_PANEL);
      respond({ ok: !!main, sidebar: !!document.querySelector(SIDEBAR_SEL), batch });
      return;
    }

    if (msg.action === 'list_chats') {
      if (isScrolling || batch) { respond({ error: 'An export is already running' }); return; }
      try {
        respond({ names: await listChats() });
      } catch (err) {
        respond({ error: err.message });
      }
      return;
    }

    if (msg.action === 'export_chats') {
      if (isScrolling || batch) { respond({ error: 'An export is already running' }); return; }
      const names = Array.isArray(msg.names) ? msg.names.filter(n => typeof n === 'string') : [];
      respond(await exportChats(names, msg.format || 'json'));
      return;
    }

    if (msg.action === 'count') {
      const msgs = extractMessages();
      respond({ count: msgs.length, chatName });
      return;
    }

    if (msg.action === 'export') {
      const messages = extractMessages();
      const format = msg.format || 'json';
      if (format === 'json')  { downloadJSON(messages, chatName); }
      else if (format === 'text')  { downloadText(messages, chatName); }
      else if (format === 'html')  { await downloadHTML(messages, chatName); }
      respond({ count: messages.length });
      return;
    }

    if (msg.action === 'stop') {
      isScrolling = false;
      respond({ ok: true });
      return;
    }

    if (msg.action === 'scroll_and_export') {
      isScrolling = true;
      const final = await collectAllMessages(count => {
        chrome.runtime.sendMessage({ action: 'scroll_progress', count }).catch(() => {});
      });
      isScrolling = false;
      await exportMessages(final, chatName, msg.format || 'json');
      respond({ count: final.length });
      return;
    }

    respond({ error: 'unknown action' });
  })();

  return true; // Keep channel open for async respond
});
