# dsh-session-memory 1.8.0/1.8.1 — 存取逻辑重做（参照 meow-memory）

基线：你仓库里的 **1.7.1**（写入硬化、硬预算已经在了）。
这次只动“存”和“取”两层，不改 client、不改注入顺序、不改身份/人格。

参照对象：[meow-memory 0.31.0](https://github.com/Phant0Meow/dsh-meow-memory) 的公开设计（MIT）——
条目带关键词、BM25 × IDF × 覆盖率 × 遗忘曲线 × 重要度排序、写入去重合并。
**没有照搬它的 SQLite 运行时**：本插件仍然只读写一个 JSON，零新增依赖。

## 一、行为变化（用户/模型能看到什么）

1. **要点不再随会话过期**
   - 以前：`notes` 挂在 `sessions[sessionId]` 上，会话被 `maxAgeDays`(14 天)/`maxSessions`(20 个) 剪掉时，里面的“长期要点”一起没了。
   - 现在：条目存在工作区级 `memory.notes / memory.openItems`，会话记录只留对话与摘要；`sessionId` 变成来源标记。
   - 因此 `/memory todo`、`/memory pins`、`memory_pin/resolve/forget` 现在覆盖**整个工作区**，重启后也能操作旧条目。

2. **召回从“子串匹配”换成 BM25 排序**
   - 关键词：保存时抽取（中文 bigram + 英文/数字词），写进条目的 `kw` 字段，可人工改。
   - 同义扩展：`终端/命令行/shell/pwsh`、`权限/acl/permission`、`删除/remove` 等 15 组；多字中文同义词按其 bigram 建索引，所以「命令行」能召回写着「终端」的条目。
   - 打分：`BM25(k1=1.2,b=0.75) × IDF × 覆盖率系数 × 遗忘曲线(半衰期 30 天, 下限 0.4) × 重要度(钉住 1.35 / 阻塞 1.15 / 带 why 1.05)`。
   - 取消「必须命中 2 个词」的硬门槛，改为相对截断（低于最高分 35% 的丢弃）+ 精确短语加分。
   - 覆盖率按**查询词**计，不按展开后的别名计，避免同义词把比例稀释成没意义的数。

3. **写入自动去重**
   - 归一化正文相同，或关键词 Jaccard ≥ 0.75 → 更新原条目（`time` 刷新、`pinned` 取或、`kw` 重算），返回 `merged: true`，不再堆第二条。

4. **交叉工作区召回也走新排序**
   - `memory_recall(scope:'all')` 现在读其他工作区的 `memory` 字段（旧文件自动按会话记录迁移），仍受 `crossWorkspaceAllowlist` 约束。

## 二、改动清单

| 文件 | 改动 |
|---|---|
| `recall.js`（新） | 分词（单遍、CJK bigram）、同义词表 `ALIAS_GROUPS`、关键词派生、Jaccard、BM25 索引与排序、衰减/重要度、相对截断、`mergeLegacyEntries`、`capMemory` |
| `memory.js` | `normalizeNote/normalizeOpenItem` 保留 `kw` / `sessionId`；新增 `ensureMemoryStore()` 与 `hydrateEntryFromStore()`；`mergeWorkspaceData()` 增加 memory 的按 id 并集（跨进程写不再互相覆盖新条目） |
| `index.js` | 工作区记忆库接线：`loadWorkspace` 迁移、`saveEntry` 落库、`memory_save` 去重+关键词、pin/resolve/forget 跨会话可用、`memory_recall` 用新排序、`/memory todo|pins|clear` 适配、`loadOtherWorkspaces` 带 memory |
| `package.json` | 版本 1.8.0；`files` 加 `recall.js` |
| `README.md` / `ARCHITECTURE.md` | 记录新数据模型、召回语义、配置语义（`maxNotes` 现在是每工作区上限） |
| `test/recall.test.mjs`（新） | 分词、同义词、多字别名、BM25 稀有词优先、衰减、钉住、覆盖率、去重相似度、迁移、上限 |
| `test/store.test.mjs`（新） | 迁移一次且幂等、hydrate 新者胜、merge 并集、端到端「迁移→落库→同义词召回」 |
| `scripts/smoke-real-workspace.mjs`（新） | 拿真实 `<workspaceKey>.json` 跑一遍迁移+召回（只读） |
| `scripts/integration-smoke.mjs`（新） | 用桩 Context 启动 Host 半，跑真实代码路径：记录会话 → memory_save（去重）→ memory_recall（同义词）→ `/memory todo|pins|show` → 落盘 → 二次启动读盘召回 |
| `node_modules/@deepseek-ai/schemastery/`（仅本地） | 给集成冒烟用的极简桩，**不随补丁发布** |

## 三、迁移与回滚

- **读取时迁移**：老文件没有 `memory` 字段时，`ensureMemoryStore()` 从 `sessions[*].notes/openItems` 复制一份（按 id 去重），写入 `migrated` 计数，**旧数据不删**。下一次保存时落盘。
- **回滚**：把 `index.js`/`memory.js`/`package.json` 换回 1.7.1 即可。旧版本不认识 `memory` 字段但会忽略它；会话记录里还有每条记忆的镜像（`record.notes` 只放本会话创建的条目），所以回滚后仍能看到内容，只是排序回到子串匹配。
- 若你更想“干净回滚”，迁移前把 `<工作存储>/<工作区哈希>.json` 复制一份即可。

## 四、验证

单元测试（Node 24，直接跑文件；`node --test` 会被沙箱的 spawn 限制挡住）：

```
test/recall.test.mjs    exit=0
test/memory.test.mjs    exit=0
test/store.test.mjs     exit=0
test/identity.test.mjs  exit=0
test/persona.test.mjs   exit=0
```

真实数据冒烟（本机 `D:\test` 工作区的记忆文件，只读）：

```
记忆库: notes=2 openItems=0 migrated=2
查询「shell 命令 权限」→ 1 条 · 覆盖率 1.00 · 1.959
查询「命令行」        → 1 条 · 覆盖率 1.00 · 0.813
```

对照 1.7.1：同一句「shell 命令 权限」是 **0 条**（子串匹配，词形不同就找不回）。

Host 半集成冒烟（桩 Context，跑真实 index.js，21 项断言）：

```
PASS  memory_save 已注册 / saved=true / 首存未 merged
PASS  memory_recall 用同义词命中（score=0.800）
PASS  重复保存被合并而非新增（notes=1）
PASS  /memory todo 列出跨会话待办 · pins/show 可运行
PASS  落盘含 memory.notes、kw、sessionId，会话记录保留镜像，摘要含待办段
PASS  二次启动读盘后仍能同义词召回、待办仍在
ALL CHECKS PASSED
```

这一步抓到两个真实缺陷，已修：

1. **去重被路径分隔符拆掉**：`D:\test` 与 `D:/test` 归一化后不相等 → 归一化现在去掉 `/ \ ／ ＼`。
2. **相似度只比了截断的 `kw`**：长笔记的关键词被 24 个上限截断，同一件事两种写法 Jaccard 掉到阈值以下 → 改用全文 token 集比较。

## 六、1.8.1 接手时补的两个集成层缺陷

1. **普通 turn/end 会清空工作区记忆库**
   - 现象：`saveEntry` 直接用当前 live entry 的 `notes/openItems` 覆盖 `data.memory`；新会话的 entry 是空的，第一次 turn/end 就把已有工作区要点全抹掉。
   - 修复：`saveEntry` 先 `hydrateEntry(entry, workspace)`，把工作区库合并进 entry 再落库。
   - 回归断言：集成冒烟新增「普通 turn/end 不清空工作区记忆/待办」两项。

2. **forget 的删除被读-合并-写复活**
   - 现象：`memory_forget` 只把条目标成 `deleted` 并从本地 `capMemory` 里过滤掉；写锁打开后，`mergeWorkspaceData` 又从磁盘并集把旧条目加回来。
   - 修复：`capMemory` 保留删除墓碑；forget 刷新条目的 `time`，让墓碑在按 id/时间合并时压过磁盘旧值；`toRecord` 的会话镜像不再包含墓碑。
   - 回归断言：`test/store.test.mjs` 新增「newer deletion tombstone」。

当前验证：单元测试 5 个文件全绿（recall 17 / memory 8 / store 7 / identity 6 / persona 4）；集成冒烟 23 项全过。

## 七、1.9.0 钉住面板

- 新增 Host 只读路由 `GET /session-memory/pins`：扫描所有工作区 JSON 的 `memory`，返回 active+pinned 的要点/待办；只接受 loopback 请求，不读取 persona/identity，不写文件。
- Client 在 `sidebar.footer.action` 增加「钉住记忆」按钮；点击后用 portal 打开只读弹窗，按工作区分组显示正文、why、标签、id、时间、待办状态，支持刷新和空/错误/非本机提示。
- 已在真实 DSH profile 安装 1.9.0 并验证路由返回 3 个工作区的钉住条目；slot 注册已确认。

## 八、还没做 / 需要你定的

1. **已在真实 DSH 进程安装验证到 1.9.0**：Host 路由、真实会话工具调用、slot 注册均已确认；完整重启仍建议做一次，让所有已有 agent 走新代码。
2. **自动注入没换成 meow-memory 的“每条用户消息 top-2”**。那需要接管 client 消息流与压缩事件，改的是注入层，不在这轮“存取”范围内；如果你要，我在下一轮单独做。
3. **去重阈值 0.75 是我拍的**。真实语料跑一段后可能需要调；`recall.js` 顶部 `RANKING` 都可以改。
4. 中文同义词表只放了 15 组常用词，按需在 `ALIAS_GROUPS` 里加。
