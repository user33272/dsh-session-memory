/**
 * Integration smoke test: boot the Host half with a stub Cordis context and
 * exercise the real code paths — session recording, memory_save (dedupe),
 * memory_recall (BM25/alias), the /memory todo command, persistence, and a
 * second "process" (fresh apply) reading the same store back.
 *
 *   node scripts/integration-smoke.mjs
 *
 * Writes only under D:\test\_smoke-data (configurable via SMOKE_DIR).
 */
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, '..');
const storeDir = process.env.SMOKE_DIR ?? 'D:\\test\\_smoke-data';
const workspaceCwd = 'D:\\test';
const sessionId = 'session-smoke-1';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/** Boot the plugin against a fresh stub context; returns the handles. */
async function boot(directory) {
  const mod = await import('../index.js');
  const tools = new Map();
  const commands = new Map();
  const handlers = new Map();
  const sections = [];
  const agents = new Map();
  const liveSessions = [];

  const systemPrompt = { section: (spec) => { sections.push(spec); return () => {}; } };

  const ctx = {
    logger: { info() {}, warn() {} },
    effect(fn) { return fn(); },
    on(name, fn) {
      const list = handlers.get(name) ?? [];
      list.push(fn);
      handlers.set(name, list);
    },
    tools: { register: (tool) => tools.set(tool.name, tool) },
    get: (service) => (service === 'settings'
      ? { update: async () => 'runtime', describe: () => ({}) }
      : undefined),
    inject(_names, callback) {
      callback({ effect: ctx.effect, commands: { register: (command) => commands.set(command.name, command) } });
    },
    agents: { get: (id) => agents.get(id), roots: () => [...agents.values()] },
    sessions: { list: () => liveSessions },
  };

  mod.apply(ctx, {
    directory,
    habitsEnabled: false,
    identityFile: '',
    personaWorkspaceScoped: false,
    autoAttach: true,
    maxChars: 1200,
  });

  const session = {
    id: sessionId,
    header: { cwd: workspaceCwd, createdAt: Date.now() },
    snapshotEvents: () => [],
  };
  const agent = { id: sessionId, session, ctx: { systemPrompt } };
  agents.set(sessionId, agent);
  liveSessions.push(session);

  const emit = async (name, payload) => {
    for (const handler of handlers.get(name) ?? []) await handler(payload);
  };
  const emitSession = (event) => {
    for (const handler of handlers.get('session/event') ?? []) handler(session, event);
  };

  return { mod, tools, commands, sections, agent, session, emit, emitSession };
}

await mkdir(storeDir, { recursive: true });
for (const name of await readdir(storeDir)) {
  if (name.endsWith('.json')) {
    const { rm } = await import('node:fs/promises');
    await rm(join(storeDir, name), { force: true });
  }
}

// ---- 1st "process" -------------------------------------------------------
const first = await boot(storeDir);
await first.emit('agent/created', { agent: first.agent, source: 'startup' });

first.emitSession({ seq: 1, type: 'turn/start', time: Date.now() });
first.emitSession({
  seq: 2,
  type: 'user/message',
  time: Date.now(),
  data: { source: { kind: 'user' }, message: { content: [{ type: 'text', text: '终端跑不起来，帮我看下权限。' }] } },
});
first.emitSession({
  seq: 3,
  type: 'assistant/message',
  time: Date.now(),
  data: { message: { content: [{ type: 'text', text: '我先查 ACL。' }] } },
});
first.emitSession({ seq: 4, type: 'turn/end', time: Date.now() });
await new Promise((r) => setTimeout(r, 150));

const save = first.tools.get('memory_save');
check('memory_save 已注册', Boolean(save));
const saved = await save.execute({
  note: 'D:\\test 的 pwsh 缺少 WRITE_OWNER 权限，已用诊断脚本补 FullControl',
  why: '终端起不来',
  tags: ['sandbox', 'acl'],
  kind: 'note',
}, { agent: first.agent });
check('memory_save 返回 saved=true', saved.saved === true, `id=${saved.id}`);
check('memory_save 未标记 merged（首存）', saved.merged === false);

