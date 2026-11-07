import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const ChatList = createRequire(import.meta.url)('../chat-list.js');

const fakeRow = (...titles) => ({
  querySelector: (sel) => (sel === 'span[title]' && titles.length ? { getAttribute: () => titles[0] } : null),
});
const fakeRoot = (rows) => ({ querySelectorAll: () => rows });

test('filterNames matches case- and accent-insensitively', () => {
  const names = ['João Seguros', 'Mãe', 'Cotação Auto'];
  assert.deepEqual(ChatList.filterNames(names, 'joao'), ['João Seguros']);
  assert.deepEqual(ChatList.filterNames(names, 'COTACAO'), ['Cotação Auto']);
  assert.deepEqual(ChatList.filterNames(names, '   '), names);
});

test('rowTitle takes the first titled span (chat name, not the preview)', () => {
  assert.equal(ChatList.rowTitle(fakeRow('Cliente X', 'segue a apólice')), 'Cliente X');
  assert.equal(ChatList.rowTitle(fakeRow()), null);
  assert.equal(ChatList.rowTitle(fakeRow('   ')), null);
});

test('visibleTitles skips rows without a name', () => {
  assert.deepEqual(ChatList.visibleTitles(fakeRoot([fakeRow('A'), fakeRow(), fakeRow('B')]), 'x'), ['A', 'B']);
});

test('jitter stays inside its bounds', () => {
  for (let i = 0; i < 100; i++) {
    const ms = ChatList.jitter(2000, 4000);
    assert.ok(ms >= 2000 && ms <= 4000, `got ${ms}`);
  }
});
