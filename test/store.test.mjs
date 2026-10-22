import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureMemoryStore,
  hydrateEntryFromStore,
  mergeWorkspaceData,
  normalizeNote,
  normalizeOpenItem,
} from '../memory.js';
import { capMemory, deriveKeywords, search } from '../recall.js';

const legacyData = () => ({
  version: 1,
  cwd: 'D:\\test',
  updatedAt: 1,
  sessions: {
    s1: {
      id: 's1',
      updatedAt: 1,
      notes: [{ id: 'n-1', text: '要点一', why: '', tags: [], time: 10 }],
      openItems: [{ id: 't-1', text: '待办一', status: 'open', time: 11 }],
    },
    s2: {
      id: 's2',
      updatedAt: 2,
      notes: [{ id: 'n-1', text: '要点一', why: '', tags: [], time: 10 }, { id: 'n-2', text: '要点二', time: 12 }],
      openItems: [],
    },
  },
});

test('ensureMemoryStore promotes legacy session notes once', () => {
  const data = legacyData();
  const store = ensureMemoryStore(data);
  assert.deepEqual(store.notes.map((note) => note.id).sort(), ['n-1', 'n-2']);
  assert.deepEqual(store.openItems.map((item) => item.id), ['t-1']);
  assert.equal(store.migrated, 3);
  assert.equal(data.sessions.s1.notes.length, 1, 'legacy copy is kept for rollback');
});

test('ensureMemoryStore is idempotent and does not re-migrate', () => {
  const data = legacyData();
  ensureMemoryStore(data);
  data.memory.notes = [normalizeNote({ id: 'n-9', text: '只剩这一条', time: 99 })];
  const again = ensureMemoryStore(data);
  assert.deepEqual(again.notes.map((note) => note.id), ['n-9']);
  assert.equal(again.migrated, 3, 'migration flag survives');
});

test('hydrateEntryFromStore keeps the newer copy per id', () => {
  const entry = {
    notes: [normalizeNote({ id: 'n-1', text: '内存里的新版', time: 20 })],
    openItems: [],
  };
  const store = {
    notes: [
      normalizeNote({ id: 'n-1', text: '磁盘里的旧版', time: 10 }),
      normalizeNote({ id: 'n-2', text: '只存在磁盘', time: 5 }),
    ],
    openItems: [normalizeOpenItem({ id: 't-1', text: '阻塞项', status: 'blocked', time: 6 })],
  };
  const merged = hydrateEntryFromStore(entry, store);
  assert.equal(merged.notes.find((note) => note.id === 'n-1').text, '内存里的新版');
  assert.equal(merged.notes.length, 2);
  assert.equal(merged.openItems.length, 1);
  assert.equal(entry.openItems[0].status, 'blocked');
});

test('mergeWorkspaceData unions the memory store by id, newest wins', () => {
  const disk = {
    version: 1,
    sessions: {},
    updatedAt: 100,
    memory: { version: 1, updatedAt: 100, notes: [normalizeNote({ id: 'n-1', text: '旧', time: 10 })], openItems: [] },
  };
  const local = {
    version: 1,
    sessions: {},
    updatedAt: 200,
    memory: {
      version: 1,
      updatedAt: 200,
      notes: [normalizeNote({ id: 'n-1', text: '新', time: 20 }), normalizeNote({ id: 'n-2', text: '另加', time: 30 })],
      openItems: [],
    },
  };
  const merged = mergeWorkspaceData(disk, local);
  assert.equal(merged.memory.notes.find((note) => note.id === 'n-1').text, '新');
  assert.equal(merged.memory.notes.length, 2);
});

test('mergeWorkspaceData preserves a newer deletion tombstone', () => {
  const live = normalizeNote({ id: 'n-del', text: '要删除', time: 100 });
  const tombstone = { ...live, deleted: true, deletedAt: 200, time: 200 };
  const merged = mergeWorkspaceData(
    { version: 1, sessions: {}, updatedAt: 100, memory: { notes: [live], openItems: [] } },
    { version: 1, sessions: {}, updatedAt: 200, memory: { notes: [tombstone], openItems: [] } },
  );
  assert.equal(merged.memory.notes.find((note) => note.id === 'n-del').deleted, true);
});

test('mergeWorkspaceData without any memory keeps the sessions behaviour', () => {
  const disk = { version: 1, updatedAt: 1, sessions: { a: { id: 'a', updatedAt: 1 } } };
  const local = { version: 1, updatedAt: 2, sessions: { b: { id: 'b', updatedAt: 2 } } };
  const merged = mergeWorkspaceData(disk, local);
  assert.deepEqual(Object.keys(merged.sessions).sort(), ['a', 'b']);
  assert.equal(merged.memory, undefined);
});

test('end-to-end: migrate a legacy note, flush a new one, recall by synonym', () => {
  const data = legacyData();
  data.sessions.s1.notes.push({ id: 'n-perm', text: '终端 权限 修复：补了 WRITE_OWNER', why: '', tags: [], time: 5 });
  const store = ensureMemoryStore(data);
  // The live entry sees legacy entries after hydration …
  const entry = hydrateEntryFromStore({ notes: [], openItems: [] }, store);
  assert.ok(entry.notes.some((note) => note.id === 'n-perm'));
  // … and a new save writes keywords + provenance into the same store.
  const text = '表情包打标改用 deepseek-flash 视觉模型';
  entry.notes = capMemory([...entry.notes, normalizeNote({
    id: 'n-new',
    text,
    kw: deriveKeywords({ text }),
    sessionId: 's2',
    time: 50,
  })], 20);
  store.notes = entry.notes;
  const hits = search(store.notes, 'shell 权限', { limit: 5 });
  assert.equal(hits[0].item.id, 'n-perm');
  assert.equal(store.notes.find((note) => note.id === 'n-new').sessionId, 's2');
});
