'use strict';

const btnExport      = document.getElementById('btn-export');
const btnScrollExport = document.getElementById('btn-scroll-export');
const btnStop        = document.getElementById('btn-stop');
const formatSelect   = document.getElementById('format');
const statusEl       = document.getElementById('status');
const chatNameEl     = document.getElementById('chat-name');
const btnLoadChats   = document.getElementById('btn-load-chats');
const btnExportSel   = document.getElementById('btn-export-selected');
const chatSearch     = document.getElementById('chat-search');
const selectAll      = document.getElementById('select-all');
const chatListEl     = document.getElementById('chat-list');

let currentTabId = null;
let chatOpen = false;
let allChats = [];
const selectedChats = new Set();

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = type;
}

function setScrolling(active) {
  btnExport.disabled       = active || !chatOpen;
  btnScrollExport.disabled = active || !chatOpen;
  btnStop.style.display    = active ? 'block' : 'none';
  formatSelect.disabled    = active;
  btnLoadChats.disabled    = active;
  btnExportSel.disabled    = active || selectedChats.size === 0;
}

function showBatchProgress(b) {
  const current = b.current ? `: ${b.current} (${b.messages} messages)` : '';
  setStatus(`Chat ${Math.min(b.done + 1, b.total)} of ${b.total}${current}`);
}

function updateSelectedCount() {
  btnExportSel.textContent = `Export selected (${selectedChats.size})`;
  btnExportSel.disabled = selectedChats.size === 0;
}

function renderChatList() {
  const shown = ChatList.filterNames(allChats, chatSearch.value);
  chatListEl.replaceChildren(...shown.map(name => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selectedChats.has(name);
    box.addEventListener('change', () => {
      if (box.checked) selectedChats.add(name); else selectedChats.delete(name);
      updateSelectedCount();
    });
    label.append(box, document.createTextNode(name));
    label.title = name;
    return label;
  }));
  selectAll.checked = shown.length > 0 && shown.every(name => selectedChats.has(name));
}

function describeBatchResult(result) {
  const failed = result.failed.length ? `, ${result.failed.length} failed (${result.failed.map(f => f.name).join(', ')})` : '';
  const stopped = result.stopped ? 'Stopped after' : 'Exported';
  return `${stopped} ${result.done - result.failed.length} of ${result.total} chats${failed}`;
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
  if (msg.action === 'batch_progress') {
    showBatchProgress(msg);
  }
  if (msg.action === 'batch_done') {
    setStatus(describeBatchResult(msg), msg.failed.length ? 'error' : 'ok');
    setScrolling(false);
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

    if (!pong || (!pong.ok && !pong.sidebar)) {
      chatNameEl.textContent = 'Open a chat first';
      setStatus('No chat open — click a conversation first', 'error');
      return;
    }

    chatOpen = pong.ok;
    if (chatOpen) {
      const info = await sendToContent('count');
      chatNameEl.textContent = info.chatName || 'Unknown chat';
      setStatus(`${info.count} message${info.count !== 1 ? 's' : ''} visible`);
    } else {
      chatNameEl.textContent = 'No chat open';
      setStatus('Open a chat, or export several chats below');
    }

    setScrolling(false);
    if (pong.batch) {
      setScrolling(true);
      showBatchProgress(pong.batch);
    }

    btnLoadChats.addEventListener('click', async () => {
      btnLoadChats.disabled = true;
      setStatus('Reading chat list…');
      const result = await sendToContent('list_chats');
      btnLoadChats.disabled = false;
      if (result.error) { setStatus(`Could not read chat list: ${result.error}`, 'error'); return; }
      allChats = result.names;
      chatSearch.hidden = false;
      selectAll.parentElement.hidden = false;
      renderChatList();
      setStatus(`${allChats.length} chats found`);
    });

    chatSearch.addEventListener('input', renderChatList);

    selectAll.addEventListener('change', () => {
      const shown = ChatList.filterNames(allChats, chatSearch.value);
      shown.forEach(name => (selectAll.checked ? selectedChats.add(name) : selectedChats.delete(name)));
      renderChatList();
      updateSelectedCount();
    });

    btnExportSel.addEventListener('click', async () => {
      const names = allChats.filter(name => selectedChats.has(name));
      setScrolling(true);
      setStatus(`Starting export of ${names.length} chats…`);
      try {
        const result = await sendToContent('export_chats', { names, format: formatSelect.value });
        if (result.error) setStatus(result.error, 'error');
        else setStatus(describeBatchResult(result), result.failed.length ? 'error' : 'ok');
      } catch (err) {
        setStatus('Export failed: ' + err.message, 'error');
      } finally {
        setScrolling(false);
      }
    });

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
