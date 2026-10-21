# 会话记忆（Session Memory）使用文档

适用版本：**1.3.0**（Windows / macOS / Linux）
插件包：`dsh-session-memory`
源码目录：`<repo>`

---

## 1. 这个插件做什么

它在**本机**记录当前工作区的会话，并做三件事：

1. **身份层**：读取一个全局 INI，保持“我是谁、怎么配合”；
2. **交互习惯**：用规则归纳模型的配合方式，单独保存为两份 txt；
3. **会话事实**：把对话与工具调用压缩成有上限的摘要。

在**同一工作目录**的下一个新会话启动时，插件按固定顺序自动接入：

```
身份（我是谁） → 交互习惯（怎么配合） → 会话事实（发生过什么）
```

它不替代会话日志：会话日志仍是唯一事实来源，记忆只是可删除的派生缓存。

---

## 2. 安装与生效

插件已安装到 `<profile>` profile。安装或升级后：

- Host 端会立即加载；
- **浏览器端（设置页面）需要完全退出并重新打开 DSH 一次**才会加载。

确认已启用：

1. 左侧栏打开 **插件**；
2. 在 **已安装插件** 中能看到 **会话记忆**，右侧开关为开启状态。

---

## 3. 打开设置界面

有两种入口，任选其一。

### 入口 A：从插件详情页进入（推荐）

```
左侧栏「插件」
└ 已安装插件
   └ 会话记忆            ← 点击卡片进入详情页
      └ 包含的组件
         └ 会话记忆 ›     ← 点击这一行的标题（右侧有 › 箭头）
            └ 人格、身份与工作页面
```

注意：

- **插件列表里的卡片只有启用开关，没有配置按钮**；
- 配置入口是详情页里那一行的**标题本身**（右侧 `›`）。

### 入口 B：从「内置插件配置」进入（兜底）

```
左侧栏「插件」
└ 内置插件配置
   └ 人格、身份与工作      ← 点击卡片
      └ 人格、身份与工作页面
```

如果入口 A 的页面显示“该 Host 条目未加载，暂时无法配置”，请使用入口 B；这是较新版本提供的兜底入口。

### 设置页面内容

- **身份 INI 文件**：绝对路径；留空关闭身份层；
- **存储根目录**：文本输入框；
- **浏览…**：调起系统目录选择器；
- **恢复默认**：清空输入，回到默认目录；
- **派生文件**：显示事实 JSON、习惯 `.1.txt`、`.2.txt` 的路径；
- **归纳交互习惯**：勾选/取消；
- **保存**：写入 profile 配置并生效；
- 迁移提示：更改目录**只影响之后写入的数据**，旧目录文件不会自动迁移。

---

## 4. 本地数据与存储位置

### 默认位置

```
%USERPROFILE%\.dsh\context-memory
```

等价于 DSH 的 `$DSH_HOME/context-memory`。

### 目录结构

```
<身份文件>                      任意路径的 INI，由 identityFile 指定（只读，不复制）
<人格目录>/                     默认 $DSH_HOME/persona
  current.md                    当前人格/关系摘要（≤ personaMaxChars）
  versions/                     迭代版本，保留最近 personaKeepVersions 个
<工作存储>/
  <工作区哈希>.json            事实/对话压缩（每个工作区一个）
  habits/
    <工作区哈希>.1.txt         最新交互习惯总结
    <工作区哈希>.2.txt         上一次交互习惯总结
```

- 工作区按会话的 `cwd` 区分；
- 最多保留最近 20 个会话（`maxSessions`），超过 14 天（`maxAgeDays`）的记录不再接入/保留；
- 所有本地文件都不上传网络。

### 更改存储位置

在设置页面修改 **存储根目录** → **保存**。

行为说明：

- 事实 JSON 与习惯 txt 都跟随这个根目录；
- **不会自动迁移旧数据**；旧目录中的文件保留在原处；
- 保存后插件会按新目录重新加载，之后的回合写入新目录；
- 也可以直接在 profile 的 `cordis.patch.yml` 中设置 `directory`（见第 8 节）。

---

## 5. 身份层（INI）

身份层是全局的“我是谁”，不按工作区区分。设置 `identityFile` 后，每次新会话/恢复会话都会读取并解析该文件，注入为常驻段落（order **100**），早于习惯（280）和事实（300）。

