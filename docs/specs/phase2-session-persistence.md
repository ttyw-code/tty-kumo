# Spec — 阶段 2：会话持久化与真相源迁移

**日期**：2026-09-29
**状态**：已实现
**背景**：会话与消息此前只存在于渲染端 Zustand 内存（`store/index.ts`），刷新或重启即全丢；每轮请求还要把全量历史从渲染端回传给主进程——真相源在渲染端，主进程只是执行器。这既丢数据，也让「谁说了算」变得暧昧。

## 核心决策：真相源迁到主进程

| | 之前 | 现在 |
|---|---|---|
| 会话/消息存放 | 渲染端内存 | 主进程 `SessionStore` + lowdb |
| 每轮历史来源 | 渲染端 `payload.history` | 主进程从仓储读取 |
| 渲染端 `messagesByChat` | 真相源 | **投影**（启动拉取 + 流式乐观更新） |
| 刷新窗口 | 全部丢失 | 数据保留，进行中的 run 还能接回 |

带来三个直接收益：刷新不丢数据；上下文不再依赖渲染端上送（不可信且可能过期）；多窗口/重载后视图一致。

## 存储布局

lowdb 是 `string → string` 的 KV，因此分 key 存放，避免每次写消息都重写整个列表：

| key | 内容 |
|---|---|
| `schema:version` | `"1"`，供将来迁移分支 |
| `chat:index` | `ChatSummary[]`，按 `updatedAt` 倒序 |
| `chat:{id}` | `ChatRecord`，含完整消息 |

类型定义在 `src/common/session.ts`（两端共用，不含 node/electron 依赖）。

**边界防护**：`chatId` 必须匹配 `^[A-Za-z0-9_-]{1,80}$`。否则 `chat:${id}` 可以拼出 `chat:index` 直接覆盖索引——这是 `isValidEntityId` 存在的唯一理由，别为了「支持特殊字符」把它放宽。

## 主进程 API

`src/main/agent/session.ts` 的 `SessionStore`：

```
list()                                   → ChatSummary[]
load(chatId)                             → ChatRecord | null
create(title?)                           → ChatRecord
rename(chatId, title)                    → ChatSummary | null
remove(chatId)                           → void
append(chatId, messages[])               → void   // 并同步索引摘要
patchMessage(chatId, messageId, patch)   → void   // 按字段合并
markInterrupted()                         → number // 启动时收尾
```

### 并发：所有操作串行化

索引与记录的更新都是 **read-modify-write**，而 lowdb 每次 `put` 是**整文件重写**。两个 run 同时收尾、或删除撞上落盘，都会互相覆盖。`SessionStore` 内部用一条 promise 链（`serialize`）把读和写全部排队，`session.test.ts` 里有 12 路并发 append 不丢消息的用例守着这条线。

同理，**不要逐 delta 落盘**。本轮结果累积在 `Run.collected` 里，终态时一次性 `patchMessage` 写入。

## IPC 契约

| 通道 | 方向 | 说明 |
|---|---|---|
| `agent:chat:send` | invoke | 入参去掉 `history`，新增可选 `messageId`；返回 `{runId, assistantId}` |
| `agent:chat:list` / `load` / `create` / `rename` / `delete` | invoke | 会话 CRUD |
| `agent:runs:list` | invoke | 进行中的 run 快照，供窗口重载后接回 |
| `agent:stream` | 主→渲染 | 唯一的推送通道，语义不变 |

`send` 返回 `assistantId` 而不是只返回 runId，是为了让渲染端把后续流事件定位到同一条消息上（此前 assistantId 由渲染端本地生成，两端会分叉）。

`messageId` 让渲染端乐观插入的用户消息与库里的记录共用同一个 id。

## 消息生命周期

```
send
 ├─ 校验 chatId / 会话存在 / 无并发 run
 ├─ append 用户消息 + assistant 占位（status: 'streaming'）   ← 崩溃也能看出「答到哪」
 ├─ 用 send 之前的快照重建历史（toLLMMessages）
 └─ startRun
      ├─ delta  → 只推送 + 累积到 run.collected.text
      ├─ tool   → 执行后把结果记进 run.collected.toolCalls
      └─ 终态   → await patchMessage（写终态 + usage/stopped/error）→ 再发终态事件
```

「先落盘、后发终态事件」的顺序是有意的：渲染端收到 `done` 时，磁盘上已经是最终内容，两边不会出现瞬时不一致。落盘失败只吞掉异常——用户已经看到回复了，不该再弹一个存储错误。

**残留收尾**：进程被杀时留下的 `status: 'streaming'` 占位不可能再有人处理，启动时 `main.ts` 调 `markInterrupted()` 把它们标成 `interrupted` + `stopped`。

**重载接回**：窗口重载后 `streamingByChat` 是空的，主进程的 run 却还在跑，若不处理，所有流事件会因「找不到 streaming 状态」被丢弃。渲染端启动时用 `agent:runs:list` 重建 streaming 状态——库里占位消息的 id 与 run 的 `assistantId` 相同，delta 因此能准确追加到那条消息上。

## 历史重建（`src/main/agent/history.ts`）

存储里工具结果挂在 assistant 的 `toolCalls[].result` 上（便于 UI 渲染卡片），但协议要求工具结果是**独立的 `role: 'tool'` 消息**，所以重建时要展开。

两个必须处理的坑：
1. **结果缺失**（被中断）要补 `MISSING_TOOL_RESULT` 占位——每个 `tool_call` 都必须有配对的 tool 消息，否则端点直接 400。
2. **空占位消息**（中断留下的空 assistant）要跳过，喂进去只会污染上下文。

## 已知边界 / 后续

1. **没有历史裁剪**。仍在把全量历史喂给模型，长会话必然撞 `context_length`——这是下一刀，`toLLMMessages` 是它的挂载点。
2. **单条消息正文上限 200k 字符，超出被截断**；会话消息数不设上限，靠第三刀的窗口裁剪解决，存储层不偷偷丢用户数据。
3. **进程退出时正在跑的 run 可能来不及落盘**：`will-quit` 只 cancel token，若事件循环随即结束，`patchMessage` 就没机会执行。兜底是下次启动的 `markInterrupted`，内容会停在中断处。
4. **删除会话后 run 仍会跑到 token 被检查到为止**；期间 `patchMessage` 落到已删除记录上会被静默忽略（`load` 返回 null）。
5. **没有 `chat:index` 的并发写保护跨进程**。目前只有主进程一个写入者，若将来多窗口各自持库需重新评估。
6. 渲染端 `messagesByChat` 作为投影，在「删除后自动落到下一个会话」等路径上会补一次 `chatLoad`；若将来加入大量会话，需要分页而非全量加载。
