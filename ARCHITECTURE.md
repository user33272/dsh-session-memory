# 会话记忆（Session Memory）插件架构

适用版本：**1.9.2**
源码目录：`<repo>`
配套文档：[USAGE.md](USAGE.md)（怎么用）、[README.md](README.md)（配置速查）

---

## 0. 一句话概括

这是一个 **Cordis 双半插件**：

- **Host 半**（Node）负责记录会话、压缩事实、归纳习惯、按工作区读取身份 INI、管理有上限的人格记忆、写本地文件、在下一个会话注入 system prompt；
- **Client 半**（浏览器）只负责在 Plugins 页面渲染设置表单，把「身份模板 / 人格隔离 / 人格目录 / 工作目录 / 习惯开关」写回 profile 配置。

两者通过 **同一个包名** `dsh-session-memory` 绑定：`package.json` 的 `dsh.bundle.patch` 挂 Host 行，`dsh.client` 挂浏览器模块。

---

## 1. 运行位置与文件组成

```
<repo>\
  package.json          # 双半声明：bundle patch + client + exports
  cordis.patch.yml      # 向 profile 插入 session-memory 这一行
  index.js              # Host 半（Cordis 插件）
  memory.js             # 工作摘要/要点/待办/钉住的纯函数
  identity.js           # INI 解析与身份层渲染（纯函数）
  persona.js            # 人格记忆读写、版本化、裁剪（纯文件操作）
  client.js             # Client 半（浏览器模块）
  examples/             # identity.example.ini / persona.example.md
  test/                 # identity.test.mjs / persona.test.mjs / memory.test.mjs
  locale/en.json        # 插件显示名/描述（英文）
  locale/zh.json        # 插件显示名/描述（中文）
  icon.svg              # 插件图标
  README.md             # 配置速查
  USAGE.md              # 使用文档
  ARCHITECTURE.md       # 本文
```

安装后，profile 里多出：

```
<DSH_HOME>\profiles\<profile>\
  node_modules\dsh-session-memory\      # 打包安装后的真实目录
  cordis.patch.yml                      # 可能写入 identityFile / personaWorkspaceScoped / personaDirectory / directory / habitsEnabled 覆盖
```

Host 行在 Loader 中的身份：

| 字段 | 值 |
|---|---|
| 包名 / moduleName | `dsh-session-memory` |
| patch id / rowId | `session-memory` |
| Loader entryId | `include:session-memory` |
| 配置命名空间（settings ns） | 通常为 `include:session-memory`（以 `settings.describe` 的 `ns` 为准） |

> 最后两行的差异，正是设置页 `form` 需要兜底解析的原因。

---

## 2. 总体架构图

```
┌──────────────────────────── DSH Host（Node / Cordis）────────────────────────────┐
│                                                                                  │
│  session/event ──► ingest() ──► entries（内存态：items/goals/notes/style）        │
│                                                                                  │
│  turn/end ───────► saveEntry() ──┬─► <work>/<workspaceKey>.json   （事实）        │
│                                  └─► <work>/habits/<key>.1/.2.txt （习惯）        │
│                                                                                  │
│  persona_save ───► <persona>/current.md + versions/（有上限、迭代）                │
│                                                                                  │
│  agent/created ──► attachIdentity() ──► order 100：身份（INI）                     │
│     (root agents)  attachPersona()  ──► order 150：人格记忆（current.md）          │
│                    attachMemory()   ──► order 280 习惯 / 300 事实 / 310 其他工作区（可选）│
│                                                                                  │
│  tools：persona_save / memory_save / memory_recall   commands：/memory ...         │
│                                                                                  │
└───────────────────────────────┬──────────────────────────────────────────────────┘
                                │ profile 配置（identityFile、personaDirectory、directory、habitsEnabled）
┌───────────────────────────────▼──────────── DSH Web Client（浏览器）──────────────┐
│  client.js                                                                        │
│    └─ plugins.row.config（两个候选 key） ─┐                                        │
│    └─ plugins.item（include:session-memory）─┤─► SessionMemoryPage               │
│                                             └─► form / configForms ─► 保存配置    │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 一次回合发生了什么

```
用户消息
  └─ session/event: user/message
       └─ ingest()
            ├─ entry.items.push({role:'user', text, time})
            ├─ entry.goals.push(本回合第一条用户消息)
            └─ noteUserText()：语言比例、长度、明确要求句式