- 只解析 `[section]` + `key = value`，忽略 `#` / `;` 注释；
- `[raw]` 节不参与注入（只作原文对照）；
- `[meta]` 只读取 `version` / `updated`；
- 正文上限 `identityMaxChars`（默认 1200）；
- 文件不存在、不可读或解析为空时，身份层自动跳过，并在 Host 日志写一条 `session-memory:` 警告；
- 身份层是稳定设定，不覆盖安全、诚实和工具规则，也不允许编造文件之外的事实。

在设置页面的「身份 INI 文件」填入绝对路径即可；留空关闭。完整示例见 `examples/identity.example.ini`。

查看解析结果：

```
/memory identity
/memory identity path
```

---

## 5.5 人格记忆（独立于工作记忆）

人格记忆是全局的**自我认知与关系摘要**，与工作数据完全分开：

- 目录：`personaDirectory`，默认 `$DSH_HOME/persona`；
- 当前：`<人格目录>/current.md`；
- 版本：`<人格目录>/versions/<ISO>.md`，只保留最近 `personaKeepVersions` 个；
- 注入：order **150**，位于身份（100）之后、习惯（280）之前；
- 更新：模型调用 `persona_save(text)`，或手动编辑 `current.md`；
- 上限：`personaMaxChars`（默认 1200）；超过会被拒绝，要求先压缩；
- 清除：`/memory persona clear` 只清人格记忆，不影响身份/工作数据。

“迭代”方式是：每次用一份完整的新摘要替换当前版本；旧版本自动保留，便于回滚。工作记忆、习惯、身份都不受影响。

```
/memory persona
/memory persona show
/memory persona versions
/memory persona clear
```

---

## 5.6 跨工作区工作记录（可选）

默认关闭。开启 `crossWorkspaceEnabled` 后，可以读取**其他工作区的工作事实**：

- `memory_recall(scope:'all')`：模型检索其他工作区工作事实；
- `/memory workspaces`：列出其他工作区；
- `/memory cross <关键词>`：命令行检索其他工作区；
- `crossWorkspaceAttach` 开启时，新会话在事实之后（order **310**）自动注入最近的其他工作区摘要。

隐私边界：

- 只读取 `<工作存储>/*.json` 中的工作事实；
- **绝不读取** `identityFile` 或 `<personaDirectory>`；
- 人格记忆不会复制进工作文件，也不会出现在跨工作区结果里。

工作事实本身可能包含敏感项目内容，默认关闭，请确认后再开启。

上限：`crossWorkspaceMaxChars`（默认 1500）、`crossWorkspaceSessions`（默认 3）。

---

## 6. 交互习惯（txt 文档）

### 记录什么

只记录**表达与工作方式**，例如：

- 语言：中文为主 / 英文为主 / 中英混用；
- 表达：标题分节、列表、代码块、表格；
- 工作流：先读后改、命令验证、多步任务先列 todo；
- 工具偏好：最常用的几个工具；
- 交互：关键或破坏性操作前先确认；
- 用户明确要求：带有“以后 / 不要 / 记住 / 务必 / always / never”等句式的短句。

**不记录**：项目事实、文件路径、任务进度、技术决策、代码内容。

### 文件规则

- 每次压缩都会重新归纳，但**只有内容变化时才轮换**：
  - 新内容写入 `.1.txt`；
  - 原 `.1.txt` 覆盖 `.2.txt`；
  - 永远最多两份，不会出现第三份。
- 下一次会话**只注入最新的 `.1.txt`**；`.1.txt` 不存在时才回退到 `.2.txt`。
- txt 内容可直接用记事本打开阅读。

### 开启 / 关闭

三种方式：

1. 设置页面勾选/取消 **归纳交互习惯**，保存；
2. 命令 `/memory habits on` 或 `/memory habits off`；
3. profile 配置 `habitsEnabled: true/false`。

关闭后：

- 不再生成、轮换或注入习惯；
- 已有 txt 文件保留；
- 重新开启后继续更新。

### 查看与清除

- 查看：`/memory habits` 或 `/memory habits show`；
- 清除该工作区的两份习惯文件：`/memory habits clear`；
- 查看将注入的顺序与全文：`/memory preview`。

---

## 7. 上下文如何恢复

新会话（`startup` / `clear`）在相同工作目录创建时，按 order 注入：

1. **身份层**（`identityFile` 已配置时）：order `100`；
2. **人格记忆**（`personaDirectory/current.md` 存在时）：order `150`；
3. 该工作区最新的 `.1.txt`：**交互习惯（先读）**，order `280`；
4. 最近一次事实摘要：**会话事实（后读）**，order `300`；
5. 其他工作区工作记录（`crossWorkspaceEnabled` + `crossWorkspaceAttach` 开启时）：order `310`。

