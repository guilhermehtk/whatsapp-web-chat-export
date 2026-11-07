'use strict';

// Pure helpers for the sidebar chat list; loaded before content.js and by the popup.
const ChatList = (() => {
  const fold = (value) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

  const filterNames = (names, query) => {
    const needle = fold(query.trim());
    return needle ? names.filter(name => fold(name).includes(needle)) : names;
  };

  // The chat name is the first span[title] in a row; the last-message preview comes after it.
  const rowTitle = (row) => {
    const el = row.querySelector('span[title]');
    const title = el ? (el.getAttribute('title') || '').trim() : '';
    return title || null;
  };

  const visibleTitles = (root, rowSelector) =>
    [...root.querySelectorAll(rowSelector)].map(rowTitle).filter(Boolean);

  const jitter = (minMs, maxMs) => minMs + Math.random() * (maxMs - minMs);

  return { fold, filterNames, rowTitle, visibleTitles, jitter };
})();

if (typeof module !== 'undefined') module.exports = ChatList;