助手消息
  └─ session/event: assistant/message
       ├─ entry.items.push({role:'assistant', ...})
       └─ noteAssistantText()：标题/列表/代码块/表格计数

工具调用
  └─ session/event: tool/call
       ├─ entry.items.push({role:'tool', text:'read <path>' ...})
       └─ noteToolCall()：工具次数、先读后改、命令验证、todo、确认提问

回合结束
  └─ session/event: turn/end
       └─ saveEntry()
            ├─ 合并历史 notes（防止重载丢失）
            ├─ buildDigest()      → 事实摘要
            ├─ writeHabitFile()   → 规则归纳习惯，最多两份 txt
            └─ queueWrite()       → 跨进程锁 + 读-合并-写 + rename

根代理 agent/created
  ├─ attachIdentity()
  │    ├─ readFile(identityFile) → parseIni() → buildIdentityText()
  │    └─ systemPrompt.section({name:'context-memory:identity', order:100})
  ├─ attachPersona()
  │    ├─ readPersona(personaDirectory) → current.md
  │    └─ systemPrompt.section({name:'context-memory:persona', order:150})
  └─ attachMemory()（仅 startup / clear）
       ├─ readHabitFile()  → 读 .1.txt（缺失回退 .2.txt）
       ├─ renderFacts()    → 最近会话的 digest
       └─ agent.ctx.systemPrompt.section()
            ├─ order 280：交互习惯
            └─ order 300：会话事实
```

---

## 4. Host 半（`index.js`）分层

### 4.1 声明层

```js
export const name = 'session-memory';
export const inject = ['systemPrompt', 'tools', 'sessions'];
export const Config = z.object({ ... });
export function apply(ctx, config) { ... }
```

- `inject` 表示这三个 Host 服务必须存在，否则插件不激活；
- `Config` 由 `@deepseek-ai/schemastery` 构造，Loader 用它校验 profile 配置，设置页也用它生成表单字段；
- `apply` 是唯一入口，所有监听、工具、命令都注册在它里面，随插件卸载一起销毁。

### 4.2 配置层

```
readConfig(raw)
  ├─ directory：空 → $DSH_HOME/context-memory
  ├─ autoAttach / maxChars / maxAgeDays / maxItems / ...
  ├─ habitsEnabled / habitsMaxChars
  └─ 全部做范围钳制（clampInt / clampNum）
```

配置来源优先级：profile 的 `cordis.patch.yml` 覆盖行 > 包内 `cordis.patch.yml` 默认行 > 代码默认值。

### 4.3 内存态

```
entries: Map<sessionId, entry>

