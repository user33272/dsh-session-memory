/**
 * Diagnostic: run the 1.8 store migration + recall ranking against a real
 * `<workspaceKey>.json` without booting DSH.
 *
 *   node scripts/smoke-real-workspace.mjs <path-to-workspace.json> [query ...]
 *
 * Read-only: the file on disk is never written; migration happens in memory.
 */
import { readFile } from 'node:fs/promises';
import { ensureMemoryStore, isMemoryActive, normalizeNote, normalizeOpenItem } from '../memory.js';
import { search, recent } from '../recall.js';

const [file, ...queries] = process.argv.slice(2);
if (!file) {
  console.error('用法：node scripts/smoke-real-workspace.mjs <workspace.json> [query ...]');
  process.exit(2);
}

const data = JSON.parse(await readFile(file, 'utf8'));
const sessions = data.sessions ?? {};
const before = Object.values(sessions).reduce(
  (total, record) => total + (record.notes?.length ?? 0) + (record.openItems?.length ?? 0),
  0,
);
const store = ensureMemoryStore(data);
const notes = store.notes.map((note) => normalizeNote(note)).filter((note) => isMemoryActive(note));
const openItems = store.openItems.map((item) => normalizeOpenItem(item)).filter((item) => isMemoryActive(item));
const items = [...notes, ...openItems];

console.log(`文件: ${file}`);
console.log(`会话数: ${Object.keys(sessions).length} · 旧格式条目: ${before}`);
console.log(`记忆库: notes=${notes.length} openItems=${openItems.length} migrated=${store.migrated}`);
console.log('');

const list = queries.length > 0 ? queries : ['终端 权限', 'shell 命令', '删除 文件'];
for (const query of list) {
  const hits = search(items, query, { limit: 5 });
  console.log(`查询「${query}」→ ${hits.length} 条`);
  for (const hit of hits) {
    const head = hit.item.text.slice(0, 56).replace(/\s+/gu, ' ');
    console.log(`  ${hit.score.toFixed(3)} · 覆盖率 ${hit.coverage.toFixed(2)} · ${head}…`);
  }
  if (hits.length === 0) console.log('  （无）');
}

const pinned = recent(notes.filter((note) => note.pinned === true), 5);
console.log('');
console.log(`钉住条目: ${pinned.length}`);
for (const note of pinned) console.log(`  - ${note.text.slice(0, 60).replace(/\s+/gu, ' ')}…`);