实现顺序：身份 100 → 人格 150 → 习惯 280 → 事实 300 → 其他工作区 310。

以下情况不会接入：

- `resume` 恢复的旧会话：**只恢复身份 + 人格**，不重复接入习惯/事实；
- 子代理会话：完全跳过；
- 不同工作目录：不接入习惯/事实（身份、人格是全局的，仍会恢复）；
- 习惯开关关闭时：只跳过习惯，事实仍接入；
- 没有可用记录的新工作区：只恢复身份 + 人格。

想确认下一次会话实际会看到什么，运行：

```
/memory preview
```

---

## 8. 命令与模型工具

### 命令

| 命令 | 作用 |
|---|---|
| `/memory`、`/memory status` | 查看身份 / 人格 / 工作三套路径、大小、记录数 |
| `/memory show` | 身份 → 人格 → 习惯 → 最近一次事实摘要 |
| `/memory preview` | 打印下次会话将按什么顺序注入的完整内容 |
| `/memory path` | 工作记录文件路径 |
| `/memory clear` | 清除该工作区的事实记忆（不影响身份/人格/习惯） |
| `/memory habits` | 查看最新习惯 |
| `/memory habits on\|off` | 开启/关闭习惯归纳 |
| `/memory habits show` | 查看习惯文件内容 |
| `/memory habits clear` | 删除该工作区的两份习惯文件 |
| `/memory identity` | 查看解析后的身份层 |
| `/memory identity path` | 查看身份文件路径 |
| `/memory persona` | 人格记忆状态（目录、大小、版本数） |
| `/memory persona show` | 查看当前人格摘要 |
| `/memory persona versions` | 列出人格版本 |
| `/memory persona clear` | 清除人格记忆与版本（不影响身份/工作） |
| `/memory workspaces` | 列出其他工作区（需开启跨工作区） |
| `/memory cross <关键词>` | 检索其他工作区的工作事实 |

### 模型工具

| 工具 | 作用 |
|---|---|
| `persona_save(text)` | 写入/迭代人格记忆（≤ `personaMaxChars`，自动版本化） |
| `memory_save(note, tags?)` | 让模型把项目目标、决策、约定、下一步写入工作记忆 |
| `memory_recall(query?, limit?, scope?)` | 检索工作记忆；`scope: 'all'` 时跨工作区（只含工作事实） |

`memory_save` 写入的要点会单独保存在事实记录的 `notes` 中，并在下次会话的“已保存的要点”里优先出现。

---

## 9. 配置项

在 profile 的 `cordis.patch.yml` 中覆盖 `session-memory` 行（整行 `config` 会被替换，需写全想保留的字段）：

```yaml
- id: session-memory
  name: 'dsh-session-memory'
  config:
    directory: ''          # 存储根目录；留空使用 $DSH_HOME/context-memory
    identityFile: ''       # 身份 INI 绝对路径；留空关闭身份层
    identityMaxChars: 1200 # 身份层正文上限
    personaDirectory: ''   # 人格目录；留空 $DSH_HOME/persona
    personaMaxChars: 1200  # 人格摘要上限
    personaKeepVersions: 5 # 保留最近几个人格版本
    crossWorkspaceEnabled: false # 允许读取其他工作区工作记录
    crossWorkspaceAttach: false  # 新会话自动注入其他工作区摘要
    crossWorkspaceMaxChars: 1500
    crossWorkspaceSessions: 3
    autoAttach: true       # 新会话自动接入
    maxChars: 3000         # 事实摘要上限
    maxAgeDays: 14         # 记录保留天数
    maxItems: 80           # 每个会话保留的最近记录条数
    maxMessageChars: 600   # 单条消息压缩后的最大字数
    maxNotes: 12           # memory_save 要点上限
    maxSessions: 20        # 每个工作区最多保留的会话数
    attachSessions: 1      # 接入最近几个会话（1-5）
    includeToolCalls: true # 事实摘要是否包含工具调用
    habitsEnabled: true    # 交互习惯总开关
    habitsMaxChars: 600    # 习惯正文上限
```

设置页面会修改 `identityFile`、`personaDirectory`、`directory`、`crossWorkspaceEnabled`、`crossWorkspaceAttach` 与 `habitsEnabled`，其余字段仍通过配置或命令维护。

---

## 10. 常见问题

### 10.1 插件列表里只有开关，没有“配置”按钮

