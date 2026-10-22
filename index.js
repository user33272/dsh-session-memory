/**
 * Session Memory — a local, cross-session context keeper.
 *
 * Keeps three deliberately separate stores:
 *   identity:   an external INI persona charter (read-only)
 *   persona:    <personaDirectory>/current.md + versions/ (bounded self/relationship memory)
 *   work:       <directory>/<workspaceKey>.json + habits/ (per-workspace facts/habits)
 *
 * Injection order: identity (100) → persona (150) → habits (280) → facts (300).
 *
 * @module dsh-session-memory
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, basename, dirname, resolve } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { identityFromText } from './identity.js';
import { clearPersona, listPersonaVersions, readPersona, writePersona } from './persona.js';
import {
  ageText,
  buildDigest,
  capNotes,
  capOpenItems,
  clip,
  isMemoryActive,
  memoryId,
  normalizeNote,
  normalizeOpenItem,
  recordHasActive,
  trimTo,
} from './memory.js';

export const name = 'session-memory';
export const inject = ['systemPrompt', 'tools', 'sessions', 'agents'];

const IDENTITY_SECTION = 'context-memory:identity';
const PERSONA_SECTION = 'context-memory:persona';
const FACTS_SECTION = 'context-memory:carryover';
const HABITS_SECTION = 'context-memory:habits';
const CROSS_SECTION = 'context-memory:cross-workspace';
const IDENTITY_ORDER = 100;
const PERSONA_ORDER = 150;
const FACTS_ORDER = 300;
const CROSS_ORDER = 310;
const HABITS_ORDER = 280;
const FORMAT_VERSION = 1;
const DAY_MS = 86_400_000;
const USAGE = '/memory [status|show|path|preview|clear|todo|pins|pin <id>|unpin <id>|forget <id>|resolve <id>|habits [on|off|show|clear]|identity [show|path|import]|persona [show|versions|clear]|workspaces|cross <query>]';

export const Config = z.object({
  directory: z.string().default(''),
  autoAttach: z.boolean().default(true),
  maxChars: z.number().min(300).max(20_000).default(3000),
  maxAgeDays: z.number().min(0.1).max(3650).default(14),
  maxItems: z.number().min(10).max(400).default(80),
  maxMessageChars: z.number().min(80).max(4000).default(600),
  maxNotes: z.number().min(0).max(100).default(12),
  maxOpenItems: z.number().min(1).max(100).default(20),
  maxSessions: z.number().min(1).max(200).default(20),
  attachSessions: z.number().min(1).max(5).default(1),
  includeToolCalls: z.boolean().default(true),
  habitsEnabled: z.boolean().default(true),
  habitsMaxChars: z.number().min(200).max(2000).default(600),
  identityFile: z.string().default(''),
  identityMaxChars: z.number().min(200).max(3000).default(1200),
  personaDirectory: z.string().default(''),
  personaWorkspaceScoped: z.boolean().default(true),
  personaMaxChars: z.number().min(200).max(4000).default(1200),
  personaKeepVersions: z.number().min(1).max(20).default(5),
  crossWorkspaceEnabled: z.boolean().default(false),
  crossWorkspaceAttach: z.boolean().default(false),
  crossWorkspaceAllowlist: z.array(z.string()).default([]),
  crossWorkspaceMaxChars: z.number().min(300).max(4000).default(1500),
  crossWorkspaceSessions: z.number().min(1).max(10).default(3),
});

function clampInt(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function clampNum(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function readConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh');
  const directory = typeof source.directory === 'string' && source.directory.trim().length > 0
    ? resolve(source.directory.trim())
    : join(home, 'context-memory');
  return {
    enabled: source.enabled !== false,
    directory,
    autoAttach: source.autoAttach !== false,
    maxChars: clampInt(source.maxChars, 3000, 300, 20_000),
    maxAgeDays: clampNum(source.maxAgeDays, 14, 0.1, 3650),
    maxItems: clampInt(source.maxItems, 80, 10, 400),
    maxMessageChars: clampInt(source.maxMessageChars, 600, 80, 4000),
    maxNotes: clampInt(source.maxNotes, 12, 0, 100),
    maxOpenItems: clampInt(source.maxOpenItems, 20, 1, 100),
    maxSessions: clampInt(source.maxSessions, 20, 1, 200),
    attachSessions: clampInt(source.attachSessions, 1, 1, 5),
    includeToolCalls: source.includeToolCalls !== false,
    habitsEnabled: source.habitsEnabled !== false,
    habitsMaxChars: clampInt(source.habitsMaxChars, 600, 200, 2000),
    identityFile: typeof source.identityFile === 'string' && source.identityFile.trim().length > 0
      ? resolve(source.identityFile.trim())
      : '',
    identityMaxChars: clampInt(source.identityMaxChars, 1200, 200, 3000),
    personaDirectory: typeof source.personaDirectory === 'string' && source.personaDirectory.trim().length > 0
      ? resolve(source.personaDirectory.trim())
      : join(home, 'persona'),
    personaWorkspaceScoped: source.personaWorkspaceScoped !== false,
    personaMaxChars: clampInt(source.personaMaxChars, 1200, 200, 4000),
    personaKeepVersions: clampInt(source.personaKeepVersions, 5, 1, 20),
    crossWorkspaceEnabled: source.crossWorkspaceEnabled === true,
    crossWorkspaceAttach: source.crossWorkspaceAttach === true,
    crossWorkspaceAllowlist: Array.isArray(source.crossWorkspaceAllowlist)
      ? source.crossWorkspaceAllowlist
        .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => normalizeCwd(entry.trim()))
      : [],
    crossWorkspaceMaxChars: clampInt(source.crossWorkspaceMaxChars, 1500, 300, 4000),
    crossWorkspaceSessions: clampInt(source.crossWorkspaceSessions, 3, 1, 10),
  };
}

function normalizeCwd(cwd) {
  const resolved = resolve(cwd);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function workspaceKey(cwd) {
  return createHash('sha1').update(normalizeCwd(cwd)).digest('hex').slice(0, 16);
}

/** Strip content that must never leak into a habit document. */
function sanitizeSnippet(text) {
  return clip(
    String(text ?? '')
      .replace(/```[\s\S]*?```/gu, '')
      .replace(/`[^`]*`/gu, '')
      .replace(/[A-Za-z]:\\[^\s，。；、)）]+/gu, '<路径>')
      .replace(/https?:\/\/\S+/gu, '<链接>'),
    70,
  );
}

/** Extract only model-visible text blocks. */
function textOf(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n').trim();
}

function stamp(ms) {
  const date = new Date(typeof ms === 'number' ? ms : Date.now());
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toolDetail(name, rawArguments) {
  let detail = '';
  try {
    const args = JSON.parse(rawArguments);
    if (args && typeof args === 'object') {
      detail = args.path ?? args.file_path ?? args.command ?? args.pattern ?? args.query ?? args.description ?? '';
    }
  } catch {
    detail = typeof rawArguments === 'string' ? rawArguments : '';
  }
  return clip(`${name}${detail ? ` ${detail}` : ''}`, 180);
}

function toRecord(entry, cfg) {
  const notes = capNotes(Array.isArray(entry.notes) ? entry.notes : [], cfg.maxNotes);
  const openItems = capOpenItems(Array.isArray(entry.openItems) ? entry.openItems : [], cfg.maxOpenItems);
  const digest = buildDigest({ ...entry, notes, openItems }, cfg);
  return {
    id: entry.id,
    cwd: entry.cwd,
    title: entry.title,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    turns: entry.turns,
    items: entry.items.slice(-cfg.maxItems),
    goals: entry.goals.slice(-20),
    notes,
    openItems,
    stats: {
      rawChars: entry.rawChars,
      digestChars: digest.length,
      messages: entry.items.length,
    },
    digest,
  };
}

/** Per-session style evidence, deliberately never part of the fact digest. */
function newStyle() {
  return {
    userMsgs: 0,
    userChars: 0,
    assistantMsgs: 0,
    assistantChars: 0,
    cjk: 0,
    latin: 0,
    headings: 0,
    bullets: 0,
    code: 0,
    tables: 0,
    questions: 0,
    todos: 0,
    verified: 0,
    readBeforeEdit: 0,
    sawRead: false,
    tools: {},
    prefs: [],
  };
}

function addChars(style, text) {
  style.cjk += (text.match(/[\u3400-\u9fff]/gu) ?? []).length;
  style.latin += (text.match(/[A-Za-z]/g) ?? []).length;
}

function noteUserText(style, text) {
  style.userMsgs += 1;
  style.userChars += text.length;
  addChars(style, text);
  const pattern = /(?:以后|今后|下次|记住|不要|别|务必|always|never|from now on|remember)[^。！？!?\n]{0,60}/giu;
  for (const match of text.matchAll(pattern)) {
    const snippet = sanitizeSnippet(match[0]);
    if (snippet.length > 2 && !style.prefs.includes(snippet)) style.prefs.push(snippet);
  }
  if (style.prefs.length > 8) style.prefs.splice(0, style.prefs.length - 8);
}

function noteAssistantText(style, text) {
  style.assistantMsgs += 1;
  style.assistantChars += text.length;
  addChars(style, text);
  style.headings += (text.match(/^#{1,6}\s/gmu) ?? []).length;
  style.bullets += (text.match(/^\s*[-*]\s/gmu) ?? []).length;
  style.code += (text.match(/```/g) ?? []).length;
  style.tables += (text.match(/^\s*\|.*\|\s*$/gmu) ?? []).length;
}

