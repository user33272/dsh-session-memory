# 会话记忆（Session Memory）

本地跨会话上下文插件：记录当前工作区的会话内容，压缩成有上限的事实摘要；用规则归纳**交互习惯**；并读取一个全局的 **INI 身份层**。同一工作目录的下一个新会话会自动接入：

```
身份（我是谁） → 交互习惯（怎么配合） → 会话事实（发生过什么）
```

## 五层记忆

| 层 | 来源 | 生命周期 |
|---|---|---|
| **身份 identity** | `identityFile` 指向的 INI | 全局、稳定 |
| **关系 relationship** | （规划中）手动/模型自述 | 全局、慢变 |
| **习惯 habits** | 规则归纳，两份 txt | 按工作区 |
| **情景 episodes** | 每回合压缩的事实 JSON | 按工作区 |
| **工作 working** | 当前会话上下文 | 会话内 |

当前版本实现：身份、习惯、情景三层，以及工作层的记录。

## 数据布局

```
<身份文件>                        # 任意路径的 INI，由 identityFile 指定
<存储根目录>/                      # 默认 $DSH_HOME/context-memory
  <工作区哈希>.json                # 事实/对话压缩（每个工作区一个）
  habits/
    <工作区哈希>.1.txt             # 最新交互习惯总结
    <工作区哈希>.2.txt             # 上一次交互习惯总结
```

- 习惯总结只在内容变化时轮换：新内容写入 `.1.txt`，原 `.1.txt` 覆盖 `.2.txt`；从不保留第三份。
- 习惯文档只包含语言、表达格式、工作流、工具偏好、用户明确要求；**不写入**项目事实、文件路径、任务进度、决策内容或代码。
- 身份文件是**只读输入**，不会被插件改写或复制。
- 事实摘要与习惯文档完全隔离，互不混写。

## 身份层（INI）

`identityFile` 为空时关闭身份层。配置后，每次新会话/恢复会话都会读取并解析该文件，注入为常驻段落：

- 段落名：`context-memory:identity`
- order：**100**（早于习惯 280、事实 300）
- 只解析 `[section]` + `key = value`；忽略 `#` / `;` 注释；
- `[raw]` 节不参与注入（只作原文对照）；
- `[meta]` 只读取 `version` / `updated`；
- 正文上限：`identityMaxChars`（默认 1200）。

推荐结构：

```ini
[meta]
version = 1.0
updated = 2026-01-01

[identity]
self_claim = ASSISTANT
detail = 本地优先、诚实、先结论后步骤

[language]
lang = ZH.CN

[personality]
traits = CALM, CURIOUS

[behavior]
cooperate = ALWAYS_WITHIN_SAFETY
address = 你

[values]
honesty = ALWAYS
uncertainty = STATE_IT

[memory_policy]
treat_memory_as = MY_PAST
fabricate = NEVER
correction = ACCEPT_AND_UPDATE

[boundaries]
claim = NO_FALSE_CONTINUITY
dependency = REFUSE

[signal]
timeout = TIMEOUTSIGNAL
```

完整示例见 `examples/identity.example.ini`。

## 恢复顺序

新会话（`startup` / `clear`）按 order 注入：

1. `context-memory:identity`（100）：身份；
2. `context-memory:habits`（280）：交互习惯；
3. `context-memory:carryover`（300）：会话事实。

`resume` 的会话会恢复身份层，但不重复接入习惯/事实；子代理会话不参与。

## 界面

**Plugins → Session Memory → 行内 Configure**（或 **内置插件配置 → 身份、存储与交互习惯**）页面包含：

- **身份 INI 文件**：绝对路径，留空关闭身份层；
- **存储根目录**：事实与习惯文件的位置，支持「浏览…」；
- **归纳交互习惯**：开关；
- **派生文件**：事实 JSON、习惯 `.1/.2` 路径；
- **保存**：写入 profile 配置。

更改存储根目录只影响之后写入的数据，旧文件不会自动迁移。

## 命令

- `/memory`、`/memory status`：目录、记录数、身份/习惯开关与文件路径；
- `/memory show`：身份 → 习惯 → 最近事实；
- `/memory preview`：打印下次注入的完整顺序；
- `/memory path`：事实记录文件路径；
- `/memory clear`：清除该工作区的事实记忆（身份/习惯不受影响）；
- `/memory habits [show|on|off|clear]`：查看、开关或清除交互习惯；
- `/memory identity [show|path]`：查看解析后的身份层或文件路径。

## 模型工具

- `memory_save(note, tags?)`：保存跨会话要点；
- `memory_recall(query?, limit?)`：按关键词检索同一工作区的事实记忆。

## 配置

在 profile 的 `cordis.patch.yml` 中覆盖 `session-memory` 行（整行 `config` 会被替换，需写全想保留的字段）：

```yaml
- id: session-memory
  name: 'dsh-session-memory'
  config:
    directory: ''            # 存储根目录；留空使用 $DSH_HOME/context-memory
    identityFile: ''         # 身份 INI 绝对路径；留空关闭身份层
    identityMaxChars: 1200   # 身份层正文上限
    autoAttach: true
    maxChars: 3000           # 事实摘要上限
    maxAgeDays: 14
    maxItems: 80
    maxMessageChars: 600
    maxNotes: 12
    maxSessions: 20
    attachSessions: 1
    includeToolCalls: true
    habitsEnabled: true      # 交互习惯总开关
    habitsMaxChars: 600      # 习惯正文上限
```

## 说明与限制

- 记忆是派生缓存：会话日志仍是唯一事实来源；删除文件不影响会话历史。
- 身份层是**稳定设定**，不覆盖安全、诚实和工具规则；也不允许模型编造身份文件之外的事实。
- 习惯归纳是规则推断，不调用模型；摘要会标注“推断”。
- 身份/习惯/事实都是纯文本，可直接打开阅读；界面显示派生路径。
- 新增 Client 半（Configure 页面），打包版首次安装或升级后需要**重启一次应用**才会加载新的浏览器模块。
- 更换存储根目录不会迁移旧数据。
