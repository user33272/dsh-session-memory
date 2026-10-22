/**
 * Retrieval helpers for structured work memory.
 *
 * Design reference: meow-memory (MIT) documents a keyword-entry + BM25 ranking
 * model — entries carry an extracted keyword list, and hits are scored by
 * `BM25 × IDF × coverage × Ebbinghaus decay × importance`. This module keeps
 * that model but stays dependency-free and JSON-only, so the Host half can run
 * it on the existing `<workspaceKey>.json` store without a SQLite runtime.
 *
 * Everything here is pure: no fs, no clock reads unless passed in, so the
 * ranking can be unit-tested without the DSH runtime.
 *
 * @module dsh-session-memory/recall
 */

const DAY_MS = 86_400_000;

/** BM25 free parameters (standard defaults). */
const K1 = 1.2;
const B = 0.75;

/** Ranking knobs, exported so tests and docs can pin them. */
export const RANKING = {
  /** Weight applied to alias-expanded query tokens (they are weaker evidence). */
  aliasWeight: 0.55,
  /** Bonus for an exact phrase hit of the raw query. */
  exactBonus: 1.6,
  /** Decay floor: an old memory never becomes unreachable, it just ranks lower. */
  decayFloor: 0.4,
  /** Half-life in days for the decay term. */
  halfLifeDays: 30,
  /** Multipliers for strong signals. */
  pinnedBoost: 1.35,
  blockedBoost: 1.15,
  whyBoost: 1.05,
  /** Relative cut: hits below this share of the best score are dropped. */
  minRatio: 0.35,
  /** Keyword list length stored per memory entry. */
  maxKeywords: 24,
};

/**
 * Small Chinese↔English alias table. Retrieval is lexical by design (no
 * embedding service), so the same fact written as “终端/pwsh” must still be
 * found by a later query for “shell”. Groups are symmetric and one-directional
 * expansion is enough.
 */
export const ALIAS_GROUPS = [
  ['终端', '命令行', 'shell', 'pwsh', 'powershell', 'console', 'cmd', 'bash'],
  ['权限', 'permission', 'permissions', 'acl', '授权', '所有者', 'owner'],
  ['删除', '删掉', '移除', 'remove', 'delete', 'rm', 'unlink'],
  ['报错', '错误', '失败', 'error', 'errors', 'fail', 'failed', 'exception', '异常'],
  ['记忆', 'memory', '回忆', '备忘', 'remember', 'recall'],
  ['插件', 'plugin', 'plugins', '扩展', 'extension'],
  ['界面', '窗口', '页面', 'ui', 'gui', 'page'],
  ['配置', '设置', 'config', 'configuration', 'settings', 'option'],
  ['文件', 'file', 'files', '路径', 'path', '目录', 'folder', 'directory'],
  ['机器人', 'bot', 'qq', '频道', 'channel'],
  ['表情', '表情包', 'sticker', 'stickers', 'meme'],
  ['会话', 'session', '对话', 'conversation', 'chat', '上下文', 'context'],
  ['测试', 'test', 'tests', '测试用例', 'case'],
  ['提交', 'commit', '提交记录', 'git'],
  ['沙箱', 'sandbox', '隔离', 'sandboxing'],
];

/** Words that carry no retrieval signal on their own. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'for', 'to', 'of',
  'in', 'on', 'at', 'by', 'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those', 'we', 'you',
  'i', 'he', 'she', 'they', 'them', 'our', 'your', 'my', 'me', 'do', 'does',
  'did', 'not', 'no', 'so', 'than', 'too', 'very', 'can', 'could', 'should',
  'would', 'will', 'just', 'about', 'into', 'over', 'after', 'before', 'when',
  'where', 'how', 'what', 'which', 'who', 'all', 'any', 'some', 'each', 'more',
  'most', 'other', 'only', 'also', 'there', 'here', 'has', 'have', 'had',
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '这', '那', '和',
  '与', '就', '都', '而', '及', '或', '被', '把', '给', '对', '从', '到', '为',
  '以', '之', '也', '还', '又', '再', '很', '太', '更', '最', '会', '能', '要',
  '不', '没', '有', '个', '上', '下', '里', '中', '后', '前', '个', '吗', '呢',
  '吧', '啊', '着', '过', '得', '地', '让', '使', '如果', '因为', '所以', '但是',
  '而且', '或者', '一个', '我们', '你们', '他们', '这个', '那个', '可以', '需要',
  '已经', '还是', '就是', '没有', '什么', '怎么', '为什么', '然后', '现在',
]);

const CJK_CHAR = /[\u3400-\u9fff\uf900-\ufaff]/u;
const LATIN_CHAR = /[a-z0-9_+#.\-]/;

/**
 * Alias lookup keyed by *token*, not by whole word: a multi-character Chinese
 * synonym (“命令行”) tokenizes to bigrams, so the table is indexed by each
 * term's own tokens. Without this, “命令行” could never reach a note that says
 * “终端”.
 */