entry = {
  id, cwd, cwdKey, title,
  createdAt, updatedAt, turns,
  items:  [{role, text, time}],   // 最近对话/工具摘要
  goals:  [第一条用户消息...],      // 早期目标
  notes:  [{id, text, why, tags, time, pinned, expiresAt, supersededBy, deleted}], // memory_save 要点
  openItems: [{id, text, why, status, time, pinned, expiresAt, supersededBy}],     // 待办/阻塞
  style:  {语言/格式/工具/明确要求计数},
  lastSeq, seeded, turnOpen
}
```

`ensureEntry(session, seed)`：

- 跳过子代理（`origin === 'subagent'` 或 `delegationDepth > 0`）；
- 第一次创建时按 `session.snapshotEvents()` 回放（用于 resume / 插件重载）；
- `lastSeq` 做事件去重，避免回放与实时重复。

### 4.4 记录与压缩

| 函数 | 作用 |
|---|---|
| `ingest(entry, event)` | 单个会话事件 → 更新 items/goals/style |
| `noteUserText` | 用户语言比例、长度、明确要求句式 |
| `noteAssistantText` | 助手标题/列表/代码块/表格统计 |
| `noteToolCall` | 工具次数、先读后改、命令验证、todo、确认 |
| `buildDigest(record, cfg)` | 事实摘要：钉住要点 → 未完成事项 → 普通要点 → 早期目标 → 最近对话 → 最近工具 |
| `toRecord(entry, cfg)` | 生成持久化记录（含 digest/stats） |

压缩策略：

- 事实摘要上限 `maxChars`（默认 3000）是**硬上限**；
- 钉住段有 45% 总预算，未完成事项 30%，普通要点 20%，目标 15%，其余给对话/工具；超了按 why → tags → 正文截断；
- 对话优先于工具；工具最多保留最近 12 条；
- `notes` 优先放在摘要最前面；未完成事项单独成段；
- 过期/被取代/已删除条目不再进入摘要和召回；摘要只留一行“已过时/已被取代”计数；
- 含钉住/待办/阻塞的记录不会被 `maxAgeDays` / `maxSessions` 普通裁剪删除；

### 4.5 交互习惯

```
note*() 收集 style
  └─ buildHabitSummary(entry, cfg)
       ├─ 语言：CJK/拉丁比例
       ├─ 表达：标题/列表/代码块/表格
       ├─ 工作流：先读后改、命令验证、todo、常用工具
       ├─ 交互：确认提问次数
       └─ 明确要求：正则抽取“以后/不要/记住/务必...”
```

文件规则：

```
readHabitFile(cwd)   → 先 .1.txt，缺失再 .2.txt
writeHabitFile(ws, entry)
  ├─ 新内容与 .1.txt 正文相同 → 跳过
  ├─ 旧 .1.txt → 覆盖 .2.txt
  └─ 新内容 → .1.txt
```

因此最多两份，且只在内容变化时轮换。习惯正文上限 `habitsMaxChars`（默认 600）。

### 4.6 持久化

```
loadWorkspace(cwd)
  ├─ workspaceKey = sha1(normalize(cwd)).slice(0,16)
  ├─ 文件：<root>/<workspaceKey>.json
  ├─ 缓存：Map<key, {data, ready, queue}>
  └─ 解析失败/版本不符 → 先备份为 `.corrupt-<时间戳>`；备份失败则阻止覆盖

saveEntry(entry)
  ├─ hydrateEntry(entry, workspace)：把工作区 memory 合并进 live entry（防止 turn/end 清空库）
  ├─ 更新 workspace.memory.notes / openItems（保留墓碑）
  ├─ workspace.sessions[entry.id] = toRecord(entry, cfg, memory)
  ├─ prune()：按 maxAgeDays / maxSessions 清理
  ├─ queueWrite()：获取跨进程 `.lock`，读-合并-写（memory 按 id 并集）；临时文件 + rename
  └─ writeHabitFile()

collectRecords(ws, selfId, includeSelf)
  └─ 合并“持久化记录”与“当前 live entries”，按 updatedAt 倒序
```

写入是**进程内串行队列 + 跨进程文件锁**：拿到 `<key>.json.lock` 后重读磁盘、按 session updatedAt 合并、再原子写；`saveEntry` 会 await，失败向上抛，不再静默。

### 4.7 恢复与注入

```
根代理 agent/created
  ├─ attachIdentity()（所有根代理，含 resume）
  │    ├─ identityFileFor(cwd) → <persona>/workspaces/<key>/identity.ini
  │    ├─ identityFromText(text, identityMaxChars)
  │    └─ systemPrompt.section({name:'context-memory:identity', order:100})
  ├─ attachPersona()（所有根代理，含 resume）
  │    ├─ readPersona(personaRootFor(cwd)) → current.md
  │    └─ systemPrompt.section({name:'context-memory:persona', order:150})
  └─ attachMemory()（仅 startup / clear）
       ├─ 读同 cwd 最近的 records（默认 1 个）
       ├─ 读 habits/.1.txt
       ├─ systemPrompt.section({name:'context-memory:habits', order:280})
       ├─ systemPrompt.section({name:'context-memory:carryover', order:300})
       └─ attachCrossWorkspace()（可选，order:310，只读其他工作区工作事实）
