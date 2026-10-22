import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RANKING,
  aliasesOf,
  capMemory,
  decayWeight,
  deriveKeywords,
  expandQueryTokens,
  itemTokens,
  keywordSimilarity,
  mergeLegacyEntries,
  normalizedText,
  recent,
  search,
  tokenize,
} from '../recall.js';

const note = (id, text, extra = {}) => ({
  id,
  text,
  why: '',
  tags: [],
  kw: deriveKeywords({ text, why: extra.why ?? '', tags: extra.tags ?? [] }),
  time: extra.time ?? Date.now(),
  pinned: extra.pinned === true,
  status: extra.status,
  ...extra,
});

test('tokenize keeps CJK bigrams and lowercased latin words', () => {
  const tokens = tokenize('终端 权限 pwsh SESSION');
  assert.ok(tokens.includes('终端'));
  assert.ok(tokens.includes('权限'));
  assert.ok(tokens.includes('pwsh'));
  assert.ok(tokens.includes('session'));
  assert.ok(!tokens.includes(' '));
});

test('tokenize drops stopwords and single hanzi runs', () => {
  const tokens = tokenize('的 我 the and x');
  assert.deepEqual(tokens, []);
});

test('aliases bridge 终端 / shell / pwsh so a synonym query still matches', () => {
  const aliases = expandQueryTokens(tokenize('shell 权限'));
  assert.equal(aliases.get('shell'), 1);
  assert.ok(aliases.has('终端'));
  assert.equal(aliases.get('终端'), RANKING.aliasWeight);
  assert.ok(aliases.has('pwsh'));
  assert.ok(aliasesOf('acl').includes('权限'));
});

test('search finds a note written in different words than the query', () => {
  const items = [
    note('n-1', 'D:\\test 的 pwsh 启动失败：缺少 WRITE_OWNER 权限项'),
    note('n-2', '表情包目录改到 D:\\fish-chat\\data\\stickers'),
  ];
  const hits = search(items, 'shell 权限', { limit: 5 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].item.id, 'n-1');
  assert.ok(hits[0].matched >= 1);
});

test('multi-character aliases still bridge through their bigrams', () => {
  const items = [note('n-1', '终端 权限 修复：补了 WRITE_OWNER')];
  const hits = search(items, '命令行', { limit: 5 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].item.id, 'n-1');
  assert.ok(aliasesOf('命令').includes('终端'));
});

test('coverage is measured on the query tokens, not on expanded aliases', () => {
  const items = [note('n-1', '终端 权限 修复：补了 WRITE_OWNER')];
  const hits = search(items, 'shell 表情包', { limit: 5 });
  assert.equal(hits.length, 1);
  // shell→终端 counts for one query token; 表情/情包 have no evidence in the
  // note. Coverage therefore stays at 1/3 of the *query* tokens, even though
  // the alias table expanded into many more candidate tokens.
  assert.ok(Math.abs(hits[0].coverage - 1 / 3) < 1e-9);
  assert.equal(hits[0].matched, 1);
});

test('search returns nothing for an unrelated query', () => {
  const items = [note('n-1', '终端权限修复完成，ACL 已补写所有者')];
  const hits = search(items, '表情包 打标 视觉模型', { limit: 5 });
  assert.deepEqual(hits, []);
});

test('search prefers the document where the query term is rare', () => {
  const now = Date.now();
  const items = [
    note('n-common', '插件 配置 说明', { time: now }),
    note('n-rare', '插件 BM25 排序实现，含 IDF 权重', { time: now }),
  ];
  const hits = search(items, 'bm25 idf', { limit: 5 });
  assert.equal(hits[0].item.id, 'n-rare');
});

test('decay lowers an old entry but keeps it reachable', () => {
  const now = Date.now();
  const fresh = decayWeight(now, now);
  const old = decayWeight(now - 300 * 86_400_000, now);
  assert.ok(fresh > old);
  assert.ok(old >= RANKING.decayFloor);
});

test('pinned entries outrank otherwise equal entries', () => {
  const now = Date.now();
  const items = [
    note('n-plain', '终端权限问题已修复', { time: now }),
    note('n-pin', '终端权限问题已修复', { time: now - 86_400_000, pinned: true }),
  ];
  const hits = search(items, '终端权限', { limit: 5 });
  assert.equal(hits[0].item.id, 'n-pin');
});

test('deriveKeywords is bounded and stable for the same input', () => {
  const text = '会话记忆插件在 D:\\test 里保存跨会话要点，召回使用 BM25 与时间衰减。';
  const a = deriveKeywords({ text, why: '避免重复排查', tags: ['memory'] });
  const b = deriveKeywords({ text, why: '避免重复排查', tags: ['memory'] });
  assert.deepEqual(a, b);
  assert.ok(a.length > 0 && a.length <= RANKING.maxKeywords);
  assert.ok(a.includes('记忆') || a.includes('会话'));
});

test('itemTokens falls back to deriving keywords for legacy entries', () => {
  const legacy = { id: 'n-old', text: '旧记录没有 kw 字段', why: '', tags: [] };
  assert.ok(itemTokens(legacy).length > 0);
});

test('keywordSimilarity detects near-duplicate memories', () => {
  const a = deriveKeywords({ text: '沙箱写权限失败，需要补 WRITE_OWNER' });
  const b = deriveKeywords({ text: '沙箱写权限失败，需要补 WRITE_OWNER 权限' });
  const c = deriveKeywords({ text: '表情包打标使用 deepseek-flash 视觉模型' });
  assert.ok(keywordSimilarity(a, b) >= 0.75);
  assert.ok(keywordSimilarity(a, c) < 0.2);
});

test('normalizedText ignores punctuation and whitespace differences', () => {
  assert.equal(normalizedText('终端 权限，失败。'), normalizedText('终端权限 失败'));
});

test('mergeLegacyEntries unions session notes without duplicates', () => {
  const sessions = {
    s1: { notes: [{ id: 'n-1', text: 'A' }, { id: 'n-2', text: 'B' }], openItems: [{ id: 't-1', text: 'T' }] },
    s2: { notes: [{ id: 'n-2', text: 'B' }, { id: 'n-3', text: 'C' }], openItems: [] },
  };
  const merged = mergeLegacyEntries(sessions, { notes: [{ id: 'n-1', text: 'A' }], openItems: [] });
  assert.equal(merged.notes.length, 3);
  assert.equal(merged.openItems.length, 1);
  assert.equal(merged.migrated, 3);
});

test('capMemory keeps pinned entries and the newest ordinary ones', () => {
  const now = Date.now();
  const items = [
    note('n-old-pin', '钉住', { time: 1, pinned: true }),
    note('n-old', '旧', { time: 2 }),
    note('n-new', '新', { time: 3 }),
    note('n-newer', '更新', { time: 4 }),
  ];
  const capped = capMemory(items, 2);
  assert.deepEqual(capped.map((entry) => entry.id), ['n-old-pin', 'n-new', 'n-newer']);
});

test('recent orders pinned first, then by recency', () => {
  const items = [note('n-1', 'a', { time: 1 }), note('n-2', 'b', { time: 2, pinned: true }), note('n-3', 'c', { time: 3 })];
  assert.deepEqual(recent(items, 3).map((entry) => entry.id), ['n-2', 'n-3', 'n-1']);
});