const recall = first.tools.get('memory_recall');
const hit = await recall.execute({ query: 'shell 权限', limit: 5 }, { agent: first.agent });
check('memory_recall 用同义词命中', hit.matches.length === 1, `score=${hit.matches[0]?.score?.toFixed(3)}`);
check('命中带覆盖率', (hit.matches[0]?.score ?? 0) > 0 && (hit.matches[0]?.id ?? '') === saved.id);

const again = await save.execute({
  note: 'D:/test 的 pwsh 缺少 WRITE_OWNER 权限，已用诊断脚本补 FullControl',
  kind: 'note',
}, { agent: first.agent });
check('重复保存被合并而非新增', again.merged === true && again.id === saved.id);
check('合并后仍有 1 条要点', again.notes === 1, `notes=${again.notes}`);

const todo = await save.execute({ note: '把 1.8 补丁应用到真实仓库', kind: 'todo', status: 'blocked' }, { agent: first.agent });
check('todo 可写入', todo.saved === true);

const command = first.commands.get('memory');
check('/memory 命令已注册', Boolean(command));
const todoList = await command.handler({ rawInput: 'todo', agent: first.agent });
check('/memory todo 列出跨会话待办', /把 1.8 补丁应用到真实仓库/u.test(todoList.text ?? ''), todoList.kind);
const pins = await command.handler({ rawInput: 'pins', agent: first.agent });
check('/memory pins 可运行', pins.kind === 'success');
const show = await command.handler({ rawInput: 'show', agent: first.agent });
check('/memory show 可运行', show.kind === 'success');

await new Promise((r) => setTimeout(r, 250));
const files = (await readdir(storeDir)).filter((name) => name.endsWith('.json'));
check('落盘生成工作区记忆文件', files.length === 1, files.join(','));
const persisted = JSON.parse(await readFile(join(storeDir, files[0]), 'utf8'));
check('文件包含 memory.notes', Array.isArray(persisted.memory?.notes) && persisted.memory.notes.length === 1);
check('记忆条目带 kw 关键词', Array.isArray(persisted.memory?.notes?.[0]?.kw) && persisted.memory.notes[0].kw.length > 0);
check('记忆条目带 sessionId 溯源', persisted.memory?.notes?.[0]?.sessionId === sessionId);
check('会话记录保留本会话镜像', Array.isArray(persisted.sessions?.[sessionId]?.notes));
check('摘要里出现待办段', /未完成事项/u.test(persisted.sessions?.[sessionId]?.digest ?? ''));
check('落盘条目已去重（1 条要点）', persisted.memory.notes.length === 1);

// ---- 2nd "process": fresh boot, same directory ---------------------------
const second = await boot(storeDir);
const recall2 = second.tools.get('memory_recall');
const fromDisk = await recall2.execute({ query: '命令行', limit: 5 }, { agent: second.agent });
check('重启后仍能按同义词召回（读盘）', fromDisk.matches.length >= 1, `hits=${fromDisk.matches.length}`);

const todo2 = await second.commands.get('memory').handler({ rawInput: 'todo', agent: second.agent });
check('重启后 /memory todo 仍能看到待办', /把 1.8 补丁应用到真实仓库/u.test(todo2.text ?? ''));

// Regression: an ordinary turn/end from a fresh entry must not overwrite the
// workspace store with that entry's (empty) notes/openItems.
second.emitSession({ seq: 1, type: 'turn/end', time: Date.now() });
await new Promise((r) => setTimeout(r, 250));
const afterFiles = (await readdir(storeDir)).filter((name) => name.endsWith('.json'));
const after = JSON.parse(await readFile(join(storeDir, afterFiles[0]), 'utf8'));
check('普通 turn/end 不清空工作区记忆', after.memory?.notes?.length >= 1, `notes=${after.memory?.notes?.length}`);
check('普通 turn/end 不清空待办', after.memory?.openItems?.length >= 1, `open=${after.memory?.openItems?.length}`);

console.log('');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