```

`renderPrompt` 按 order 拼接：身份 100 → 人格 150 → 习惯 280 → 事实 300 → 其他工作区 310。
`personaWorkspaceScoped: true` 时，每个 cwd 使用自己的 `identity.ini` 与 `current.md`；某个工作区缺文件就跳过，不回退到模板/其他工作区。
`resume` 的旧会话恢复当前工作区的身份 + 人格，不重复接入习惯/事实/跨工作区；子代理不参与。

**QQ/其他通道的兜底**：`dsh-onebot` 等通道可能在 `agent/created` 监听器进入作用域之前就创建/恢复了持久 Agent。插件启动时会扫描 `ctx.agents.roots()` 补挂，并在该 session 的 `session/event` 上再次懒补，确保下一轮能看到当前工作区的身份/人格；不依赖 `agent/created` 一定触发。

### 4.8 工具与命令

- `persona_save`：写当前工作区的 `personaRootFor(cwd)/current.md`，同时生成版本并裁剪旧版本；
- `memory_save`：写入当前 entry 的 `notes` 或 `openItems`（带 `why`/`pinned`/`supersedes`/`ttlDays`），并触发保存；
- `memory_pin` / `memory_resolve` / `memory_forget`：钉住、完成、删除；
- `memory_recall`：只扫描结构化 `notes`/`openItems`（默认 kind=note），关键词加权 + 时间衰减；多词查询要求至少命中 2 个词（或 60%），不检索 digest/工具调用；`includeSuperseded` 可查看被取代条目；
- `/memory` 命令：status/show/path/preview/clear/todo/pins/pin/unpin/forget/resolve/habits/identity/persona；
- `/memory habits on|off`：通过 `ctx.settings.update` 写 profile 配置，失败则只改运行期；
- `/memory identity [show|path|import]`：查看当前工作区身份，或从模板导入；
- `/memory persona [show|versions|clear]`：查看/列出/清除当前工作区人格记忆；
- `/memory workspaces`：列出其他工作区；`/memory cross <query>`：检索其他工作区工作事实；
- `memory_recall(scope:'all')`：跨工作区检索，只读工作事实，绝不读取身份/人格；
- 跨工作区允许列表：`crossWorkspaceAllowlist`（cwd 数组，空 = 不共享），设置页多选窗口选择。
- **钉住面板**：Host 只读路由 `GET /session-memory/pins` 扫描 `<work>/*.json` 的 `memory`，过滤 active+pinned，按工作区分组；只接受 loopback 请求，不读取 persona/identity，不写文件。Client 在 `sidebar.footer.action` 注册按钮，用 `ReactDOM.createPortal` 打开只读弹窗，失败/空态/非本机均有提示。

---

## 5. Client 半（`client.js`）

### 5.1 模块格式

```js
window.__ModuleLoader__.load({
  id: 'dsh-session-memory',
  factory(require) {
    const React = require('react');
    ...
    return { inject: ['slots', 'locale'], apply(ctx) { ... } };
  },
});
```

- 浏览器模块加载时只注册工厂，`apply` 在插件激活时执行；
- 所有可见文案走 `ctx.locale`；
- 样式使用 `--dsw-alias-*` 主题 token。

### 5.2 两个 UI 入口

| 槽 | key / id | 用途 |
|---|---|---|
| `plugins.row.config` | `dsh-session-memory#session-memory` | 行详情页的配置入口（patch id） |
| `plugins.row.config` | `dsh-session-memory#include:session-memory` | 同上（entry id 兜底） |
| `plugins.item` | `include:session-memory` | 「内置插件配置」里的独立入口 |

行页面的 `form` 由插件管理器按 `rowId` 查找；由于 rowId 与 settings ns 可能不一致，组件做了两层兜底：

```
props.form
  ?? props.getConfigForm()
       ├─ 从 configForms mirror 找包含 session-memory 的 ns
       ├─ configForms.get(ns)
       └─ 返回 { state, mutate(ops, revision) }
```

### 5.3 表单行为

- 读取 `state.value.directory` / `state.value.habitsEnabled`；
- 只提交发生变化的字段（`{op:'set', path:['directory'], value}`）；
- `浏览…` 调 `uiWorkspace.pickDirectory()`；
- 保存调用 `form.mutate(ops, revision)`，由设置服务写入 profile；
- 保存后配置变化会触发插件按新 `directory` 重载。

---

## 6. 数据模型

### 工作区文件（事实）

```json
{
  "version": 1,
  "cwd": "D:\\path\\to\\workspace",
  "updatedAt": 1792487171876,
  "memory": {
    "version": 1,
    "updatedAt": 0,
    "migrated": 0,
    "notes": [
      { "id": "n-...", "text": "...", "why": "...", "tags": ["..."], "kw": ["关键词", "bm25"], "sessionId": "session-xxx", "time": 0, "pinned": false }
    ],
    "openItems": [
      { "id": "t-...", "text": "...", "status": "open|blocked|done", "kw": ["..."], "sessionId": "session-xxx", "time": 0 }
    ]
  },
  "sessions": {
    "session-xxx": {
      "id": "session-xxx",
      "cwd": "D:\\path\\to\\workspace",
      "title": "首条用户消息摘要",
      "createdAt": 0,
      "updatedAt": 0,
      "turns": 4,
      "items": [{ "role": "user|assistant|tool", "text": "...", "time": 0 }],
      "goals": ["..."],
      "notes": [{ "text": "本会话自己创建的条目镜像（兼容旧版本回滚）", "tags": ["..."], "time": 0 }],
      "stats": { "rawChars": 0, "digestChars": 0, "messages": 0 },
      "digest": "### 已保存的要点 ..."
    }
  }
}
```

`memory` 是工作区级记忆库（1.8 起）：条目不再随会话记录一起被 `maxAgeDays` / `maxSessions` 剪掉，`sessionId` 只作来源标记；`kw` 是保存时抽出的检索关键词。旧文件没有 `memory` 字段时，`ensureMemoryStore()` 会从 `sessions[*].notes/openItems` 迁移一次并留下 `migrated` 计数，旧数据不删。

### 习惯文件

```
<root>/habits/<workspaceKey>.1.txt   # 最新
<root>/habits/<workspaceKey>.2.txt   # 上一次
```

内容包含：标题、更新时间、会话 id、来源 `rules`、若干条短句。

---

## 7. 关键设计决策（以及为什么）

| 决策 | 原因 |
|---|---|
| 事实与习惯**分开存储、分开注入** | 满足“隔离”；习惯可单独开关/清除，不会污染事实 |
| 身份层用**外部 INI**，只读 | 稳定设定与动态记忆分离；用户可独立编辑、版本化 |
| 身份 order 100 < 习惯 280 < 事实 300 | `renderPrompt` 按 order 拼接，保证“先身份、再习惯、后事实” |
| 身份在 **resume 也恢复** | 人格是全局的，不是一次性开场白 |
| 习惯用**规则**而不是 LLM | 零额外 token、离线、稳定；适合简短 txt |
| 只保留**两份**习惯 | 防止无限增长；内容不变不重复写 |
| 注入用 **system prompt section** 而非 user message | 每次请求都可见、顺序可控、可随 agent 生命周期销毁 |
| 身份 100 < 人格 150 < 习惯 280 < 事实 300 | `renderPrompt` 按 order 拼接，保证人格数据先于工作数据 |
| 人格与工作**目录/命令/清除分离** | 人格可独立备份/回滚，工作数据可独立清理 |
| 人格摘要**整体替换 + 版本化 + 上限** | 防止人格数据无限增长；旧版本可回滚 |
| 钉住/未完成事项跳过普通裁剪 | 用户显式保留的条目和待办不随时间/数量上限消失（但受摘要硬预算约束） |
| 记录在 `turn/end` 保存 | 回合边界稳定，不打断流式输出 |
| 写入用临时文件 + rename + 跨进程锁 | 避免半截 JSON 和多进程整文件覆盖 |
| 损坏文件先 `.corrupt` 备份 | 避免把解析失败当空数据写回，原文件丢失 |
| notes 跨重载合并 | notes 不在会话日志里，重载会丢；合并修复 |
| 记忆条目存**工作区级**而非会话级 | 会话记录会被 `maxAgeDays`/`maxSessions` 剪掉，挂在里面的“长期要点”实际上只有 14 天 |
| 召回用 **BM25 × IDF × 覆盖率 × 衰减** 而非子串 | 子串匹配换个说法就找不回；BM25 让稀有词命中的条目排前，衰减让新条目优先 |
| 关键词**写入时落盘**（`kw`） | 索引稳定、可直接人工修正、不依赖模型或分词服务 |
| 同义表 + 覆盖率系数，替代“必须命中 2 词” | 保留精度，同时不把只命中一个关键实词的查询整条丢掉 |
| 写入前去重合并 | 同一件事反复存会挤占 `maxNotes` 并稀释注意力；合并后返回 `merged:true` |
| 默认 `directory` 留空 | 用 `$DSH_HOME` 的相对默认，便于迁移 |

---

## 8. 应该怎么读这份代码

推荐顺序（约 30–60 分钟）：

### 第 1 步：先看行为，不看代码

读 [USAGE.md](USAGE.md)，回答三个问题：

1. 什么时候记录？
2. 记录到哪里？
3. 下一个会话看到什么、顺序是什么？

### 第 2 步：看安装接线

1. `package.json`：`exports`、`dsh.bundle.patch`、`dsh.client`；
2. `cordis.patch.yml`：插入了哪个 row、默认 config；
3. 理解 Host 行 → Loader → `apply`，浏览器声明 → `client.js`。

### 第 3 步：Host 入口与配置

读 `index.js` 顶部：

- `Config` 有哪些字段；
- `readConfig` 如何解析默认值；
- `inject` 为什么是这三个服务。

### 第 4 步：一条消息如何进入内存态

按调用链读：

```
ctx.on('session/event')
  → ensureEntry()
  → ingest()
  → noteUserText / noteAssistantText / noteToolCall
```

重点看 `entry` 的字段：`items`、`goals`、`notes`、`style`。

### 第 5 步：压缩

读 `buildDigest()` 和 `buildHabitSummary()`：

- 预算怎么分（notes → goals → 对话 → 工具）；
- 超出预算怎么截断；
- 习惯为什么不会包含路径/代码。

### 第 6 步：落盘

读 `saveEntry()`、`writeHabitFile()`、`queueWrite()`：

- 事实 JSON 与习惯 txt 的写入顺序；
- 两份习惯如何轮换；
- 为什么需要 `mergeStoredNotes()`。

### 第 7 步：恢复

读 `attachIdentity()`、`attachMemory()`、`collectRecords()`、`renderFacts()`：

- 为什么身份在 `agent/created` 对所有根代理执行，而习惯/事实只在 `startup/clear`；
- 三个 section 的 order 为什么是 100 / 280 / 300；
- `agent.ctx.systemPrompt.section()` 的所有权。

### 第 8 步：UI

读 `client.js`：

- `window.__ModuleLoader__.load` 的工厂格式；
- `apply` 里注册了哪些槽；
- `SessionMemoryPage` 如何从 `form`/`configForms` 取状态；
- 保存时提交了哪些字段。

### 第 9 步：用运行时验证理解

- `/memory status`：看身份/人格/工作三套路径、大小、记录数；
- `/memory identity`：看解析后的身份层；
- `/memory persona`：看人格记忆大小与版本；
- `/memory show`：看身份 + 人格 + 习惯 + 事实；
- `/memory preview`：看“下一次会话到底会注入什么、顺序如何”；
- 直接打开 `<work>/<key>.json`、`habits/<key>.1.txt`、`<persona>/current.md` 对照代码。

---

## 9. 观测与调试入口

| 想确认的事 | 方法 |
|---|---|
| 配置 schema 是否生效 | `cordis_inspect_query` → Host `Config.listConfigs`，过滤 `dsh-session-memory` |
| 工具是否注册 | `cordis_inspect_query` → Host `Tool.listTools` |
| UI 槽是否注册 | Client `Slots.listSubTree`，root `plugins.row.config` |
| 插件行是否 active | `plugin_manager list_plugins`，找 `include:session-memory` |
| 习惯文件 | 打开 `<root>/habits/<key>.1.txt` |
| 事实文件 | 打开 `<root>/<key>.json` |
| 人格文件 | 打开 `<persona>/current.md` 与 `versions/` |
| 人格写入 | 模型工具 `persona_save`，或 `/memory persona` |
| 注入内容 | `/memory preview` |
| 日志 | Host 日志中以 `session-memory:` 开头的 warn |

---

## 10. 常见改动点（维护者速查）

| 想改什么 | 改哪里 |
|---|---|
| 增加配置项 | `Config` schema + `readConfig` + 客户端表单（可选） |
| 调整事实压缩 | `memory.js` 的 `buildDigest` / `capNotes` / `capOpenItems` |
| 调整习惯规则 | `noteUserText` / `noteAssistantText` / `noteToolCall` / `buildHabitSummary` |
| 改习惯保留份数 | `writeHabitFile`（当前固定 2） |
| 改存储路径/格式 | `loadWorkspace` / `saveEntry` / `queueWrite` |
| 改注入顺序 | `IDENTITY_ORDER` / `PERSONA_ORDER` / `HABITS_ORDER` / `FACTS_ORDER` 与 `attachIdentity` / `attachPersona` / `attachMemory` |
| 改身份解析/渲染 | `identity.js` 的 `parseIni` / `buildIdentityText` |
| 改人格存储/版本化 | `persona.js` 的 `readPersona` / `writePersona` / `listPersonaVersions` / `clearPersona` |
| 加模型工具 | `ctx.tools.register` |
| 加命令 | `ctx.commands.register` |
| 改设置页 | `client.js` 的 `SessionMemoryPage` 与槽注册 |
| 改显示名/描述 | `locale/en.json`、`locale/zh.json` |

> 当前是 **tgz 安装**（非 link）。改完源码后需要：
> `pnpm pack` → `plugin_manager remove_bundle` → `install_bundle <tgz>` → 重启 DSH。
> Host 与 Client 的 JS 都有模块代际缓存，单纯刷新页面不够。

---

## 11. 边界与限制

- 身份层是规则解析的静态设定，不会让模型获得文件之外的真实记忆；
- 人格记忆是**有上限的迭代摘要**（`personaMaxChars`），旧版本只保留最近 `personaKeepVersions` 个，不是完整自传；
- 习惯是规则推断，不调用模型，不能理解复杂偏好；
- 事实摘要按窗口滚动，早期内容会被省略（保留早期目标和最近对话）；
- 习惯只注入最新一份，`.2.txt` 仅作备份/回退；
- 更改身份/人格/工作目录都不迁移旧数据；
- 浏览器半在安装/升级后需要重启 DSH 才能加载；
- 子代理会话完全跳过；`resume` 恢复身份 + 人格，不重复习惯/事实。

---

## 12. 术语表

| 术语 | 含义 |
|---|---|
| Cordis | DSH 的插件/服务框架；`apply(ctx, config)` 是插件入口 |
| Loader | 读取 profile 的 YAML/JSON 行，实例化插件的组件 |
| bundle patch | 包里声明如何向 profile 插入行（`dsh.bundle.patch`） |
| row / entryId | Loader 中的一行；本插件 rowId=`session-memory`，entryId=`include:session-memory` |
| profile | 当前桌面配置目录 `<DSH_HOME>\profiles\<profile>` |
| workspaceKey | `sha1(规范化 cwd)` 前 16 位，用于按工作区分文件 |
| system prompt section | 每次模型请求都会组装的系统提示段落 |
| identity layer | 全局 INI 身份设定，order 100，先于人格/习惯/事实 |
| persona memory | 全局、有上限、版本化的人格/关系摘要，order 150 |
| slot | 客户端 UI 的扩展点；本插件用 `plugins.row.config` / `plugins.item` |
| configForms | 浏览器端共享的配置表单服务，按 settings ns 提供快照与写入 |