const ALIAS_INDEX = (() => {
  const index = new Map();
  const keysOf = (term) => {
    const keys = tokenize(term);
    if (keys.length === 0) keys.push(String(term).toLowerCase());
    return keys;
  };
  for (const group of ALIAS_GROUPS) {
    const perTerm = group.map((term) => ({ term, keys: keysOf(term) }));
    for (const entry of perTerm) {
      for (const key of entry.keys) {
        const bucket = index.get(key) ?? new Set();
        for (const other of perTerm) {
          if (other.term === entry.term) continue;
          for (const token of other.keys) if (token !== key) bucket.add(token);
        }
        index.set(key, bucket);
      }
    }
  }
  return index;
})();

/**
 * Tokenize a piece of text into retrieval terms, in text order.
 *
 * - CJK runs become overlapping bigrams (single-character runs are dropped:
 *   one hanzi matches too much to be evidence).
 * - Latin/digit runs become lowercase words of length ≥ 2, minus stopwords.
 *
 * A single left-to-right pass keeps the token order aligned with the text, so
 * a bounded keyword list still covers the beginning of a long note.
 *
 * @param {string} text
 * @returns {string[]} unique tokens, in first-seen order
 */
export function tokenize(text) {
  const source = String(text ?? '').toLowerCase();
  if (source.length === 0) return [];
  const seen = new Set();
  const tokens = [];
  const push = (token) => {
    if (token.length < 2) return;
    if (STOPWORDS.has(token)) return;
    if (seen.has(token)) return;
    seen.add(token);
    tokens.push(token);
  };

  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (CJK_CHAR.test(char)) {
      let end = i;
      while (end < source.length && CJK_CHAR.test(source[end])) end += 1;
      const run = source.slice(i, end);
      if (run.length === 2) {
        push(run);
      } else {
        for (let k = 0; k + 1 < run.length; k += 1) push(run.slice(k, k + 2));
      }
      i = end;
      continue;
    }
    if (LATIN_CHAR.test(char)) {
      let end = i;
      while (end < source.length && LATIN_CHAR.test(source[end])) end += 1;
      const word = source.slice(i, end).replace(/[.\-+]+$/u, '');
      if (word.length >= 2) push(word);
      i = end;
      continue;
    }
    i += 1;
  }
  return tokens;
}

/** All known aliases of one token (never includes the token itself). */
export function aliasesOf(token) {
  const bucket = ALIAS_INDEX.get(String(token ?? '').toLowerCase());
  return bucket ? [...bucket] : [];
}

/**
 * Expand query tokens with their alias group, keeping the original weight at 1
 * and giving aliases `RANKING.aliasWeight` so a synonym hit cannot outrank a
 * literal one.
 *
 * @param {string[]} tokens
 * @returns {Map<string, number>} token → weight
 */
export function expandQueryTokens(tokens) {
  const weighted = new Map();
  for (const token of tokens) {
    if (!weighted.has(token)) weighted.set(token, 1);
    for (const alias of aliasesOf(token)) {
      if (!weighted.has(alias)) weighted.set(alias, RANKING.aliasWeight);
    }
  }
  return weighted;
}

/**
 * Build the stored keyword list for one memory entry. This is written at save
 * time so the index does not shift when code changes, and so the model can
 * correct it by hand in the JSON file if needed.
 *
 * @param {{text?: string, why?: string, tags?: string[]}} entry
 * @returns {string[]}
 */
export function deriveKeywords(entry) {
  const parts = [entry?.text ?? '', entry?.why ?? '', (entry?.tags ?? []).join(' ')];
  const tokens = tokenize(parts.join(' '));
  if (tokens.length <= RANKING.maxKeywords) return tokens;
  return tokens.slice(0, RANKING.maxKeywords);
}

