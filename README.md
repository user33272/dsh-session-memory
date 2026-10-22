# 会话记忆（Session Memory）

本地跨会话记忆插件，按**人格数据**与**工作数据**分开存储、独立管理：

```
人格数据（按工作区隔离）                    工作数据（按工作区）
├─ <personaDir>/workspaces/<key>/           ├─ <工作区哈希>.json   事实/对话压缩
│  ├─ identity.ini（由模板导入）            └─ habits/            交互习惯 .1/.2.txt
│  ├─ current.md
│  └─ versions/ 迭代版本
└─ 注入顺序：身份 100 → 人格 150 → 习惯 280 → 事实 300 → 其他工作区 310（可选）
```

## 五层记忆

| 层 | 来源 | 存储 | 生命周期 |
|---|---|---|---|
| **身份 identity** | `identityFile` 模板导入 | 每工作区 `identity.ini` | 按工作区、稳定 |
| **人格 persona** | `workspaces/<key>/current.md` | 版本化、有上限 | 按工作区、迭代 |
| **习惯 habits** | 规则归纳，两份 txt | 工作根目录 | 按工作区 |
| **情景 episodes** | 每回合压缩的事实 JSON | 工作根目录 | 按工作区 |
| **工作 working** | 当前会话上下文 | 不持久化 | 会话内 |
| **跨工作区**（可选） | 其他工作区的**工作事实** | 只读其他 `<工作区哈希>.json` | 按需/自动 |

## 数据布局

```
<身份模板>                         # 任意路径的 INI，由 identityFile 指定；只作为导入模板
<人格目录>/                        # 默认 $DSH_HOME/persona
  workspaces/
    <工作区哈希>/
      identity.ini                 # 该工作区独立身份（由模板导入；可不同）
      current.md                   # 该工作区人格/关系摘要（≤ personaMaxChars）
      versions/                    # 该工作区迭代版本，保留最近 personaKeepVersions 个
<工作存储>/                        # 默认 $DSH_HOME/context-memory
  <工作区哈希>.json                # 事实/对话压缩（每个工作区一个）
  habits/
    <工作区哈希>.1.txt             # 最新交互习惯总结
    <工作区哈希>.2.txt             # 上一次交互习惯总结
```

- 人格数据与工作数据**路径分离、命令分离、清除分离**；
- 每个工作区有独立身份与人格；某工作区没有 `identity.ini`/`current.md` 就不注入，**不会回退到其他工作区**；
- 人格摘要用 `persona_save` 整体替换，超过 `personaMaxChars` 会被拒绝；旧版本自动保留；
- 身份模板不自动复制到新工作区；需要时用 `/memory identity import`。

## 身份层（INI，order 100）

`identityFile` 是**模板**路径。按工作区隔离时，插件只读取：

```
<人格目录>/workspaces/<工作区哈希>/identity.ini
```

- 模板不会被自动复制到其他工作区；当前工作区可用 `/memory identity import` 导入；
- 某工作区没有 `identity.ini` 时，身份层跳过，不回退到模板；
- 只解析 `[section]` + `key = value`；忽略 `#` / `;` 注释；
- `[raw]` 不参与注入；`[meta]` 只读 `version` / `updated`；
- 渲染上限 `identityMaxChars`（默认 1200）。

示例见 `examples/identity.example.ini`。

## 人格记忆（order 150）

人格记忆是**自我认知与关系**的迭代摘要，不写项目事实。

- 文件：`<人格目录>/workspaces/<工作区哈希>/current.md`；
- 注入：`context-memory:persona`，order 150，位于身份之后、习惯之前；
- 更新：模型调用 `persona_save(text)`，或手动编辑当前工作区的 `current.md`；
- 上限：`personaMaxChars`（默认 1200）；超过直接拒绝，要求先压缩；
- 版本：每次写入生成 `versions/<ISO>.md`，只保留最近 `personaKeepVersions`（默认 5）个；
- 清除：`/memory persona clear` 只清**当前工作区**的人格记忆，不影响其他工作区、身份或工作数据。