function noteToolCall(style, name, rawArguments) {
  style.tools[name] = (style.tools[name] ?? 0) + 1;
  if (name === 'ask_user_question') style.questions += 1;
  if (name === 'todo_write') style.todos += 1;
  if (name === 'read') style.sawRead = true;
  if ((name === 'edit' || name === 'write' || name === 'str_replace_editor') && style.sawRead) {
    style.readBeforeEdit += 1;
  }
  if ((name === 'pwsh' || name === 'bash') && /(test|build|check|lint|typecheck|pnpm|npm\s|node --check)/iu.test(String(rawArguments ?? ''))) {
    style.verified += 1;
  }
}

/**
 * Derive a concise, human-readable interaction-habit summary from style
 * evidence only. Project facts, paths, task content, and code stay out.
 */
function buildHabitSummary(entry, cfg) {
  const s = entry.style;
  if (!s) return '';
  if (s.userMsgs < 2 && s.prefs.length === 0) return '';
  const bullets = [];

  const totalChars = s.cjk + s.latin;
  if (totalChars >= 40) {
    const ratio = s.cjk / totalChars;
    bullets.push(ratio >= 0.6 ? '语言：中文为主。' : ratio <= 0.2 ? '语言：英文为主。' : '语言：中英混用。');
  }

  const format = [];
  if (s.headings >= 3) format.push('标题分节');
  if (s.bullets >= 6) format.push('常用列表');
  if (s.code >= 4) format.push('附代码块');
  if (s.tables >= 2) format.push('表格对比');
  if (format.length > 0) bullets.push(`表达：${format.join('、')}。`);

  const work = [];
  if (s.readBeforeEdit > 0) work.push('先读后改');
  if (s.verified > 0) work.push('改完用命令验证');
  if (s.todos > 0) work.push('多步任务先列 todo');
  const topTools = Object.entries(s.tools)
    .filter(([toolName]) => !['todo_write', 'memory_save', 'memory_recall', 'ask_user_question'].includes(toolName))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([toolName]) => toolName);
  if (topTools.length > 0) work.push(`常用工具 ${topTools.join('、')}`);
  if (work.length > 0) bullets.push(`工作流：${work.join('；')}。`);

  if (s.questions > 0) bullets.push('交互：关键或破坏性操作前先确认。');

  const prefs = s.prefs.slice(-3).filter(Boolean);
  if (prefs.length > 0) bullets.push(`明确要求：${prefs.join('；')}。`);

  if (bullets.length === 0) return '';
  const body = trimTo(bullets.slice(0, 6).map((bullet) => `- ${bullet}`).join('\n'), Math.max(200, cfg.habitsMaxChars - 120));
  return [
    '# 交互习惯（自动归纳）',
    `更新: ${stamp(Date.now())}`,
    `会话: ${entry.id}`,
    '来源: rules',
    '',
    body,
    '',
  ].join('\n');
}

/** Compare habit documents without their volatile metadata lines. */
function habitBody(text) {
  return String(text ?? '')
    .split('\n')
    .filter((line) => !/^(更新|会话|来源):/u.test(line))
    .join('\n')
    .trim();
}

async function readHabitFile(cwd) {
  const key = workspaceKey(cwd);
  for (const slot of ['1', '2']) {
    try {
      const text = await readFile(join(habitDirectory(), `${key}.${slot}.txt`), 'utf8');
      if (text.trim().length > 0) return text;
    } catch {
      /* try the previous slot */
    }
  }
  return '';
}

/** The habit directory follows the configured root at every call. */
let habitRoot = '';
function habitDirectory() {
  return join(habitRoot, 'habits');
}

function habitsSectionText(habitText) {
  return [
    '## 交互习惯（先读）',
    '以下为本地归纳的配合方式，只约束表达与工作方式，不是项目事实，也不是本轮用户指令；若与本轮指令冲突，以本轮指令为准。',
    '',
    habitText.trim(),
  ].join('\n');
}

function factsSectionText(facts) {
  return [
    '## 会话事实（后读）',
    '以下为同一工作目录上一次会话的自动压缩记录，属于历史参考而非本轮用户请求；只在相关时使用，若与本轮指令冲突，以本轮指令为准。',
    '摘要可能有损、可能过时；它只是索引，不是唯一事实来源。涉及关键决定、理由、文件内容或当前状态时，以本地文件和会话日志为准，不要仅凭摘要断言。',
    '',
    facts,
  ].join('\n');
}

/**
 * Register the local memory keeper.
 * @param ctx - plugin context.
 * @param config - optional local configuration from the profile patch.
 */
