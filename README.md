# 会话记忆（Session Memory）

本地跨会话上下文插件：记录当前工作区的会话内容，压缩成有上限的事实摘要；同时用规则归纳**交互习惯**，以两份 txt 文档保存在本地。同一工作目录的下一个新会话会自动接入：**先恢复交互习惯，再恢复会话事实**。

## 数据布局

所有本地数据都在**一个可配置的存储根目录**下（默认 `$DSH_HOME/context-memory`）：

```
<根目录>/
  <工作区哈希>.json            # 事实/对话压缩（每个工作区一个）
  habits/
    <工作区哈希>.1.txt         # 最新交互习惯总结
    <工作区哈希>.2.txt         # 上一次交互习惯总结
```

- 习惯总结只在内容变化时轮换：新内容写入 `.1.txt`，原 `.1.txt` 覆盖 `.2.txt`；从不保留第三份。
- 习惯文档只包含语言、表达格式、工作流、工具偏好、用户明确要求；**不写入**项目事实、文件路径、任务进度、决策内容或代码。
- 事实摘要与习惯文档完全隔离，互不混写。

## 恢复顺序

新会话在同一 `cwd` 下创建时，注入两个独立 system prompt 段落：

1. `context-memory:habits`（order 280）：交互习惯，标题「交互习惯（先读）」；
2. `context-memory:carryover`（order 300）：会话事实，标题「会话事实（后读）」。

`renderPrompt` 按 order 拼接，所以习惯一定在事实之前。`resume` 的旧会话不重复接入；子代理会话不参与记录和接入。

## 开关

- 界面：**Plugins → Session Memory → 行内的 Configure** 页面，可开关「归纳交互习惯」。
- 命令：`/memory habits on|off`（通过 settings 写回配置；若部署不可写则仅当前运行期生效）。
- 关闭后：不再生成、轮换或注入习惯，已有 txt 保留；重新开启后继续。

## 存储位置

同一 Configure 页面可修改**存储根目录**（输入框 + 「浏览…」目录选择器），保存后写入 profile 配置并即时生效：

- 事实 JSON 与习惯 txt 都跟随这个根目录；
- **只影响之后写入的数据**，旧目录中的文件不会自动迁移；
- 页面同时只读显示事实文件与两份习惯文件的派生路径。

## 命令

- `/memory`、`/memory status`：查看目录、记录数、习惯开关与文件路径。
- `/memory show`：先显示习惯总结，再显示最近一次事实摘要。
- `/memory preview`：打印下次新会话将按什么顺序注入的内容（习惯在前、事实在后）。
- `/memory path`：事实记录文件路径。
- `/memory clear`：清除该工作区的事实记忆（习惯不受影响）。
- `/memory habits [show|on|off|clear]`：查看、开关或清除交互习惯。

## 模型工具

- `memory_save(note, tags?)`：保存跨会话要点。
- `memory_recall(query?, limit?)`：按关键词检索同一工作区的事实记忆。

## 配置

在 profile 的 `cordis.patch.yml` 中覆盖 `session-memory` 行的 `config`（整行替换，需写全想保留的字段）：

```yaml
- id: session-memory
  name: 'dsh-session-memory'
  config:
    directory: ''          # 存储根目录；留空使用 $DSH_HOME/context-memory
    autoAttach: true
    maxChars: 3000         # 事实摘要上限
    maxAgeDays: 14
    maxItems: 80
    maxMessageChars: 600
    maxNotes: 12
    maxSessions: 20
    attachSessions: 1
    includeToolCalls: true
    habitsEnabled: true    # 交互习惯总开关
    habitsMaxChars: 600    # 习惯正文上限
```

## 说明与限制

- 记忆是派生缓存：会话日志仍是唯一事实来源；删除文件不影响会话历史。
- 习惯归纳是**规则推断**（语言比例、标题/列表/代码块/表格、工具序列、确认/todo 行为、用户“不要/以后/记住”句式），不额外调用模型；摘要会标注“推断”。
- 习惯文档是纯 txt，可直接打开阅读；界面里显示派生路径。
- 新增了 Client 半（Configure 页面），打包版首次安装或升级后需要**重启一次应用**才会加载新的浏览器模块。
- 更换存储根目录不会迁移旧数据。