推荐内容：

```markdown
- 与 li 的关系：长期协作的搭档；称呼 li；先给结论。
- 自我要求：诚实、承认不确定、不编造未记录的经历。
- 记忆边界：只放长期自我/关系，不放项目任务或临时事实。
```

示例见 `examples/persona.example.md`。

## 工作记忆：要点、待办、钉住

- `memory_save(note, why?, tags?, kind?, status?, pinned?)`
  - `kind: 'note'`：普通要点；
  - `kind: 'todo'`：未完成事项/阻塞，摘要里单独成段；
  - `why`：一句为什么，跟着条目一起保存和注入；
  - `pinned: true`：永久钉住，压缩时跳过，不随普通上限/时间窗口淘汰。
- `memory_pin(id, pinned?)`：钉住/取消钉住；
- `memory_resolve(id)`：把待办标记为完成，不再出现在待办/摘要里；
- `memory_forget(id)`：永久删除一条测试/废弃记忆；
- `supersedes: [id]`：新条目取代旧条目，旧条目不再进入摘要/召回；
- `ttlDays`：条目过期时间；过期后不再进入摘要/召回（`pinned` 可覆盖）；
- 每个条目有稳定 id（`memory_save` 返回，`/memory show` / `/memory todo` 可查）。

召回（`memory_recall`）只查**结构化条目**（notes / openItems），不查对话、工具调用或摘要正文；默认 `kind=note`，`kind='todo'` 查待办，`kind='all'` 两者都查。关键词命中做加权，再按时间衰减排序；空查询按钉住/最近排序。

摘要结构：

```markdown
### 长期要点（钉住，跳过压缩）
- ...（为什么：...）

### 未完成事项
- [未完成/阻塞] ...（为什么：...）（id: ...）

### 已保存的要点
- ...（为什么：...）
```

摘要可能被裁剪，**只是索引**；关键事实、决定理由和当前状态以本地文件/会话日志为准。

## 跨工作区工作记录（可选）

默认关闭。开启 `crossWorkspaceEnabled` 后：

- `memory_recall(scope: 'all')` 可检索其他工作区的工作事实；
- `/memory workspaces` 列出其他工作区；
- `/memory cross <query>` 检索其他工作区；
- 设置页「选择工作区…」打开多选窗口，勾选允许共享的工作区；
- `crossWorkspaceAttach` 开启时，新会话在事实之后（order **310**）自动注入最近的其他工作区工作记录。

选区语义：`crossWorkspaceAllowlist` 为空 = **不共享任何其他工作区**；非空 = 只允许列出的工作区。

隐私边界：跨工作区只读取 `<工作存储>/*.json` 中的工作事实，**绝不读取**身份文件或 `<personaDirectory>`；人格记忆不会被复制进工作文件，也不会出现在跨工作区结果里。工作事实本身可能包含项目敏感信息，开启前请确认。

上限：`crossWorkspaceMaxChars`（默认 1500）、`crossWorkspaceSessions`（默认 3）。

## 恢复顺序

根代理创建时（含 `resume`）：

1. **身份**（order 100，若配置）；
2. **人格记忆**（order 150，若存在）；
3. **交互习惯**（order 280，仅 `startup` / `clear`）；
4. **会话事实**（order 300，仅 `startup` / `clear`）；
5. **其他工作区工作记录**（order 310，可选，仅 `startup` / `clear`）。

`resume` 只恢复身份 + 人格；子代理不参与。

## 界面

**Plugins → Session Memory → 行内 Configure**（或 **内置插件配置**）页面：

- **身份 INI 模板**：导入来源，不会自动共享；
- **人格按工作区隔离**：勾选后每个工作区独立 `identity.ini` + `current.md`；
- **人格目录**：`workspaces/<工作区哈希>/` 的位置；
- **工作存储目录**：事实 JSON 与习惯 txt 的位置；
- **跨工作区**：允许读取其他工作区 / 自动注入 / **选择工作区…**（多选窗口）；
- **归纳交互习惯**：开关；
- **保存**：写入 profile 配置。