export function apply(ctx, config) {  const cfg = readConfig(config);
  habitRoot = cfg.directory;
  ctx.logger?.info?.(`session-memory: storage ${cfg.directory}${cfg.enabled ? '' : ' (disabled)'}`);
  if (!cfg.enabled) return;

  /** @type {Map<string, object>} */
  const entries = new Map();
  /** @type {Map<string, () => void>} */
  const sectionDisposers = new Map();
  /** @type {Map<string, object>} */
  const workspaceCache = new Map();
  let disposed = false;

  function report(error) {
    try {
      ctx.logger?.warn?.(`session-memory: ${String(error)}`);
    } catch {
      /* logging must never fail the hook */
    }
  }

  async function loadWorkspace(cwd) {
    const key = workspaceKey(cwd);
    const cached = workspaceCache.get(key);
    if (cached) {
      await cached.ready;
      return cached;
    }
    const workspace = {
      key,
      cwd: resolve(cwd),
      file: join(cfg.directory, `${key}.json`),
      data: { version: FORMAT_VERSION, cwd: resolve(cwd), updatedAt: 0, sessions: {} },
      queue: Promise.resolve(),
      ready: undefined,
    };
    workspaceCache.set(key, workspace);
    workspace.ready = (async () => {
      try {
        const raw = await readFile(workspace.file, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === FORMAT_VERSION && parsed.sessions && typeof parsed.sessions === 'object') {
          workspace.data = parsed;
          return;
        }
        report(`忽略无法识别的记忆文件 ${workspace.file}`);
      } catch (error) {
        if (error?.code !== 'ENOENT') report(`读取记忆失败 ${workspace.file}: ${String(error)}`);
      }
    })();
    await workspace.ready;
    return workspace;
  }

  function prune(workspace) {
    const cutoff = Date.now() - cfg.maxAgeDays * DAY_MS;
    const all = Object.entries(workspace.data.sessions ?? {})
      .filter(([, record]) => typeof record?.updatedAt === 'number');
    const active = all.filter(([, record]) => recordHasActive(record));
    const ordinary = all
      .filter(([, record]) => !recordHasActive(record) && record.updatedAt >= cutoff)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, Math.max(0, cfg.maxSessions - active.length));
    const sessions = [...active, ...ordinary].sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    workspace.data.sessions = Object.fromEntries(sessions);
  }

  function queueWrite(workspace) {
    workspace.queue = workspace.queue.then(async () => {
      prune(workspace);
      await mkdir(cfg.directory, { recursive: true });
      const temp = `${workspace.file}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(workspace.data, null, 2), 'utf8');
      await rename(temp, workspace.file);
    }).catch((error) => {
      report(`写入记忆失败 ${workspace.file}: ${String(error)}`);
    });
    return workspace.queue;
  }

  async function writeHabitFile(workspace, entry) {
    if (!cfg.habitsEnabled) return;
    const text = buildHabitSummary(entry, cfg);
    if (text.length === 0) return;
    const dir = habitDirectory();
    const latest = join(dir, `${workspace.key}.1.txt`);
    const previous = join(dir, `${workspace.key}.2.txt`);
    await mkdir(dir, { recursive: true });
    let current = '';
    try {
      current = await readFile(latest, 'utf8');
    } catch {
      /* first summary for this workspace */
    }
    if (current.length > 0 && habitBody(current) === habitBody(text)) return;
    if (current.length > 0) await writeFile(previous, current, 'utf8');
    await writeFile(latest, text, 'utf8');
  }

  function mergeStoredNotes(entry, stored) {
    const storedNotes = Array.isArray(stored?.notes)
      ? stored.notes.map((note) => normalizeNote(note)).filter((note) => !note.deleted)
      : [];
    const known = new Set(entry.notes.map((note) => note.id));
    for (const note of storedNotes) {
      const existing = entry.notes.find((item) => item.id === note.id);
      if (existing) {
        // The in-memory entry is authoritative (it may have just been
        // unpinned); never re-apply a stale pinned flag from disk.
        continue;
      }
      if (!known.has(note.id)) {
        entry.notes.push(note);
        known.add(note.id);
      }
    }
    entry.notes = capNotes(entry.notes, cfg.maxNotes);

    const storedOpen = Array.isArray(stored?.openItems)
      ? stored.openItems.map((item) => normalizeOpenItem(item)).filter((item) => !item.deleted)
      : [];
    if (!Array.isArray(entry.openItems)) entry.openItems = [];
    const knownOpen = new Set(entry.openItems.map((item) => item.id));
    for (const item of storedOpen) {
      if (!knownOpen.has(item.id)) {
        entry.openItems.push(item);
        knownOpen.add(item.id);
      }
    }
    entry.openItems = capOpenItems(entry.openItems, cfg.maxOpenItems);
  }

  function findMemoryItem(entry, id) {
    const note = (entry.notes ?? []).find((item) => item.id === id);
    if (note) return { kind: 'note', note };
    const openItem = (entry.openItems ?? []).find((item) => item.id === id);
    if (openItem) return { kind: 'todo', item: openItem };
    return undefined;
  }

  async function saveEntry(entry) {
    const workspace = await loadWorkspace(entry.cwd);
    mergeStoredNotes(entry, workspace.data.sessions[entry.id]);
    workspace.data.sessions[entry.id] = toRecord(entry, cfg);
    workspace.data.updatedAt = Date.now();
    queueWrite(workspace);
    if (cfg.habitsEnabled) {
      try {
        await writeHabitFile(workspace, entry);
      } catch (error) {
        report(`写入交互习惯失败: ${String(error)}`);
      }
    }
  }

  function ensureEntry(session, seed = false) {
    const header = session.header ?? {};
    if (header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0) return undefined;
    const id = session.id;
    let entry = entries.get(id);
    if (!entry) {
      const cwd = typeof header.cwd === 'string' && header.cwd.length > 0 ? resolve(header.cwd) : resolve(process.cwd());
      entry = {
        id,
        cwd,
        cwdKey: workspaceKey(cwd),
        fromHeaderCwd: typeof header.cwd === 'string' && header.cwd.length > 0,
        title: '',
        createdAt: typeof header.createdAt === 'number' ? header.createdAt : Date.now(),
        updatedAt: Date.now(),
        turns: 0,
        items: [],
        goals: [],
        notes: [],
        openItems: [],
        style: newStyle(),
        rawChars: 0,
        lastSeq: -1,
        seeded: false,
        turnOpen: false,
      };
      entries.set(id, entry);
    }
    if (seed && !entry.seeded) {
      entry.seeded = true;
      try {
        for (const event of session.snapshotEvents()) ingest(entry, event);
      } catch (error) {
        report(`回放会话失败 ${id}: ${String(error)}`);
      }
    }
    return entry;
  }

  function pushItem(entry, role, text, time) {
    if (!text) return;
    const last = entry.items[entry.items.length - 1];
    if (last && last.role === role && last.text === text) return;
    const clipped = role === 'tool' ? text : clip(text, cfg.maxMessageChars);
    entry.rawChars += text.length;
    entry.items.push({ role, text: clipped, time });
    if (entry.items.length > cfg.maxItems) entry.items.splice(0, entry.items.length - cfg.maxItems);
  }

  function ingest(entry, event) {
    if (typeof event?.seq === 'number') {
      if (event.seq <= entry.lastSeq) return;
      entry.lastSeq = event.seq;
    }
    if (!event || typeof event.type !== 'string') return;
    if (event.type === 'turn/start') {
      entry.turnOpen = true;
      return;
    }
    if (event.type === 'turn/end') {
      entry.turnOpen = false;
      entry.turns += 1;
      entry.updatedAt = typeof event.time === 'number' ? event.time : Date.now();
      return;
    }
    if (event.type === 'user/message') {
      if (event.data?.source?.kind !== 'user') return;
      const text = textOf(event.data?.message?.content ?? event.data?.content);
      if (!text) return;
      if (!entry.title) entry.title = clip(text, 60);
      if (entry.turnOpen) {
        entry.goals.push(clip(text, 120));
        entry.turnOpen = false;
        if (entry.goals.length > 20) entry.goals.splice(0, entry.goals.length - 20);
      }
      noteUserText(entry.style, text);
      pushItem(entry, 'user', text, event.time);
      entry.updatedAt = typeof event.time === 'number' ? event.time : Date.now();
      return;
    }
    if (event.type === 'assistant/message') {
      const text = textOf(event.data?.message?.content);
      if (!text) return;
      noteAssistantText(entry.style, text);
      pushItem(entry, 'assistant', text, event.time);
      entry.updatedAt = typeof event.time === 'number' ? event.time : Date.now();
      return;
    }
    if (event.type === 'tool/call') {
      const toolName = typeof event.data?.name === 'string' ? event.data.name : 'tool';
      noteToolCall(entry.style, toolName, event.data?.arguments);
      if (cfg.includeToolCalls) pushItem(entry, 'tool', toolDetail(toolName, event.data?.arguments), event.time);
      entry.updatedAt = typeof event.time === 'number' ? event.time : Date.now();
    }
  }

  function collectRecords(workspace, selfId, includeSelf = false) {
    const cutoff = Date.now() - cfg.maxAgeDays * DAY_MS;
    const records = new Map();
    for (const [id, record] of Object.entries(workspace.data.sessions ?? {})) {
      if (!includeSelf && id === selfId) continue;
      if (typeof record?.updatedAt !== 'number') continue;
      if (record.updatedAt < cutoff && !recordHasActive(record)) continue;
      records.set(id, record);
    }
    for (const [id, entry] of entries) {
      if (!includeSelf && id === selfId) continue;
      if (entry.cwdKey !== workspace.key) continue;
      if (entry.items.length === 0 && entry.notes.length === 0 && (entry.openItems?.length ?? 0) === 0) continue;
      const view = { ...entry, notes: [...entry.notes], openItems: [...(entry.openItems ?? [])] };
      mergeStoredNotes(view, workspace.data.sessions[id]);
      records.set(id, toRecord(view, cfg));
    }
    return [...records.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  function renderFacts(records) {
    const blocks = [];
    for (const record of records) {
      const digest = typeof record.digest === 'string' && record.digest.length > 0
        ? record.digest
        : buildDigest(record, cfg);
      if (digest.trim().length === 0) continue;
      const title = record.title ? `「${record.title}」` : '';
      blocks.push(`### 会话 ${record.id}${title}（更新于 ${stamp(record.updatedAt)}，${ageText(record.updatedAt)}）\n${digest}`);
    }
    if (blocks.length === 0) return '';
    return blocks.join('\n\n');
  }

  async function loadOtherWorkspaces(currentKey) {
    let names;
    try {
      names = await readdir(cfg.directory);
    } catch (error) {
      if (error?.code !== 'ENOENT') report(`读取工作区列表失败 ${cfg.directory}: ${String(error)}`);
      return [];
    }
    const cutoff = Date.now() - cfg.maxAgeDays * DAY_MS;
    const workspaces = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const key = basename(name, '.json');
      if (key === currentKey) continue;
      const file = join(cfg.directory, name);
      try {
        const data = JSON.parse(await readFile(file, 'utf8'));
        if (!data || data.version !== FORMAT_VERSION || !data.sessions || typeof data.sessions !== 'object') continue;
        // Empty allowlist means no cross-workspace sharing: the user must pick
        // workspaces explicitly in the settings window.
        if (typeof data.cwd !== 'string' || !cfg.crossWorkspaceAllowlist.includes(normalizeCwd(data.cwd))) {
          continue;
        }
        const records = Object.values(data.sessions)
          .filter((record) => typeof record?.digest === 'string'
            && record.digest.trim().length > 0
            && typeof record.updatedAt === 'number'
            && (record.updatedAt >= cutoff || recordHasActive(record)))
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        if (records.length === 0) continue;
        workspaces.push({
          key,
          cwd: typeof data.cwd === 'string' ? data.cwd : '(unknown)',
          updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : (records[0].updatedAt ?? 0),
          records,
        });
      } catch (error) {
        report(`读取其他工作区失败 ${file}: ${String(error)}`);
      }
    }
    return workspaces.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function renderCrossWorkspace(workspaces) {
    const entries = [];
    for (const workspace of workspaces) {
      for (const record of workspace.records) entries.push({ workspace, record });
    }
    entries.sort((a, b) => (b.record.updatedAt ?? 0) - (a.record.updatedAt ?? 0));
    const chosen = entries.slice(0, cfg.crossWorkspaceSessions);
    if (chosen.length === 0) return '';
    const blocks = [
      '## 其他工作区的工作记录（跨工作区）',
      '以下只包含同一台机器上其他工作区的工作事实，不含身份/人格数据；按需参考，不要对外扩散。',
    ];
    let budget = cfg.crossWorkspaceMaxChars;
    for (const { workspace, record } of chosen) {
      if (budget <= 0) break;
      const digest = trimTo(record.digest.trim(), Math.min(900, budget));
      const title = record.title ? `「${record.title}」` : '';
      blocks.push(`### 工作区：${workspace.cwd} · 会话 ${record.id}${title}（更新于 ${stamp(record.updatedAt)}）\n${digest}`);
      budget -= digest.length;
    }
    return blocks.join('\n\n');
  }

  async function attachCrossWorkspace(agent, workspace) {
    if (!cfg.crossWorkspaceEnabled || !cfg.crossWorkspaceAttach) return;
    const systemPrompt = agent.ctx?.systemPrompt;
    if (!systemPrompt) return;
    const others = await loadOtherWorkspaces(workspace.key);
    const text = renderCrossWorkspace(others);
    if (text.length === 0) return;
    const dispose = systemPrompt.section({
      name: CROSS_SECTION,
      order: CROSS_ORDER,
      text,
      interpolate: false,
    });
    rememberSection(`${agent.id}:cross`, dispose);
  }

  function rememberSection(key, dispose) {
    const previous = sectionDisposers.get(key);
    if (previous) {
      try {
        previous();
      } catch {
        /* ignore */
      }
    }
    sectionDisposers.set(key, dispose);
  }

  function personaRootFor(cwd) {
    if (!cfg.personaWorkspaceScoped) return cfg.personaDirectory;
    if (typeof cwd !== 'string' || cwd.length === 0) return '';
    return join(cfg.personaDirectory, 'workspaces', workspaceKey(cwd));
  }

  function identityFileFor(cwd) {
    if (!cfg.personaWorkspaceScoped) return cfg.identityFile;
    const root = personaRootFor(cwd);
    return root ? join(root, 'identity.ini') : '';
  }

  async function readIdentity(file) {
    const target = file ?? cfg.identityFile;
    if (!target) return '';
    try {
      const text = await readFile(target, 'utf8');
      return identityFromText(text, cfg.identityMaxChars);
    } catch (error) {
      if (error?.code !== 'ENOENT') report(`读取身份文件失败 ${target}: ${String(error)}`);
      return '';
    }
  }

  async function attachIdentity(agent) {
    const systemPrompt = agent.ctx?.systemPrompt;
    if (!systemPrompt) return;
    const cwd = agent.session?.header?.cwd;
    const file = identityFileFor(cwd);
    if (!file) return;
    const identity = await readIdentity(file);
    if (identity.length === 0) return;
    const dispose = systemPrompt.section({
      name: IDENTITY_SECTION,
      order: IDENTITY_ORDER,
      text: identity,
      interpolate: false,
    });
    rememberSection(`${agent.id}:identity`, dispose);
  }

  async function readPersonaText(root) {
    const target = root ?? cfg.personaDirectory;
    try {
      return await readPersona(target);
    } catch (error) {
      report(`读取人格记忆失败 ${target}: ${String(error)}`);
      return '';
    }
  }

  function personaSectionText(text) {
    return [
      '## 人格记忆（常驻）',
      `这是你当前的人格与关系摘要，不是项目事实。需要更新时，用 persona_save 写一份不超过 ${cfg.personaMaxChars} 字的替换版本；旧版本保存在人格目录的 versions 子目录。`,
      '',
      text,
    ].join('\n');
  }

  async function attachPersona(agent) {
    const systemPrompt = agent.ctx?.systemPrompt;
    if (!systemPrompt) return;
    const cwd = agent.session?.header?.cwd;
    const root = personaRootFor(cwd);
    if (!root) return;
    const text = await readPersonaText(root);
    if (text.length === 0) return;
    const dispose = systemPrompt.section({
      name: PERSONA_SECTION,
      order: PERSONA_ORDER,
      text: personaSectionText(text),
      interpolate: false,
    });
    rememberSection(`${agent.id}:persona`, dispose);
  }

  const promptReady = new Set();

  async function ensureAgentSections(agent) {
    if (!agent || promptReady.has(agent.id)) return;
    const header = agent.session?.header ?? {};
    if (header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0) {
      promptReady.add(agent.id);
      return;
    }
    promptReady.add(agent.id);
    try {
      await attachIdentity(agent);
      await attachPersona(agent);
    } catch (error) {
      promptReady.delete(agent.id);
      throw error;
    }
  }

  async function attachMemory(agent) {
    const header = agent.session?.header ?? {};
    if (typeof header.cwd !== 'string' || header.cwd.length === 0) return;
    const systemPrompt = agent.ctx?.systemPrompt;
    if (!systemPrompt) return;

    const workspace = await loadWorkspace(header.cwd);
    const records = collectRecords(workspace, agent.id)
      .filter((record) => (record.digest ?? '').trim().length > 0)
      .slice(0, cfg.attachSessions);
    const facts = renderFacts(records);
    const habits = cfg.habitsEnabled ? await readHabitFile(header.cwd) : '';

    if (habits.length > 0) {
      const dispose = systemPrompt.section({
        name: HABITS_SECTION,
        order: HABITS_ORDER,
        text: habitsSectionText(habits),
        interpolate: false,
      });
      rememberSection(`${agent.id}:habits`, dispose);
    }
    if (facts.length > 0) {
      const dispose = systemPrompt.section({
        name: FACTS_SECTION,
        order: FACTS_ORDER,
        text: factsSectionText(facts),
        interpolate: false,
      });
      rememberSection(`${agent.id}:facts`, dispose);
    }
    await attachCrossWorkspace(agent, workspace);
  }

  ctx.effect(() => () => {
    disposed = true;
    for (const dispose of sectionDisposers.values()) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
    sectionDisposers.clear();
  });

  ctx.on('agent/created', async ({ agent, source }) => {
    try {
      const entry = ensureEntry(agent.session, true);
      if (!entry) return;
      await ensureAgentSections(agent);
      if (cfg.autoAttach && (source === 'startup' || source === 'clear')) await attachMemory(agent);
    } catch (error) {
      report(`初始化会话记忆失败 ${agent?.id}: ${String(error)}`);
    }
  });

  ctx.on('agent/disposed', ({ agent }) => {
    try {
      promptReady.delete(agent.id);
      for (const key of [`${agent.id}:identity`, `${agent.id}:persona`, `${agent.id}:habits`, `${agent.id}:facts`, `${agent.id}:cross`]) {
        const dispose = sectionDisposers.get(key);
        if (dispose) {
          try {
            dispose();
          } catch {
            /* ignore */
          }
          sectionDisposers.delete(key);
        }
      }
      const entry = entries.get(agent.id);
      if (entry) {
        entry.updatedAt = Date.now();
        void saveEntry(entry);
        entries.delete(agent.id);
      }
    } catch (error) {
      report(`收尾会话记忆失败 ${agent?.id}: ${String(error)}`);
    }
  });

  ctx.on('session/event', (session, event) => {
    try {
      if (disposed) return;
      const entry = ensureEntry(session);
      if (!entry) return;
      // QQ/other channel agents may be created before this plugin's
      // agent/created listener is in scope. Lazily attach identity/persona
      // from the session's live agent so the next turn sees them.
      const agent = ctx.agents?.get?.(session.id);
      if (agent) {
        void ensureAgentSections(agent).catch((error) => {
          report(`补挂人格失败 ${session.id}: ${String(error)}`);
        });
      }
      ingest(entry, event);
      if (event.type === 'turn/end') void saveEntry(entry);
    } catch (error) {
      report(`记录会话事件失败 ${session?.id}: ${String(error)}`);
    }
  });

  ctx.tools.register({
    name: 'memory_save',
    description: '把值得跨会话保留的工作记忆写入本机。kind=note 存要点；kind=todo 存未完成事项/阻塞，不跟闲聊混。尽量给 why（一句为什么），关键内容可用 pinned 标记为永久（跳过压缩）。不要保存密钥、令牌或大段原文。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        note: {
          type: 'string',
          description: '一条独立、可复用的内容，建议 200 字以内。',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '可选标签，最多 5 个。',
        },
        why: {
          type: 'string',
          description: '可选：这条为什么重要/为什么这样决定，一句即可（建议 60 字以内）。',
        },
        kind: {
          type: 'string',
          enum: ['note', 'todo'],
          description: 'note（默认）普通要点；todo 未完成事项/阻塞。',
        },
        status: {
          type: 'string',
          enum: ['open', 'blocked'],
          description: 'kind=todo 时使用：open 待办，blocked 阻塞。默认 open。',
        },
        pinned: {
          type: 'boolean',
          description: 'true 表示永久钉住；压缩时跳过，不随普通要点淘汰。',
        },
        supersedes: {
          type: 'array',
          items: { type: 'string' },
          description: '可选：被这条新记忆取代的旧条目 id。旧条目会标记为已被取代，不再进入摘要/召回。',
        },
        ttlDays: {
          type: 'integer',
          description: '可选：多少天后过期（1-3650）；过期条目不再进入摘要/召回，除非 pinned。',
        },
      },
      required: ['note'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          saved: { type: 'boolean' },
          id: { type: 'string' },
          kind: { type: 'string' },
          notes: { type: 'integer' },
          openItems: { type: 'integer' },
          pinned: { type: 'boolean' },
          superseded: { type: 'integer' },
          expiresAt: { type: 'integer' },
        },
        required: ['saved', 'id', 'kind', 'notes', 'openItems', 'pinned', 'superseded', 'expiresAt'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.saved
          ? `已保存${value.kind === 'todo' ? '未完成事项' : '要点'}（id: ${value.id}${value.pinned ? '，已钉住' : ''}${value.superseded > 0 ? `，取代 ${value.superseded} 条旧记忆` : ''}${value.expiresAt > 0 ? `，${new Date(value.expiresAt).toLocaleDateString('zh-CN')} 过期` : ''}）。当前要点 ${value.notes} 条，未完成 ${value.openItems} 条。`
          : '未保存。',
      }],
    },
    async execute(args, exec) {
      if (!cfg.enabled) throw new Error('会话记忆已在配置中禁用');
      const agent = exec.agent;
      if (!agent) throw new Error('memory_save 需要所属会话');
      const entry = entries.get(agent.id) ?? ensureEntry(agent.session, true);
      if (!entry) throw new Error('子代理会话不参与跨会话记忆');
      const header = agent.session?.header ?? {};
      if (typeof header.cwd === 'string' && header.cwd.length > 0) {
        const workspace = await loadWorkspace(header.cwd);
        mergeStoredNotes(entry, workspace.data.sessions[agent.id]);
      }
      const text = typeof args?.note === 'string' ? args.note.trim() : '';
      if (text.length === 0) throw new Error('note 不能为空');
      const kind = args?.kind === 'todo' ? 'todo' : 'note';
      if (kind === 'note' && cfg.maxNotes === 0) throw new Error('当前配置不保存要点（maxNotes = 0）');
      const why = typeof args?.why === 'string' ? clip(args.why, 200) : '';
      const pinned = args?.pinned === true;
      const tags = Array.isArray(args?.tags) ? args.tags.slice(0, 5).map((tag) => clip(String(tag), 24)) : [];
      const time = Date.now();
      const id = memoryId(kind === 'todo' ? 't' : 'n', clip(text, 400), time);
      const ttlDays = typeof args?.ttlDays === 'number' ? clampInt(args.ttlDays, 0, 1, 3650) : 0;
      const expiresAt = ttlDays > 0 ? time + ttlDays * DAY_MS : undefined;
      const supersedeIds = new Set(
        (Array.isArray(args?.supersedes) ? args.supersedes : [args?.supersedes])
          .filter((value) => typeof value === 'string' && value.length > 0),
      );
      let superseded = 0;
      if (supersedeIds.size > 0) {
        for (const note of entry.notes) {
          if (supersedeIds.has(note.id) && !note.supersededBy) {
            note.supersededBy = id;
            note.supersededAt = time;
            superseded += 1;
          }
        }
        for (const item of entry.openItems ?? []) {
          if (supersedeIds.has(item.id) && !item.supersededBy) {
            item.supersededBy = id;
            item.supersededAt = time;
            superseded += 1;
          }
        }
      }
      if (kind === 'todo') {
        if (!Array.isArray(entry.openItems)) entry.openItems = [];
        entry.openItems.push({
          id,
          text: clip(text, 400),
          why,
          status: args?.status === 'blocked' ? 'blocked' : 'open',
          time,
          pinned,
          expiresAt,
        });
        entry.openItems = capOpenItems(entry.openItems, cfg.maxOpenItems);
      } else {
        entry.notes.push({ id, text: clip(text, 400), why, tags, time, pinned, expiresAt });
        entry.notes = capNotes(entry.notes, cfg.maxNotes);
      }
      entry.updatedAt = time;
      await saveEntry(entry);
      return {
        saved: true,
        id,
        kind,
        notes: entry.notes.length,
        openItems: (entry.openItems ?? []).filter((item) => item.status === 'open' || item.status === 'blocked').length,
        pinned,
        superseded,
        expiresAt: expiresAt ?? 0,
      };
    },
  });

  ctx.tools.register({
    name: 'memory_pin',
    description: '把一条已保存的要点或未完成事项标记为永久钉住（或取消钉住）。钉住的内容会在压缩时跳过，不会因普通上限被淘汰。id 来自 memory_save 返回值或 /memory show。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: '要钉住的条目 id。' },
        pinned: { type: 'boolean', description: 'true 钉住，false 取消；默认 true。' },
      },
      required: ['id'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean' },
          pinned: { type: 'boolean' },
          id: { type: 'string' },
          kind: { type: 'string' },
        },
        required: ['found', 'pinned', 'id', 'kind'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.found
          ? `${value.pinned ? '已钉住' : '已取消钉住'} ${value.id}（${value.kind === 'todo' ? '未完成事项' : '要点'}）。`
          : `未找到条目 ${value.id}。`,
      }],
    },
    async execute(args, exec) {
      const id = typeof args?.id === 'string' ? args.id.trim() : '';
      if (!id) throw new Error('id 不能为空');
      const agent = exec.agent;
      if (!agent) throw new Error('memory_pin 需要所属会话');
      const entry = entries.get(agent.id) ?? ensureEntry(agent.session, true);
      if (!entry) throw new Error('子代理会话不参与跨会话记忆');
      const header = agent.session?.header ?? {};
      if (typeof header.cwd === 'string' && header.cwd.length > 0) {
        const workspace = await loadWorkspace(header.cwd);
        mergeStoredNotes(entry, workspace.data.sessions[agent.id]);
      }
      const found = findMemoryItem(entry, id);
      if (!found) throw new Error(`未找到条目 ${id}`);
      const pinned = args?.pinned !== false;
      if (found.kind === 'note') found.note.pinned = pinned;
      else found.item.pinned = pinned;
      entry.updatedAt = Date.now();
      await saveEntry(entry);
      return { found: true, pinned, id, kind: found.kind };
    },
  });

  ctx.tools.register({
    name: 'memory_resolve',
    description: '把一条未完成事项标记为已完成，不再出现在待办和摘要里。用于收尾；不要用它删除普通要点。id 来自 memory_save 返回值或 /memory todo。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: '要完成的未完成事项 id。' },
      },
      required: ['id'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resolved: { type: 'boolean' },
          id: { type: 'string' },
        },
        required: ['resolved', 'id'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.resolved ? `已完成并标记未完成事项 ${value.id}。` : `未找到 ${value.id}。`,
      }],
    },
    async execute(args, exec) {
      const id = typeof args?.id === 'string' ? args.id.trim() : '';
      if (!id) throw new Error('id 不能为空');
      const agent = exec.agent;
      if (!agent) throw new Error('memory_resolve 需要所属会话');
      const entry = entries.get(agent.id) ?? ensureEntry(agent.session, true);
      if (!entry) throw new Error('子代理会话不参与跨会话记忆');
      const header = agent.session?.header ?? {};
      if (typeof header.cwd === 'string' && header.cwd.length > 0) {
        const workspace = await loadWorkspace(header.cwd);
        mergeStoredNotes(entry, workspace.data.sessions[agent.id]);
      }
      const found = findMemoryItem(entry, id);
      if (!found) throw new Error(`未找到未完成事项 ${id}`);
      if (found.kind !== 'todo') throw new Error(`${id} 是普通要点，不是未完成事项`);
      found.item.status = 'done';
      found.item.resolvedAt = Date.now();
      entry.openItems = capOpenItems(entry.openItems ?? [], cfg.maxOpenItems);
      entry.updatedAt = Date.now();
      await saveEntry(entry);
      return { resolved: true, id };
    },
  });

  ctx.tools.register({
    name: 'memory_forget',
    description: '永久删除当前工作区的一条要点或未完成事项。用于清理测试条目或明确不再需要的记忆；普通收尾请用 memory_resolve，不要误删长期约定。id 来自 memory_save 返回值或 /memory show。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: '要删除的条目 id。' },
      },
      required: ['id'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          forgotten: { type: 'boolean' },
          id: { type: 'string' },
          kind: { type: 'string' },
        },
        required: ['forgotten', 'id', 'kind'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.forgotten ? `已删除 ${value.id}（${value.kind === 'todo' ? '未完成事项' : '要点'}）。` : `未找到 ${value.id}。`,
      }],
    },
    async execute(args, exec) {
      const id = typeof args?.id === 'string' ? args.id.trim() : '';
      if (!id) throw new Error('id 不能为空');
      const agent = exec.agent;
      if (!agent) throw new Error('memory_forget 需要所属会话');
      const entry = entries.get(agent.id) ?? ensureEntry(agent.session, true);
      if (!entry) throw new Error('子代理会话不参与跨会话记忆');
      const header = agent.session?.header ?? {};
      if (typeof header.cwd === 'string' && header.cwd.length > 0) {
        const workspace = await loadWorkspace(header.cwd);
        mergeStoredNotes(entry, workspace.data.sessions[agent.id]);
      }
      const found = findMemoryItem(entry, id);
      if (!found) return { forgotten: false, id, kind: '' };
      if (found.kind === 'note') {
        found.note.deleted = true;
        found.note.deletedAt = Date.now();
      } else {
        found.item.deleted = true;
        found.item.deletedAt = Date.now();
      }
      entry.updatedAt = Date.now();
      await saveEntry(entry);
      return { forgotten: true, id, kind: found.kind };
    },
  });

  ctx.tools.register({
    name: 'memory_recall',
    description: '检索本机保存的**结构化工作记忆**（notes / openItems），不检索对话、工具调用或摘要正文，避免命令行噪声。默认只查 kind=note；kind=todo 查未完成事项；kind=all 两者都查。默认按关键词相关性 + 时间衰减排序，省略 query 时按最近/钉住排序。scope=all 可查已允许的其他工作区，只含工作事实，绝不含身份/人格。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: '关键词；省略时返回最近的结构化记忆。',
        },
        limit: {
          type: 'integer',
          description: '返回条数，1-5，默认 5。',
        },
        scope: {
          type: 'string',
          enum: ['workspace', 'all'],
          description: 'workspace（默认）只查当前工作目录；all 还查其他工作区的工作记录。',
        },
        kind: {
          type: 'string',
          enum: ['note', 'todo', 'all'],
          description: 'note（默认）普通要点；todo 待办/阻塞；all 两者都查。',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          matches: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                kind: { type: 'string' },
                workspace: { type: 'string' },
                sessionId: { type: 'string' },
                updatedAt: { type: 'integer' },
                text: { type: 'string' },
                why: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                pinned: { type: 'boolean' },
                status: { type: 'string' },
                score: { type: 'number' },
              },
              required: ['id', 'kind', 'workspace', 'sessionId', 'updatedAt', 'text', 'why', 'tags', 'pinned', 'status', 'score'],
            },
          },
          total: { type: 'integer' },
        },
        required: ['matches', 'total'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.matches.length === 0
          ? '没有找到相关的结构化工作记忆。'
          : value.matches.map((match) => {
            const why = match.why ? `\n为什么：${match.why}` : '';
            const tags = match.tags.length > 0 ? ` · ${match.tags.join(', ')}` : '';
            const pin = match.pinned ? ' · 钉住' : '';
            const status = match.kind === 'todo' ? `（${match.status === 'blocked' ? '阻塞' : '未完成'}）` : '';
            return `[${match.kind}${status} · ${match.workspace} · ${stamp(match.updatedAt)}]\n${match.text}${why}\nid: ${match.id}${tags}${pin}`;
          }).join('\n\n'),
      }],
    },
    async execute(args, exec) {
      if (!cfg.enabled) throw new Error('会话记忆已在配置中禁用');
      const agent = exec.agent;
      if (!agent) throw new Error('memory_recall 需要所属会话');
      const header = agent.session?.header ?? {};
      if (typeof header.cwd !== 'string' || header.cwd.length === 0) {
        return { matches: [], total: 0 };
      }
      const workspace = await loadWorkspace(header.cwd);
      const scope = args?.scope === 'all' ? 'all' : 'workspace';
      const kindFilter = args?.kind === 'todo' ? 'todo' : (args?.kind === 'all' ? 'all' : 'note');
      const limit = clampInt(args?.limit, 5, 1, 5);
      const rawQuery = typeof args?.query === 'string' ? args.query.trim() : '';
      const query = rawQuery.toLowerCase();
      const terms = [...new Set(query.split(/[\s,，。;；/|]+/u).filter((term) => term.length > 0))];
      const records = collectRecords(workspace, agent.id, true)
        .map((record) => ({ workspace: header.cwd, record }));
      if (scope === 'all') {
        if (!cfg.crossWorkspaceEnabled) {
          throw new Error('跨工作区读取未启用；请在插件设置中开启，或使用默认的 workspace 范围');
        }
        const others = await loadOtherWorkspaces(workspace.key);
        for (const other of others) {
          for (const record of other.records) records.push({ workspace: other.cwd, record });
        }
      }

      const hits = [];
      for (const { workspace: cwd, record } of records) {
        const add = (kind, item) => {
          if (kindFilter !== 'all' && kindFilter !== kind) return;
          if (!isMemoryActive(item)) return;
          if (kind === 'todo' && item.status === 'done') return;
          // Never let a query echo (or a memory_recall tool line) become a hit.
          const textLower = item.text.toLowerCase();
          if (textLower === query || textLower.startsWith('memory_recall')) return;
          const haystack = `${item.text} ${item.why} ${(item.tags ?? []).join(' ')}`.toLowerCase();
          let score = 0;
          if (query.length > 0) {
            const exact = haystack.includes(query) ? 30 : 0;
            let matched = 0;
            for (const term of terms) if (haystack.includes(term)) matched += 1;
            if (exact === 0 && matched === 0) return;
            score = exact
              + matched * 6
              + (matched === terms.length ? 8 : 0)
              + (item.pinned ? 4 : 0)
              + Math.max(0, 5 - (Date.now() - item.time) / DAY_MS / 7);
          } else {
            score = (item.pinned ? 1000 : 0) + item.time / 1e12;
          }
          hits.push({
            id: item.id,
            kind,
            workspace: cwd,
            sessionId: record.id,
            updatedAt: item.time,
            text: item.text,
            why: item.why,
            tags: item.tags ?? [],
            pinned: item.pinned,
            status: kind === 'todo' ? item.status : '',
            score,
          });
        };
        for (const note of record.notes ?? []) add('note', normalizeNote(note));
        for (const item of record.openItems ?? []) add('todo', normalizeOpenItem(item));
      }
      hits.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
      return { matches: hits.slice(0, limit), total: hits.length };
    },
  });

  ctx.tools.register({
    name: 'persona_save',
    description: `用一份不超过 ${cfg.personaMaxChars} 字的摘要替换「当前工作区的人格/关系记忆」。只写长期自我认知与和 li 的关系（称呼、约定、边界、重要变化），不要写项目事实、任务进度或文件路径；旧版本会保留。`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: {
          type: 'string',
          description: `完整替换文本，不超过 ${cfg.personaMaxChars} 字；应包含旧版本中仍需保留的要点。`,
        },
      },
      required: ['text'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          saved: { type: 'boolean' },
          chars: { type: 'integer' },
          version: { type: 'string' },
        },
        required: ['saved', 'chars', 'version'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.saved
          ? `已写入人格记忆（${value.chars} 字，版本 ${value.version}）。`
          : '未写入人格记忆。',
      }],
    },
    async execute(args, exec) {
      if (!cfg.enabled) throw new Error('会话记忆已在配置中禁用');
      const header = exec.agent?.session?.header ?? {};
      if (header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0) {
        throw new Error('子代理不写入人格记忆');
      }
      const root = personaRootFor(header.cwd);
      if (!root) throw new Error('人格按工作区隔离时需要所属会话的工作目录');
      const text = typeof args?.text === 'string' ? args.text : '';
      const result = await writePersona(root, text, {
        maxChars: cfg.personaMaxChars,
        keepVersions: cfg.personaKeepVersions,
      });
      return { saved: true, chars: result.chars, version: result.version };
    },
  });

  async function setHabitsEnabled(next) {
    cfg.habitsEnabled = next;
    const settings = ctx.get('settings');
    if (settings && typeof settings.update === 'function') {
      try {
        await settings.update('session-memory', { habitsEnabled: next });
        return 'persisted';
      } catch (error) {
        report(`保存交互习惯开关失败: ${String(error)}`);
        return 'runtime';
      }
    }
    return 'runtime';
  }

  async function memoryCommand(invocation) {
    const sub = String(invocation.rawInput ?? '').trim();
    const [head, ...rest] = sub.split(/\s+/u).filter(Boolean);
    const header = invocation.agent?.session?.header ?? {};
    const cwd = typeof header.cwd === 'string' ? header.cwd : '';

    if (head === 'identity') {
      const action = rest[0] ?? 'show';
      const file = identityFileFor(cwd);
      if (action === 'path') {
        return {
          kind: 'success',
          text: file || '当前工作区没有独立身份文件；使用 /memory identity import 导入模板，或关闭人格按工作区隔离。',
        };
      }
      if (action === 'import') {
        if (!cfg.personaWorkspaceScoped) {
          return { kind: 'error', text: '当前是全局人格模式，不需要导入；直接使用 identityFile 即可。' };
        }
        if (!file) return { kind: 'error', text: '当前会话没有工作目录，无法导入身份文件。' };
        if (!cfg.identityFile) return { kind: 'error', text: '未配置身份模板 identityFile，无法导入。' };
        try {
          const source = await readFile(cfg.identityFile, 'utf8');
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, source, 'utf8');
          return { kind: 'success', text: `已导入身份模板到当前工作区：${file}` };
        } catch (error) {
          return { kind: 'error', text: `导入身份文件失败：${String(error)}` };
        }
      }
      if (action === 'show') {
        const identity = await readIdentity(file);
        if (identity) {
          return {
            kind: 'success',
            text: `身份层（order ${IDENTITY_ORDER}）\n文件：${file}\n\n${identity}`,
          };
        }
        return {
          kind: 'success',
          text: cfg.personaWorkspaceScoped
            ? `当前工作区尚未导入身份文件：${file || '(无工作目录)'}\n使用 /memory identity import 从模板复制。`
            : (cfg.identityFile
              ? `身份文件已配置，但没有解析到有效内容：${cfg.identityFile}`
              : '未配置身份文件。可在插件设置页填写 identityFile，或在 profile 配置中设置。'),
        };
      }
      return { kind: 'error', text: `未知参数「${action}」。用法：/memory identity [show|path|import]` };
    }

    if (head === 'persona') {
      const action = rest[0] ?? 'status';
      const root = personaRootFor(cwd);
      if (!root) return { kind: 'error', text: '人格按工作区隔离时需要当前会话的工作目录。' };
      const current = await readPersonaText(root);
      const versions = await listPersonaVersions(root);
      if (action === 'status') {
        return {
          kind: 'success',
          text: [
            `人格记忆（${cfg.personaWorkspaceScoped ? '按工作区隔离' : '全局'}）`,
            `人格目录：${root}`,
            `当前摘要：${join(root, 'current.md')}`,
            `大小：${current.length}/${cfg.personaMaxChars} 字`,
            `版本数：${versions.length}（保留最近 ${cfg.personaKeepVersions} 个）`,
            `身份文件：${identityFileFor(cwd) || '未设置'}`,
            '',
            current ? `摘要预览：${clip(current.replace(/\n/gu, ' '), 300)}` : '尚未创建；可用 persona_save 写入。',
            '',
            '命令：/memory persona [show|versions|clear]',
          ].join('\n'),
        };
      }
      if (action === 'show') {
        return {
          kind: 'success',
          text: current
            ? `人格记忆（${current.length}/${cfg.personaMaxChars} 字）\n目录：${root}\n\n${current}`
            : '尚无当前工作区的人格摘要。用 persona_save 写入。',
        };
      }
      if (action === 'versions') {
        return {
          kind: 'success',
          text: versions.length > 0
            ? `人格版本（${versions.length}）\n${versions.join('\n')}`
            : '尚无人格版本。',
        };
      }
      if (action === 'clear') {
        await clearPersona(root);
        return { kind: 'success', text: '已清除当前工作区的人格记忆（current + versions）。身份文件未受影响。' };
      }
      return { kind: 'error', text: `未知参数「${action}」。用法：/memory persona [show|versions|clear]` };
    }

    if (head === 'workspaces') {
      if (!cfg.crossWorkspaceEnabled) {
        return { kind: 'error', text: '跨工作区读取未启用；请先在插件设置中勾选「允许跨工作区读取工作记录」。' };
      }
      const workspaces = await loadOtherWorkspaces('');
      if (workspaces.length === 0) {
        return { kind: 'success', text: '还没有可读取的其他工作区工作记录。' };
      }
      const lines = [
        `其他工作区（只含工作事实，不含人格/身份；共 ${workspaces.length} 个）`,
        '',
      ];
      for (const workspace of workspaces) {
        const latest = workspace.records[0];
        lines.push(`- ${workspace.cwd}`);
        lines.push(`  更新：${stamp(workspace.updatedAt)} · 会话数：${workspace.records.length} · 最近：${latest?.title || latest?.id || '(无标题)'}`);
      }
      return { kind: 'success', text: lines.join('\n') };
    }

    if (head === 'cross') {
      if (!cfg.crossWorkspaceEnabled) {
        return { kind: 'error', text: '跨工作区读取未启用；请先在插件设置中勾选「允许跨工作区读取工作记录」。' };
      }
      const query = rest.join(' ').trim().toLowerCase();
      if (!query) return { kind: 'error', text: '用法：/memory cross <关键词>' };
      const workspaces = await loadOtherWorkspaces('');
      const hits = [];
      for (const workspace of workspaces) {
        for (const record of workspace.records) {
          const digest = record.digest ?? '';
          const haystack = `${record.title ?? ''}\n${digest}\n${(record.notes ?? []).map((note) => note.text).join('\n')}`.toLowerCase();
          if (!haystack.includes(query)) continue;
          const at = digest.toLowerCase().indexOf(query);
          const excerpt = at >= 0 ? digest.slice(Math.max(0, at - 150), at + 300) : digest.slice(0, 300);
          hits.push({ workspace: workspace.cwd, record, excerpt });
        }
      }
      hits.sort((a, b) => (b.record.updatedAt ?? 0) - (a.record.updatedAt ?? 0));
      if (hits.length === 0) return { kind: 'success', text: `没有在其他工作区找到「${query}」。` };
      const lines = [`跨工作区检索「${query}」：${hits.length} 条`, ''];
      for (const hit of hits.slice(0, 5)) {
        lines.push(`[${hit.workspace} · ${hit.record.id} · ${stamp(hit.record.updatedAt)}]`);
        lines.push(hit.excerpt);
        lines.push('');
      }
      return { kind: 'success', text: lines.join('\n') };
    }

    if (typeof header.cwd !== 'string' || header.cwd.length === 0) {
      return { kind: 'error', text: '当前会话没有工作目录，无法使用工作记忆。' };
    }
    const workspace = await loadWorkspace(header.cwd);
    const habitPath = join(habitDirectory(), `${workspace.key}.1.txt`);
    const previousHabitPath = join(habitDirectory(), `${workspace.key}.2.txt`);
    const currentEntry = entries.get(invocation.agent.id) ?? ensureEntry(invocation.agent.session, true);
    if (currentEntry) mergeStoredNotes(currentEntry, workspace.data.sessions[invocation.agent.id]);

    if (head === 'todo') {
      const records = collectRecords(workspace, invocation.agent.id, true);
      const lines = ['未完成事项（当前工作区）'];
      let count = 0;
      for (const record of records) {
        for (const item of record.openItems ?? []) {
          if (!isMemoryActive(item)) continue;
          if (item.status !== 'open' && item.status !== 'blocked') continue;
          count += 1;
          lines.push(`- [${item.status === 'blocked' ? '阻塞' : '未完成'}] ${item.text}`);
          if (item.why) lines.push(`  为什么：${item.why}`);
          lines.push(`  id: ${item.id} · 会话 ${record.id} · ${stamp(item.time)}`);
        }
      }
      if (count === 0) return { kind: 'success', text: '当前工作区没有未完成事项。' };
      lines.push('', '完成：/memory resolve <id>；钉住：/memory pin <id>');
      return { kind: 'success', text: lines.join('\n') };
    }

    if (head === 'pins') {
      const pinned = (currentEntry?.notes ?? []).filter((note) => note.pinned && isMemoryActive(note));
      if (pinned.length === 0) return { kind: 'success', text: '当前会话没有钉住的要点。' };
      return {
        kind: 'success',
        text: ['钉住的要点（当前会话）', ...pinned.map((note) => `- ${note.text}\n  id: ${note.id}${note.why ? ` · 为什么：${note.why}` : ''}`)].join('\n'),
      };
    }

    if (head === 'pin' || head === 'unpin') {
      const id = rest[0] ?? '';
      if (!id) return { kind: 'error', text: `用法：/memory ${head} <id>` };
      if (!currentEntry) return { kind: 'error', text: '当前会话没有可编辑的记忆。' };
      const found = findMemoryItem(currentEntry, id);
      if (!found) return { kind: 'error', text: `当前会话未找到条目 ${id}；先运行 /memory show 或 /memory todo 查看 id。` };
      const pinned = head === 'pin';
      if (found.kind === 'note') found.note.pinned = pinned;
      else found.item.pinned = pinned;
      currentEntry.updatedAt = Date.now();
      await saveEntry(currentEntry);
      return { kind: 'success', text: `${pinned ? '已钉住' : '已取消钉住'} ${id}。` };
    }

    if (head === 'forget') {
      const id = rest[0] ?? '';
      if (!id) return { kind: 'error', text: '用法：/memory forget <id>' };
      if (!currentEntry) return { kind: 'error', text: '当前会话没有可编辑的记忆。' };
      const found = findMemoryItem(currentEntry, id);
      if (!found) return { kind: 'error', text: `当前会话未找到条目 ${id}。` };
      if (found.kind === 'note') {
        found.note.deleted = true;
        found.note.deletedAt = Date.now();
      } else {
        found.item.deleted = true;
        found.item.deletedAt = Date.now();
      }
      currentEntry.updatedAt = Date.now();
      await saveEntry(currentEntry);
      return { kind: 'success', text: `已永久删除 ${id}。` };
    }

    if (head === 'resolve') {
      const id = rest[0] ?? '';
      if (!id) return { kind: 'error', text: '用法：/memory resolve <id>' };
      if (!currentEntry) return { kind: 'error', text: '当前会话没有可编辑的记忆。' };
      const found = findMemoryItem(currentEntry, id);
      if (!found || found.kind !== 'todo') return { kind: 'error', text: `当前会话未找到未完成事项 ${id}。` };
      found.item.status = 'done';
      found.item.resolvedAt = Date.now();
      currentEntry.openItems = capOpenItems(currentEntry.openItems ?? [], cfg.maxOpenItems);
      currentEntry.updatedAt = Date.now();
      await saveEntry(currentEntry);
      return { kind: 'success', text: `已完成并标记未完成事项 ${id}。` };
    }

    if (!head || head === 'status') {
      const all = collectRecords(workspace, invocation.agent.id, true);
      const habitText = cfg.habitsEnabled ? await readHabitFile(header.cwd) : '';
      const personaRoot = personaRootFor(header.cwd);
      const identityPath = identityFileFor(header.cwd);
      const identity = await readIdentity(identityPath);
      const persona = personaRoot ? await readPersonaText(personaRoot) : '';
      const personaVersions = personaRoot ? await listPersonaVersions(personaRoot) : [];
      const lines = [
        '会话记忆与人格（本地）',
        `人格隔离：${cfg.personaWorkspaceScoped ? '按工作区（每个任务区独立）' : '全局（所有任务区共享）'}`,
        `身份文件：${identityPath || '未设置（该工作区无身份）'}`,
        `身份模板：${cfg.identityFile || '未设置（/memory identity import 不可用）'}`,
        `身份层：${identity ? `已启用（${identity.length} 字，order ${IDENTITY_ORDER}）` : '未启用'}`,
        `人格目录：${personaRoot || '未设置'}`,
        `人格摘要：${persona ? `${persona.length}/${cfg.personaMaxChars} 字` : '未创建'}`,
        `人格版本：${personaVersions.length}（保留最近 ${cfg.personaKeepVersions} 个）`,
        `工作目录：${resolve(header.cwd)}`,
        `工作存储：${cfg.directory}`,
        `记录文件：${workspace.file}`,
        `保留策略：${cfg.maxAgeDays} 天 / 最多 ${cfg.maxSessions} 个会话`,
        `压缩策略：每次接入 ${cfg.maxChars} 字以内，接入最近 ${cfg.attachSessions} 个会话`,
        `跨工作区读取：${cfg.crossWorkspaceEnabled ? '已开启' : '已关闭'}`,
        `跨工作区自动注入：${cfg.crossWorkspaceAttach ? '已开启' : '已关闭'}（只含工作事实，order ${CROSS_ORDER}）`,
        `交互习惯：${cfg.habitsEnabled ? '已开启' : '已关闭'}（最多保留 2 份）`,
        `习惯文件：${habitPath}`,
        `习惯备份：${previousHabitPath}`,
        `记录数：${all.length}`,
        `要点数：${currentEntry?.notes.length ?? 0}（钉住 ${currentEntry?.notes.filter((note) => note.pinned).length ?? 0}）`,
        `未完成事项：${(currentEntry?.openItems ?? []).filter((item) => isMemoryActive(item) && (item.status === 'open' || item.status === 'blocked')).length}`,
      ];
      if (habitText) {
        lines.push('', '最新交互习惯：', clip(habitText.replace(/\n/gu, ' '), 240));
      }
      if (all.length > 0) {
        lines.push('', '最近记录：');
        for (const record of all.slice(0, 5)) {
          const chars = record.stats?.digestChars ?? (record.digest?.length ?? 0);
          lines.push(`- ${record.id} · ${stamp(record.updatedAt)} · ${chars} 字${record.title ? ` · ${record.title}` : ''}`);
        }
      } else {
        lines.push('', '尚无事实记录。每次回合结束都会自动更新本会话的压缩记忆。');
      }
      lines.push('', `命令：${USAGE}`);
      return { kind: 'success', text: lines.join('\n') };
    }

    if (head === 'show') {
      const all = collectRecords(workspace, invocation.agent.id, true);
      const latest = all[0];
      const habitText = cfg.habitsEnabled ? await readHabitFile(header.cwd) : '';
      const personaRoot = personaRootFor(header.cwd);
      const identity = await readIdentity(identityFileFor(header.cwd));
      const persona = personaRoot ? await readPersonaText(personaRoot) : '';
      const chunks = [];
      if (identity) chunks.push(identity);
      if (persona) chunks.push(personaSectionText(persona));
      if (habitText) chunks.push(habitsSectionText(habitText));
      if (latest) {
        const digest = latest.digest ?? buildDigest(latest, cfg);
        chunks.push(factsSectionText(`### 会话 ${latest.id}（更新于 ${stamp(latest.updatedAt)}）\n${digest}`));
      }
      if (cfg.crossWorkspaceEnabled && cfg.crossWorkspaceAttach) {
        const cross = renderCrossWorkspace(await loadOtherWorkspaces(workspace.key));
        if (cross) chunks.push(cross);
      }
      return { kind: 'success', text: chunks.length > 0 ? chunks.join('\n\n---\n\n') : '暂无会话记忆。' };
    }

    if (head === 'path') {
      return { kind: 'success', text: workspace.file };
    }

    if (head === 'preview') {
      const all = collectRecords(workspace, invocation.agent.id, true)
        .filter((record) => (record.digest ?? '').trim().length > 0)
        .slice(0, cfg.attachSessions);
      const facts = renderFacts(all);
      const habitText = cfg.habitsEnabled ? await readHabitFile(header.cwd) : '';
      const personaRoot = personaRootFor(header.cwd);
      const identity = await readIdentity(identityFileFor(header.cwd));
      const persona = personaRoot ? await readPersonaText(personaRoot) : '';
      const chunks = [];
      if (identity) chunks.push(identity);
      if (persona) chunks.push(personaSectionText(persona));
      if (habitText) chunks.push(habitsSectionText(habitText));
      if (facts) chunks.push(factsSectionText(facts));
      if (cfg.crossWorkspaceEnabled && cfg.crossWorkspaceAttach) {
        const cross = renderCrossWorkspace(await loadOtherWorkspaces(workspace.key));
        if (cross) chunks.push(cross);
      }
      return {
        kind: 'success',
        text: chunks.length > 0
          ? `以下内容将按此顺序注入：身份（${IDENTITY_ORDER}）→ 人格（${PERSONA_ORDER}）→ 交互习惯（${HABITS_ORDER}）→ 会话事实（${FACTS_ORDER}）→ 其他工作区（${CROSS_ORDER}）。\n\n${chunks.join('\n\n---\n\n')}`
          : '当前没有可接入的记忆。',
      };
    }

    if (head === 'clear') {
      workspace.data.sessions = {};
      workspace.data.updatedAt = Date.now();
      await queueWrite(workspace);
      for (const entry of entries.values()) {
        if (entry.cwdKey === workspace.key) {
          entry.notes = [];
          entry.openItems = [];
        }
      }
      return { kind: 'success', text: '已清除该工作目录保存的会话事实；当前会话之后的回合会重新开始记录。交互习惯未受影响，使用 /memory habits clear 清除。' };
    }

    if (head === 'habits') {
      const action = rest[0] ?? 'show';
      if (action === 'on' || action === 'off') {
        const next = action === 'on';
        const where = await setHabitsEnabled(next);
        return {
          kind: 'success',
          text: `交互习惯已${next ? '开启' : '关闭'}（${where === 'persisted' ? '已写入配置' : '仅当前运行期生效'}）。${next ? '下次压缩会继续更新习惯文件。' : '不再生成或注入习惯，已有文件保留。'}`,
        };
      }
      if (action === 'clear') {
        let removed = 0;
        for (const path of [habitPath, previousHabitPath]) {
          try {
            await rm(path, { force: true });
            removed += 1;
          } catch {
            /* ignore */
          }
        }
        return { kind: 'success', text: '已清除该工作目录的交互习惯文件（不存在则跳过）。' };
      }
      if (action === 'show') {
        const habitText = await readHabitFile(header.cwd);
        if (!habitText) return { kind: 'success', text: '暂无交互习惯记录。' };
        return {
          kind: 'success',
          text: `交互习惯（${cfg.habitsEnabled ? '开启' : '关闭'}）\n文件：${habitPath}\n\n${habitText}`,
        };
      }
      return { kind: 'error', text: `未知参数「${action}」。用法：/memory habits [on|off|show|clear]` };
    }

    return { kind: 'error', text: `未知参数「${head}」。用法：${USAGE}` };
  }

  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.effect(() => commandCtx.commands.register({
      name: 'memory',
      description: '查看、预览或清除本地工作记忆、待办、钉住要点、交互习惯、身份层与人格记忆，并可按需读取其他工作区的工作记录',
      input: { hint: '[status|show|path|preview|clear|todo|pins|pin <id>|unpin <id>|forget <id>|resolve <id>|habits [on|off|show|clear]|identity [show|path|import]|persona [show|versions|clear]|workspaces|cross <query>]' },
      handler: memoryCommand,
    }));
  });

  // Seed sessions that were already live when this plugin mounted (first install
  // or HMR reload), so their current conversation is captured at the next turn.
  // Also repair agents created before this plugin was in their scope (notably
  // persistent QQ agents resumed by dsh-onebot): agent/created may have fired
  // before this listener existed.
  try {
    for (const agent of ctx.agents.roots()) {
      void ensureAgentSections(agent).catch((error) => {
        report(`初始化已有代理人格失败 ${agent?.id}: ${String(error)}`);
      });
    }
  } catch (error) {
    report(`扫描已有代理失败: ${String(error)}`);
  }
  try {
    for (const session of ctx.sessions.list()) {
      const entry = ensureEntry(session, true);
      if (entry) void saveEntry(entry);
    }
  } catch (error) {
    report(`初始化已有会话失败: ${String(error)}`);
  }
}
