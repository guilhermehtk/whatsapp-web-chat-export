'use strict';

const btnExport      = document.getElementById('btn-export');
const btnScrollExport = document.getElementById('btn-scroll-export');
const btnStop        = document.getElementById('btn-stop');
const formatSelect   = document.getElementById('format');
const statusEl       = document.getElementById('status');
const chatNameEl     = document.getElementById('chat-name');

let currentTabId = null;

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = type;
}

function setScrolling(active) {
  btnExport.disabled       = active;
  btnScrollExport.disabled = active;
  btnStop.style.display    = active ? 'block' : 'none';
  formatSelect.disabled    = active;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToContent(action, extra = {}) {
  return chrome.tabs.sendMessage(currentTabId, { action, ...extra });
}

// Listen for progress updates from content script during scrolling
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'scroll_progress') {
    setStatus(`Scrolling… (${msg.count} messages loaded)`);
  }
});

// Initialize popup
(async () => {
  try {
    const tab = await getActiveTab();
    currentTabId = tab.id;

    if (!tab.url || !tab.url.includes('web.whatsapp.com')) {
      chatNameEl.textContent = 'Open a chat on WhatsApp Web';
      setStatus('Navigate to web.whatsapp.com first', 'error');
      return;
    }

    // Ping content script
    let pong;
    try {
      pong = await sendToContent('ping');
    } catch {
      chatNameEl.textContent = 'Reload WhatsApp Web';
      setStatus('Content script not ready — reload the page', 'error');
      return;
    }

    if (!pong || !pong.ok) {
      chatNameEl.textContent = 'Open a chat first';
      setStatus('No chat open — click a conversation first', 'error');
      return;
    }

    // Get initial count
    const info = await sendToContent('count');
    chatNameEl.textContent = info.chatName || 'Unknown chat';
    setStatus(`${info.count} message${info.count !== 1 ? 's' : ''} visible`);

    btnExport.disabled       = false;
    btnScrollExport.disabled = false;

    // Export visible
    btnExport.addEventListener('click', async () => {
      const format = formatSelect.value;
      btnExport.disabled = true;
      setStatus('Extracting…');
      try {
        const result = await sendToContent('export', { format });
        setStatus(`Exported ${result.count} messages`, 'ok');
      } catch (err) {
        setStatus('Export failed: ' + err.message, 'error');
      } finally {
        btnExport.disabled = false;
      }
    });

    // Scroll all + export
    btnScrollExport.addEventListener('click', async () => {
      const format = formatSelect.value;
      setScrolling(true);
      setStatus('Starting scroll…');
      try {
        const result = await sendToContent('scroll_and_export', { format });
        setStatus(`Exported ${result.count} messages`, 'ok');
      } catch (err) {
        setStatus('Export failed: ' + err.message, 'error');
      } finally {
        setScrolling(false);
      }
    });

    // Stop scrolling
    btnStop.addEventListener('click', async () => {
      await sendToContent('stop');
      setScrolling(false);
      setStatus('Stopped. Click export to save current messages.');
    });

  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
  }
})();