身份、人格、工作三个路径互相独立；改目录不迁移旧数据。

## 命令

- `/memory`、`/memory status`：身份 / 人格 / 工作三套路径、大小、记录数；
- `/memory show`：身份 → 人格 → 习惯 → 最近事实；
- `/memory preview`：打印下次注入的完整顺序；
- `/memory path`：工作记录文件路径；
- `/memory clear`：只清该工作区的事实、要点与待办；
- `/memory todo`：列出当前工作区未完成事项（带 id）；
- `/memory pins`：列出当前会话钉住的要点；
- `/memory pin <id>` / `/memory unpin <id>`：钉住/取消钉住；
- `/memory forget <id>`：永久删除测试/废弃条目；
- `/memory resolve <id>`：完成一条待办；
- `/memory habits [show|on|off|clear]`：交互习惯；
- `/memory identity [show|path|import]`：身份层；`import` 把模板复制到当前工作区；
- `/memory persona [show|versions|clear]`：当前工作区的人格记忆与版本；
- `/memory workspaces`：列出其他工作区（需开启跨工作区）；
- `/memory cross <query>`：检索其他工作区的工作事实。

## 模型工具

- `persona_save(text)`：写入/迭代人格记忆（≤ `personaMaxChars`，自动版本化）；
- `memory_save(note, why?, tags?, kind?, status?, pinned?, supersedes?, ttlDays?)`：写要点或待办；
- `memory_pin(id, pinned?)`：钉住/取消钉住；
- `memory_resolve(id)`：完成待办；
- `memory_forget(id)`：永久删除条目；
- `memory_recall(query?, limit?, scope?, kind?)`：检索结构化工作记忆；默认 `kind=note`，无工具调用噪声。

## 配置

```yaml
- id: session-memory
  name: 'dsh-session-memory'
  config:
    identityFile: ''            # 身份 INI 模板绝对路径
    identityMaxChars: 1200
    personaDirectory: ''        # 人格目录；留空 $DSH_HOME/persona
    personaWorkspaceScoped: true # 每个工作区独立身份 + 人格
    personaMaxChars: 1200       # 人格摘要上限
    personaKeepVersions: 5      # 保留最近几个版本
    crossWorkspaceEnabled: false # 允许读取其他工作区工作记录
    crossWorkspaceAttach: false  # 新会话自动注入其他工作区摘要
    crossWorkspaceAllowlist: []  # 允许的工作区 cwd；空 = 不共享
    crossWorkspaceMaxChars: 1500
    crossWorkspaceSessions: 3
    directory: ''               # 工作存储；留空 $DSH_HOME/context-memory
    autoAttach: true
    maxChars: 3000
    maxAgeDays: 14
    maxItems: 80
    maxMessageChars: 600
    maxNotes: 12
    maxOpenItems: 20            # 未完成事项上限
    maxSessions: 20
    attachSessions: 1
    includeToolCalls: true
    habitsEnabled: true
    habitsMaxChars: 600
```

## 说明与限制

- 身份/人格是稳定设定，不覆盖安全、诚实和工具规则；也不允许编造文件之外的事实。
- 默认按工作区隔离身份与人格；某工作区没有文件就不注入，不会回退到其他工作区。
- QQ 等持久通道的 Agent 可能早于插件监听器创建；插件启动时会扫描 live roots 并在 `session/event` 上补挂，不依赖 `agent/created` 一定触发。
- 人格记忆是**迭代摘要**，不是完整自传；每次替换必须自己保留仍需的要点。
- 工作摘要可能有损/过时，只是索引；钉住条目和未完成事项会优先保留，但仍建议把关键决定落成文件。
- 习惯归纳是规则推断，不调用模型。
- 人格摘要、事实、习惯都是纯文本，可直接查看/删除。
- 跨工作区读取只针对**工作事实**，不读取身份/人格；但工作事实本身可能含敏感项目内容，默认关闭，需显式开启。
- 安装/升级 Client 半后需要重启 DSH；更换目录不迁移旧数据。