正常。列表卡片只放启用开关。请点击卡片进入详情页，再点「包含的组件」里那一行的**标题**（右侧 `›`）。

### 10.2 页面显示“该 Host 条目未加载，暂时无法配置”

1. 先试 **内置插件配置 → 人格、身份与工作**（入口 B）；
2. 确认安装的是 **1.3.0** 或更新版本；
3. 安装/升级后需**完全退出并重开 DSH**，刷新页面不够；
4. 若两个入口仍不可用，请记录当前版本与页面提示，交给维护者排查。

### 10.3 为什么只有一个习惯 txt，没有 `.2.txt`

说明内容与上一份完全相同，插件跳过了重复写入。只有内容发生变化时才会把 `.1.txt` 轮换到 `.2.txt`。

### 10.4 改了存储目录，旧记忆不见了

设计如此：更改目录**不会迁移**旧文件。旧目录中的 `<工作区哈希>.json` 与 `habits/` 仍保留；需要的话手动复制到新目录。

### 10.5 新会话没有接入记忆

依次检查：

- 是否在同一工作目录新建（`resume` 只恢复身份层，不重复接入习惯/事实）；
- 该目录是否已有事实记录或习惯 txt；
- `autoAttach` 是否为 `true`；
- 习惯开关是否关闭（只影响习惯，不影响事实/身份）；
- 是否是子代理会话（不参与）。

### 10.6 记忆内容太多/太少

- 身份层上限：`identityMaxChars`（默认 1200 字）；
- 事实摘要上限：`maxChars`（默认 3000 字）；
- 习惯正文上限：`habitsMaxChars`（默认 600 字）；
- 最近记录条数：`maxItems`；
- 单条消息上限：`maxMessageChars`。

### 10.7 隐私

所有数据都在本机：事实/习惯写入存储根目录，身份文件只读、不会被复制或上传；插件不联网。可以直接删除文件，或使用 `/memory clear`、`/memory habits clear`。

### 10.8 身份层没有生效

依次检查：

1. 设置页「身份 INI 文件」是否填了**绝对路径**，并已保存；
2. `/memory identity` 是否能解析出内容；
3. 文件是否至少有一个 `[section]` + `key = value`；
4. 是否重启过 DSH（Host 代码/设置变更后）；
5. 身份层只在**新会话或 resume** 时读取，当前已打开的会话不会自动刷新。

---

### 10.9 人格记忆太大 / persona_save 被拒绝

人格记忆是**有上限的迭代摘要**：`personaMaxChars`（默认 1200）。超过时 `persona_save` 会直接报错，不会截断。

处理方式：

1. 让模型把新内容与旧内容合并压缩到上限内，再调用一次；
2. 或手动编辑 `<人格目录>/current.md` 后重试；
3. 旧版本仍在 `<人格目录>/versions/`，只保留最近 `personaKeepVersions` 个。

工作事实、习惯不要写进人格记忆——它们有各自独立的存储。

---

## 11. 已知限制

- 身份层是稳定设定，不覆盖安全、诚实和工具规则；也不会让模型获得文件之外的真实记忆；
- 人格记忆是**迭代摘要**，不是完整自传；每次替换必须保留仍需的要点，且受 `personaMaxChars` 限制；
- 人格版本只保留最近 `personaKeepVersions` 个，旧版本会被清理；
- 习惯归纳是**规则推断**，不调用模型；它反映统计倾向，不是绝对准确的偏好判断；
- 习惯是参考，不是指令；与当前用户要求冲突时，以当前要求为准；
- 事实摘要按时间窗口滚动，超出 `maxChars` 的早期内容会被省略（保留“早期目标”和最近的对话）；
- 跨工作区只读工作事实，不读取身份/人格；但工作事实本身可能含敏感项目内容，需显式开启；
- 跨工作区自动注入受 `crossWorkspaceMaxChars` / `crossWorkspaceSessions` 限制；
- 浏览器端设置页面在安装/升级后需要重启 DSH 才会更新；
- 更换身份/人格/工作目录都不会迁移旧数据。

---

## 12. 相关文件

- 插件说明与配置示例：`<repo>\README.md`
- 身份层示例：`<repo>\examples\identity.example.ini`
- 人格记忆示例：`<repo>\examples\persona.example.md`
- 架构说明：`<repo>\ARCHITECTURE.md`
- 人格目录：`<DSH_HOME>\persona`（默认）
- 工作存储：`<DSH_HOME>\context-memory`（默认）
- 安装目录：`<profile>\node_modules\dsh-session-memory`