/** Jaccard similarity over two keyword lists, in [0, 1]. */
export function keywordSimilarity(a, b) {
  const left = new Set(a ?? []);
  const right = new Set(b ?? []);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

/** Normalized text used to detect an exact re-save of the same memory. */
export function normalizedText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[，。；：、！？,.;:!?"'`()（）\[\]【】/\\／＼]/gu, '')
    .replace(/[\s\u3000]+/gu, '');
}

/**
 * The tokens an item is indexed under: full text + why + tags + the stored
 * keyword hint. Stored `kw` is bounded, so indexing raw text as well keeps a
 * long note from losing the terms that fell outside the cap.
 *
 * @param {{text?: string, why?: string, tags?: string[], kw?: string[]}} item
 * @returns {string[]}
 */
export function itemTokens(item) {
  const parts = [
    item?.text ?? '',
    item?.why ?? '',
    (item?.tags ?? []).join(' '),
    Array.isArray(item?.kw) ? item.kw.join(' ') : '',
  ];
  return tokenize(parts.join(' '));
}

/**
 * Build a BM25 index over active memory entries.
 *
 * @param {Array<object>} items entries carrying `id`, `text`, `why`, `tags`, `kw`
 * @returns {{docs: Map<string, {tf: Map<string, number>, len: number}>, df: Map<string, number>, avgdl: number, total: number}}
 */
export function buildIndex(items) {
  const docs = new Map();
  const df = new Map();
  let totalLength = 0;
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item.id !== 'string') continue;
    const tokens = itemTokens(item);
    const tf = new Map();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
    docs.set(item.id, { tf, len: tokens.length });
    totalLength += tokens.length;
  }
  return {
    docs,
    df,
    avgdl: docs.size > 0 ? totalLength / docs.size : 0,
    total: docs.size,
  };
}

function idf(df, total) {
  return Math.log(1 + (total - df + 0.5) / (df + 0.5));
}

/** Ebbinghaus-flavoured recency weight with a floor so old facts stay reachable. */
export function decayWeight(time, now = Date.now()) {
  if (typeof time !== 'number' || !Number.isFinite(time)) return RANKING.decayFloor;
  const days = Math.max(0, (now - time) / DAY_MS);
  const decay = Math.exp(-days / RANKING.halfLifeDays);
  return RANKING.decayFloor + (1 - RANKING.decayFloor) * decay;
}

/** Importance multiplier derived from what the entry already signals. */
export function importanceWeight(item) {
  let weight = 1;
  if (item?.pinned === true) weight *= RANKING.pinnedBoost;
  if (item?.status === 'blocked') weight *= RANKING.blockedBoost;
  if (typeof item?.why === 'string' && item.why.length > 0) weight *= RANKING.whyBoost;
  return weight;
}

/**
 * Score every item against a query.
 *
 * @param {Array<object>} items active entries
 * @param {string} query raw query text
 * @param {{now?: number}} [options]
 * @returns {Array<{item: object, score: number, bm25: number, matched: number, coverage: number, exact: boolean}>}
 *   sorted best-first; empty when the query carries no usable token.
 */
