/**
 * Pure helpers for the bounded work-memory digest. Kept separate from the
 * Cordis Host half so they can be unit-tested without the DSH runtime.
 */
import { createHash } from 'node:crypto';

const DAY_MS = 86_400_000;

/** Collapse whitespace and bound one line of digest text. */
export function clip(text, max) {
  const flat = String(text ?? '').replace(/\s+/gu, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1))}…`;
}

export function trimTo(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** A short, stable id for a note/open item, usable from /memory pin|resolve. */
export function memoryId(prefix, text, time) {
  return `${prefix}-${time.toString(36)}-${createHash('sha1').update(`${time}:${text}`).digest('hex').slice(0, 6)}`;
}

export function normalizeNote(note, fallbackTime = Date.now()) {
  const text = clip(note?.text ?? '', 400);
  const time = typeof note?.time === 'number' ? note.time : fallbackTime;
  return {
    id: typeof note?.id === 'string' && note.id.length > 0 ? note.id : memoryId('n', text, time),
    text,
    why: clip(note?.why ?? '', 200),
    tags: Array.isArray(note?.tags) ? note.tags.slice(0, 5).map((tag) => clip(tag, 24)) : [],
    time,
    pinned: note?.pinned === true,
    deleted: note?.deleted === true,
    deletedAt: typeof note?.deletedAt === 'number' ? note.deletedAt : undefined,
    supersedes: Array.isArray(note?.supersedes) ? note.supersedes.filter((id) => typeof id === 'string' && id.length > 0) : [],
    expiresAt: typeof note?.expiresAt === 'number' ? note.expiresAt : undefined,
    supersededBy: typeof note?.supersededBy === 'string' && note.supersededBy.length > 0 ? note.supersededBy : undefined,
    supersededAt: typeof note?.supersededAt === 'number' ? note.supersededAt : undefined,
  };
}

export function normalizeOpenItem(item, fallbackTime = Date.now()) {
  const text = clip(item?.text ?? '', 400);
  const time = typeof item?.time === 'number' ? item.time : fallbackTime;
  return {
    id: typeof item?.id === 'string' && item.id.length > 0 ? item.id : memoryId('t', text, time),
    text,
    why: clip(item?.why ?? '', 200),
    status: item?.status === 'blocked' ? 'blocked' : (item?.status === 'done' ? 'done' : 'open'),
    time,
    pinned: item?.pinned === true,
    deleted: item?.deleted === true,
    deletedAt: typeof item?.deletedAt === 'number' ? item.deletedAt : undefined,
    supersedes: Array.isArray(item?.supersedes) ? item.supersedes.filter((id) => typeof id === 'string' && id.length > 0) : [],
    expiresAt: typeof item?.expiresAt === 'number' ? item.expiresAt : undefined,
    supersededBy: typeof item?.supersededBy === 'string' && item.supersededBy.length > 0 ? item.supersededBy : undefined,
    supersededAt: typeof item?.supersededAt === 'number' ? item.supersededAt : undefined,
    resolvedAt: typeof item?.resolvedAt === 'number' ? item.resolvedAt : undefined,
  };
}

/** Active entries are not done, not superseded, and not expired (unless pinned). */
export function isMemoryActive(item, now = Date.now()) {
  if (!item) return false;
  if (item.deleted) return false;
  if (item.supersededBy) return false;
  if (item.status === 'done') return false;
  if (typeof item.expiresAt === 'number' && item.expiresAt <= now && item.pinned !== true) return false;
  return true;
}

/** A record is retained past the age/session window while it has pins or open items. */
export function recordHasActive(record) {
  const notes = Array.isArray(record?.notes) ? record.notes.map((note) => normalizeNote(note)) : [];
  const openItems = (Array.isArray(record?.openItems) ? record.openItems : []).map((item) => normalizeOpenItem(item));
  return notes.some((note) => note.pinned === true && isMemoryActive(note))
    || openItems.some((item) => isMemoryActive(item) && (item.status === 'open' || item.status === 'blocked'));
}

export function capNotes(notes, max) {
  const normalized = notes.map((note) => normalizeNote(note)).filter((note) => !note.deleted);
  const pinned = normalized.filter((note) => note.pinned);
  const ordinary = normalized.filter((note) => !note.pinned).slice(-Math.max(0, max));
  return [...pinned, ...ordinary].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}

export function capOpenItems(items, max) {
  const normalized = items.map((item) => normalizeOpenItem(item)).filter((item) => !item.deleted);
  const pinned = normalized.filter((item) => item.pinned);
  const ordinary = normalized.filter((item) => !item.pinned).slice(-Math.max(1, max));
  return [...pinned, ...ordinary].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}

function noteLine(note) {
  const why = note.why ? `（为什么：${note.why}）` : '';
  const tags = note.tags.length > 0 ? ` [${note.tags.join(', ')}]` : '';
  const replaces = note.supersedes.length > 0 ? `（取代：${note.supersedes.join(', ')}）` : '';
  return `- ${note.text}${why}${tags}${replaces}`;
}

function openItemLine(item) {
  const label = item.status === 'blocked' ? '阻塞' : '未完成';
  const why = item.why ? `（为什么：${item.why}）` : '';
  const replaces = item.supersedes.length > 0 ? `（取代：${item.supersedes.join(', ')}）` : '';
  return `- [${label}] ${item.text}${why}（id: ${item.id}）${replaces}`;
}

export function ageText(ms) {
  const days = Math.floor((Date.now() - ms) / DAY_MS);
  if (!Number.isFinite(days) || days <= 0) return '今天';
  return `${days} 天前`;
}

function roleLabel(role) {
  if (role === 'user') return '用户';
  if (role === 'assistant') return '助手';
  return '工具';
}

/** Compress one session record into bounded markdown facts. */
export function buildDigest(record, cfg) {
  const allNotes = Array.isArray(record.notes) ? record.notes.map((note) => normalizeNote(note)) : [];
  const allOpenItems = Array.isArray(record.openItems) ? record.openItems.map((item) => normalizeOpenItem(item)) : [];
  const now = Date.now();
  const notes = allNotes.filter((note) => isMemoryActive(note, now));
  const openItems = allOpenItems
    .filter((item) => isMemoryActive(item, now) && (item.status === 'open' || item.status === 'blocked'))
    .slice(-cfg.maxOpenItems);
  const inactiveCount = (allNotes.length - notes.length)
    + allOpenItems.filter((item) => !isMemoryActive(item, now) || item.status === 'done').length;
  const pinnedNotes = notes.filter((note) => note.pinned);
  const ordinaryNotes = notes.filter((note) => !note.pinned);
  const goals = Array.isArray(record.goals) ? record.goals : [];
  const items = Array.isArray(record.items) ? record.items : [];
  const parts = [];
  let budget = Math.max(200, cfg.maxChars);

  // Pinned notes are deliberately exempt from trimming: they are the user's
  // explicit "keep this" signal and may exceed the normal digest budget.
  if (pinnedNotes.length > 0) {
    const text = `### 长期要点（钉住，跳过压缩）\n${pinnedNotes.map(noteLine).join('\n')}`;
    parts.push(text);
    budget -= text.length;
  }

  if (openItems.length > 0) {
    const text = `### 未完成事项\n${openItems.map(openItemLine).join('\n')}`;
    parts.push(text);
    budget -= text.length;
  }

  if (inactiveCount > 0) {
    const text = `### 已过时/已被取代\n- 另有 ${inactiveCount} 条旧条目未展开；以最新条目和本地文件为准。`;
    parts.push(text);
    budget -= text.length;
  }

  if (ordinaryNotes.length > 0) {
    const text = `### 已保存的要点\n${ordinaryNotes.map(noteLine).join('\n')}`;
    const trimmed = trimTo(text, Math.min(900, Math.floor(Math.max(120, budget) * 0.35)));
    parts.push(trimmed);
    budget -= trimmed.length;
  }

  if (goals.length > 0) {
    const text = `### 早期目标（可能已过时）\n${goals.map((goal) => `- ${goal}`).join('\n')}`;
    const trimmed = trimTo(text, Math.min(700, Math.floor(Math.max(120, budget) * 0.3)));
    parts.push(trimmed);
    budget -= trimmed.length;
  }

  const dialog = items.filter((item) => item.role !== 'tool');
  const tools = items.filter((item) => item.role === 'tool').slice(-12);

  const dialogBudget = Math.max(120, Math.floor(Math.max(120, budget) * 0.75));
  const dialogLines = dialog.map((item) => `- ${roleLabel(item.role)}：${item.text}`);
  let omitted = 0;
  let dialogBody = dialogLines.join('\n');
  while (dialogBody.length > dialogBudget && dialogLines.length > 0) {
    dialogLines.shift();
    omitted += 1;
    dialogBody = dialogLines.join('\n');
  }
  if (dialogBody.length > 0) {
    if (omitted > 0) dialogBody = `（更早的 ${omitted} 条对话已省略）\n${dialogBody}`;
    parts.push(`### 最近对话\n${dialogBody}`);
    budget -= dialogBody.length;
  }

  if (tools.length > 0 && budget > 80) {
    const toolLines = tools.map((item) => `- ${item.text}`);
    let toolBody = toolLines.join('\n');
    while (toolBody.length > budget && toolLines.length > 0) {
      toolLines.shift();
      toolBody = toolLines.join('\n');
    }
    if (toolBody.length > 0) parts.push(`### 最近工具调用\n${toolBody}`);
  }

  return parts.join('\n\n');
}
