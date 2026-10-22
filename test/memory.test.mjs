import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest, normalizeNote, normalizeOpenItem, capNotes, recordHasActive, isMemoryActive } from '../memory.js';

const cfg = { maxChars: 800, maxOpenItems: 20 };

test('buildDigest keeps why, pinned notes, and open items separate', () => {
  const digest = buildDigest({
    notes: [
      normalizeNote({ text: '项目决策：先做 A', why: '因为 B 会阻塞上线', time: 1, pinned: true }),
      normalizeNote({ text: '普通要点', why: '补一句理由', time: 2 }),
    ],
    openItems: [
      { id: 't-1', text: '注册计划任务', why: '撤销过一次，先确认权限', status: 'open', time: 3 },
      { id: 't-2', text: '等接口', why: '上游未发布', status: 'blocked', time: 4 },
    ],
    goals: ['旧目标'],
    items: [],
  }, cfg);
  assert.match(digest, /### 长期要点（钉住，跳过压缩）/u);
  assert.match(digest, /为什么：因为 B 会阻塞上线/u);
  assert.match(digest, /### 未完成事项/u);
  assert.match(digest, /\[阻塞\] 等接口/u);
  assert.match(digest, /id: t-1/u);
  assert.match(digest, /### 已保存的要点/u);
  assert.match(digest, /为什么：补一句理由/u);
});

test('capNotes keeps every pinned note even when maxNotes is small', () => {
  const notes = [
    normalizeNote({ text: '旧钉住', time: 1, pinned: true }),
    normalizeNote({ text: '旧普通', time: 2 }),
    normalizeNote({ text: '新普通', time: 3 }),
    normalizeNote({ text: '新钉住', time: 4, pinned: true }),
  ];
  const capped = capNotes(notes, 1);
  assert.equal(capped.length, 3);
  assert.deepEqual(capped.map((note) => note.text), ['旧钉住', '新普通', '新钉住']);
});

test('resolved open items keep status done and disappear from the digest', () => {
  const item = normalizeOpenItem({ id: 't-done', text: '已完成', status: 'done', time: 1 });
  assert.equal(item.status, 'done');
  const digest = buildDigest({
    notes: [],
    openItems: [item],
    goals: [],
    items: [],
  }, cfg);
  assert.doesNotMatch(digest, /已完成/u);
  assert.equal(recordHasActive({ openItems: [item] }), false);
});

test('superseded and expired entries are inactive; pinned overrides TTL', () => {
  const old = normalizeNote({ id: 'n-old', text: '旧方案', time: 1, expiresAt: Date.now() - 1000 });
  assert.equal(isMemoryActive(old), false);
  const pinned = normalizeNote({ id: 'n-pin', text: '钉住', time: 1, pinned: true, expiresAt: Date.now() - 1000 });
  assert.equal(isMemoryActive(pinned), true);
  const replaced = normalizeNote({ id: 'n-new', text: '新方案', time: 2, supersededBy: 'n-x' });
  assert.equal(isMemoryActive(replaced), false);
  const digest = buildDigest({ notes: [old, replaced], openItems: [], goals: [], items: [] }, cfg);
  assert.doesNotMatch(digest, /旧方案/u);
  assert.match(digest, /已过时\/已被取代/u);
});

test('deleted entries are inactive and removed by capNotes', () => {
  const note = normalizeNote({ id: 'n-del', text: '删除我', time: 1, deleted: true });
  assert.equal(isMemoryActive(note), false);
  assert.equal(capNotes([note], 10).length, 0);
});

test('recordHasActive preserves pinned notes and open items past the age window', () => {
  assert.equal(recordHasActive({ notes: [{ pinned: true }] }), true);
  assert.equal(recordHasActive({ openItems: [{ status: 'blocked' }] }), true);
  assert.equal(recordHasActive({ notes: [{ pinned: false }], openItems: [] }), false);
});
