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

/** Merge a fresh disk read with this process's local workspace view.
 * Sessions are unioned; for the same session the newer updatedAt wins. */
export function mergeWorkspaceData(disk, local) {
  if (!disk) return local;
  const merged = { ...disk, ...local };
  const sessions = { ...(disk.sessions ?? {}) };
  for (const [id, record] of Object.entries(local.sessions ?? {})) {
    const previous = sessions[id];
    if (!previous || (record?.updatedAt ?? 0) >= (previous?.updatedAt ?? 0)) {
      sessions[id] = record;
    }
  }
  merged.sessions = sessions;
  merged.updatedAt = Math.max(disk.updatedAt ?? 0, local.updatedAt ?? 0, Date.now());
  return merged;
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

/** Compress one session record into a hard-bounded markdown digest.
 *
 * Budget priority: pinned notes (capped) → open items (capped) → ordinary
 * notes → goals → dialog → tools. Nothing may push the final digest past
 * cfg.maxChars; when a line does not fit we drop why first, then tags, then
 * trim the body. Pinned notes are prioritised, not exempt from the total cap.
 */
export function buildDigest(record, cfg) {
  const max = Math.max(200, Math.trunc(cfg.maxChars));
  const allNotes = Array.isArray(record.notes) ? record.notes.map((note) => normalizeNote(note)) : [];
  const allOpenItems = Array.isArray(record.openItems) ? record.openItems.map((item) => normalizeOpenItem(item)) : [];
  const now = Date.now();
  const notes = allNotes.filter((note) => isMemoryActive(note, now));
  const openItems = capOpenItems(
    allOpenItems.filter((item) => isMemoryActive(item, now) && (item.status === 'open' || item.status === 'blocked')),
    cfg.maxOpenItems,
  );
  const inactiveCount = (allNotes.length - notes.length)
    + allOpenItems.filter((item) => !isMemoryActive(item, now) || item.status === 'done').length;
  const pinnedNotes = notes.filter((note) => note.pinned);
  const ordinaryNotes = notes.filter((note) => !note.pinned);
  const goals = Array.isArray(record.goals) ? record.goals : [];
  const items = Array.isArray(record.items) ? record.items : [];

  const fitNote = (note, budget) => {
    if (budget < 8) return '';
    const build = (withWhy, withTags) => {
      const why = withWhy && note.why ? `（为什么：${note.why}）` : '';
      const tags = withTags && note.tags.length > 0 ? ` [${note.tags.join(', ')}]` : '';
      return `- ${note.text}${why}${tags}`;
    };
    for (const [withWhy, withTags] of [[true, true], [false, true], [false, false]]) {
      const line = build(withWhy, withTags);
      if (line.length <= budget) return line;
    }
    return trimTo(build(false, false), budget);
  };

  const fitOpenItem = (item, budget) => {
    if (budget < 8) return '';
    const label = item.status === 'blocked' ? '阻塞' : '未完成';
    const prefix = `- [${label}] `;
    const id = `（id: ${item.id}）`;
    const build = (withWhy, withSupersedes) => {
      const why = withWhy && item.why ? `（为什么：${item.why}）` : '';
      const replaces = withSupersedes && item.supersedes.length > 0 ? `（取代：${item.supersedes.join(', ')}）` : '';
      return `${prefix}${item.text}${why}${id}${replaces}`;
    };
    for (const [withWhy, withSupersedes] of [[true, true], [false, true], [false, false]]) {
      const line = build(withWhy, withSupersedes);
      if (line.length <= budget) return line;
    }
    const suffix = id.length < budget - prefix.length - 1 ? id : '';
    const room = budget - prefix.length - suffix.length;
    if (room < 2) return trimTo(`${prefix}${item.text}`, budget);
    return `${prefix}${trimTo(item.text, room)}${suffix}`;
  };

  const renderSection = (title, entries, sectionBudget, render) => {
    const budget = Math.min(sectionBudget, remaining);
    const header = `### ${title}\n`;
    if (budget <= header.length + 4) return '';
    let body = '';
    for (const entry of entries) {
      const separator = body.length > 0 ? 1 : 0;
      const lineBudget = budget - header.length - body.length - separator;
      if (lineBudget < 8) break;
      const line = render(entry, lineBudget);
      if (!line) break;
      body += `${separator ? '\n' : ''}${line}`;
    }
    return body.length > 0 ? `${header}${body}` : '';
  };

  const parts = [];
  let remaining = max;

  const pinnedBudget = Math.floor(max * 0.45);
  if (pinnedNotes.length > 0) {
    const section = renderSection('长期要点（钉住，有总预算）', pinnedNotes, pinnedBudget, fitNote);
    if (section) {
      parts.push(section);
      remaining -= section.length;
    }
  }

  const openBudget = Math.floor(max * 0.3);
  if (openItems.length > 0 && remaining > 0) {
    const section = renderSection('未完成事项', openItems, openBudget, fitOpenItem);
    if (section) {
      parts.push(section);
      remaining -= section.length;
    }
  }

  if (inactiveCount > 0 && remaining > 80) {
    const text = trimTo(
      `### 已过时/已被取代\n- 另有 ${inactiveCount} 条旧条目未展开；以最新条目和本地文件为准。`,
      Math.min(140, remaining),
    );
    parts.push(text);
    remaining -= text.length;
  }

  const ordinaryBudget = Math.floor(max * 0.2);
  if (ordinaryNotes.length > 0 && remaining > 0) {
    const section = renderSection('已保存的要点', ordinaryNotes, ordinaryBudget, fitNote);
    if (section) {
      parts.push(section);
      remaining -= section.length;
    }
  }

  const goalBudget = Math.floor(max * 0.15);
  if (goals.length > 0 && remaining > 0) {
    const section = renderSection(
      '早期目标（可能已过时）',
      goals,
      goalBudget,
      (goal, budget) => trimTo(`- ${goal}`, budget),
    );
    if (section) {
      parts.push(section);
      remaining -= section.length;
    }
  }

  const dialogBudget = Math.max(0, remaining - Math.min(80, Math.floor(remaining * 0.2)) - 2);
  const dialog = items.filter((item) => item.role !== 'tool');
  const dialogLines = dialog.map((item) => `- ${roleLabel(item.role)}：${item.text}`);
  let omitted = 0;
  let dialogBody = dialogLines.join('\n');
  while (dialogBody.length > dialogBudget && dialogLines.length > 0) {
    dialogLines.shift();
    omitted += 1;
    dialogBody = dialogLines.join('\n');
  }
  if (dialogBody.length > 0 && dialogBudget > 0) {
    if (omitted > 0) dialogBody = `（更早的 ${omitted} 条对话已省略）\n${dialogBody}`;
    const text = trimTo(`### 最近对话\n${dialogBody}`, dialogBudget);
    parts.push(text);
    remaining -= text.length;
  }

  if (remaining > 80) {
    const tools = items.filter((item) => item.role === 'tool').slice(-12);
    if (tools.length > 0) {
      const toolLines = tools.map((item) => `- ${item.text}`);
      let toolBody = toolLines.join('\n');
      while (toolBody.length > remaining - 20 && toolLines.length > 0) {
        toolLines.shift();
        toolBody = toolLines.join('\n');
      }
      if (toolBody.length > 0) {
        const text = trimTo(`### 最近工具调用\n${toolBody}`, remaining);
        parts.push(text);
        remaining -= text.length;
      }
    }
  }

  let result = parts.filter(Boolean).join('\n\n');
  if (result.length > max) result = trimTo(result, max);
  return result;
}