export function rankItems(items, query, options = {}) {
  const now = typeof options.now === 'number' ? options.now : Date.now();
  const raw = String(query ?? '').trim();
  if (raw.length === 0) return [];
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  if (list.length === 0) return [];

  const canonical = [...new Set(tokenize(raw))];
  const weighted = expandQueryTokens(canonical);
  if (weighted.size === 0) return [];

  const index = buildIndex(list);
  const queryLower = raw.toLowerCase();
  const results = [];

  for (const item of list) {
    const doc = index.docs.get(item.id);
    if (!doc) continue;
    let bm25 = 0;
    for (const [token, weight] of weighted) {
      const tf = doc.tf.get(token);
      if (!tf) continue;
      const df = index.df.get(token) ?? 1;
      const norm = K1 * (1 - B + (B * doc.len) / Math.max(1, index.avgdl));
      bm25 += weight * idf(df, index.total) * ((tf * (K1 + 1)) / (tf + norm));
    }
    const haystack = `${item.text ?? ''} ${item.why ?? ''} ${(item.tags ?? []).join(' ')}`.toLowerCase();
    const exact = haystack.includes(queryLower);
    // Coverage is measured on the query's own tokens: an alias hit counts as
    // covering that token once, so expanding synonyms cannot inflate the
    // denominator into a meaningless ratio.
    let covered = 0;
    for (const token of canonical) {
      if (doc.tf.has(token)) {
        covered += 1;
        continue;
      }
      if (aliasesOf(token).some((alias) => doc.tf.has(alias))) covered += 1;
    }
    const coverage = canonical.length > 0 ? covered / canonical.length : 0;
    if (bm25 === 0 && !exact) continue;
    if (bm25 === 0 && exact) bm25 = 0.5;

    // Coverage is a coefficient, not a gate: a single rare term is still
    // useful evidence, while the relative cut below removes the noise.
    const coverageFactor = 0.6 + 0.4 * Math.min(1, coverage * 1.5);
    const score = (bm25 + (exact ? RANKING.exactBonus : 0))
      * coverageFactor
      * decayWeight(typeof item.time === 'number' ? item.time : undefined, now)
      * importanceWeight(item);
    results.push({ item, score, bm25, matched: covered, coverage, exact });
  }

  results.sort((a, b) => b.score - a.score || (b.item.time ?? 0) - (a.item.time ?? 0));
  if (results.length === 0) return [];
  const best = results[0].score;
  return results.filter((hit) => hit.exact || hit.score >= best * RANKING.minRatio);
}

/**
 * Rank with a hard `limit`, returning plain hit objects (no index leakage).
 *
 * @param {Array<object>} items
 * @param {string} query
 * @param {{now?: number, limit?: number}} [options]
 * @returns {Array<{item: object, score: number, matched: number, coverage: number, exact: boolean}>}
 */
export function search(items, query, options = {}) {
  const limit = typeof options.limit === 'number' ? options.limit : 5;
  return rankItems(items, query, options)
    .slice(0, Math.max(1, limit))
    .map(({ item, score, matched, coverage, exact }) => ({ item, score, matched, coverage, exact }));
}

/** Empty-query ordering: pinned first, then most recent. */
export function recent(items, limit = 5) {
  return (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .sort((a, b) => {
      const pin = Number(b.pinned === true) - Number(a.pinned === true);
      if (pin !== 0) return pin;
      return (b.time ?? 0) - (a.time ?? 0);
    })
    .slice(0, Math.max(1, limit));
}

/**
 * Merge legacy per-session notes into the workspace-level store.
 *
 * Sessions written before the workspace store existed carry their own
 * `notes`/`openItems`. They are copied once (dedupe by id, newest wins) and the
 * originals are left untouched so a rollback stays lossless.
 *
 * @param {Record<string, object>} sessions
 * @param {{notes?: object[], openItems?: object[]}} [existing]
 * @returns {{notes: object[], openItems: object[], migrated: number}}
 */
export function mergeLegacyEntries(sessions, existing = {}) {
  const notes = new Map();
  const openItems = new Map();
  let migrated = 0;
  for (const entry of Array.isArray(existing.notes) ? existing.notes : []) {
    if (entry && typeof entry.id === 'string') notes.set(entry.id, entry);
  }
  for (const entry of Array.isArray(existing.openItems) ? existing.openItems : []) {
    if (entry && typeof entry.id === 'string') openItems.set(entry.id, entry);
  }
  for (const record of Object.values(sessions ?? {})) {
    for (const note of Array.isArray(record?.notes) ? record.notes : []) {
      if (!note || typeof note.id !== 'string') continue;
      const previous = notes.get(note.id);
      if (!previous) {
        notes.set(note.id, note);
        migrated += 1;
      }
    }
    for (const item of Array.isArray(record?.openItems) ? record.openItems : []) {
      if (!item || typeof item.id !== 'string') continue;
      if (!openItems.has(item.id)) {
        openItems.set(item.id, item);
        migrated += 1;
      }
    }
  }
  return { notes: [...notes.values()], openItems: [...openItems.values()], migrated };
}

/** Cap a workspace memory list: keep tombstones, every pinned entry, then newest ordinary. */
export function capMemory(items, max) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  const deleted = list.filter((item) => item.deleted === true);
  const pinned = list.filter((item) => item.deleted !== true && item.pinned === true);
  const ordinary = list
    .filter((item) => item.deleted !== true && item.pinned !== true)
    .slice(-Math.max(0, max));
  return [...deleted, ...pinned, ...ordinary].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}
