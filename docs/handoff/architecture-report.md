# tty-kumo 架构评估报告（Multi-Agent Systems Architect）

**日期**：2026-07-31
**评估对象**：阶段 0.5 完成态 + handoff 文档计划（`docs/handoff/handoff-agent-phase1.md`）
**结论先行**：阶段 0/0.5 的工程质量在同类 Electron agent 项目里属于上游水平——进程边界决策、run 生命周期契约、sandbox preload 双源护栏都是对的。但当前代码里**主进程没有 run 状态机、渲染端没有重载恢复、DB worker 没有写串行化、store 的 Message 模型撑不到阶段 3**。这四件事现在不处理，阶段 1 做完会踩回来。

---

## 1. ASCII 架构图

### 1.1 目标架构（阶段 4+ 终态）

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ MAIN 进程（Node 22，CJS bundle）—— LLM/agent 状态/密钥 全在这里              │
│                                                                              │
│  ┌───────────────┐  ┌────────────────┐  ┌─────────────────────────────┐      │
│  │ Config Store   │  │ Session Store  │  │ Observability               │      │
│  │ baseUrl/model  │  │ lowdb key:     │  │ ring buffer + console       │      │
│  │ key* (safeStor)│  │ chat:{id}      │  │ trace_id / runId / cost     │      │
│  └──────┬────────┘  └───────┬────────┘  └──────────────┬──────────────┘      │
│         │                   │                           │                    │
│  ┌──────▼───────────────────▼───────────────────────────▼──────────────┐     │
│  │                Agent Orchestrator（runs ledger）                    │     │
│  │  run = { runId, chatId, wc, cts, configSnapshot,                   │     │
│  │         state: running|awaiting_tool|done|aborted|error,           │     │
│  │         createdAt, finishedAt, usage }                             │     │
│  └──────┬──────────────────┬────────────────────┬─────────────────────┘     │
│         │                  │                    │                           │
│  ┌──────▼────┐     ┌───────▼────────┐   ┌───────▼─────────┐                │
│  │ Agent(LLM)│     │ ToolRegistry   │   │ MCP Client      │                │
│  │ loop      │◄───►│ Tool 契约：     │   │ (阶段 4 接入，   │                │
│  │ (P3 单    │ tool│ name/desc/     │   │  tool defs 注入  │                │
│  │  agent)   │ call│ schema/execute │   │  registry)      │                │
│  └──────┬────┘     └───────┬────────┘   └───────┬─────────┘                │
│         │                  │                    │                           │
│  ┌──────▼──────────────────▼────────────────────▼────────────────────┐     │
│  │  LLM Provider（OpenAI 兼容，零依赖 fetch+SSE）                     │     │
│  │  CancellationToken + AbortController + 首token/inactivity 超时    │     │
│  │  + 退避重试 + 结构化错误映射 → AgentErrorCode                       │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│         │                                                                   │
│  ┌──────▼───────┐   ┌──────────────────────────────────────────────┐       │
│  │ DB Worker    │   │ ipcMain handlers                             │       │
│  │ lowdb KV     │◄──│ agent:chat:send/abort · agent:config:get/set │       │
│  │ 串行写队列    │   │ session:list/load/delete                     │       │
│  │ (P1 补)      │   └───────────────────┬──────────────────────────┘       │
│  └──────────────┘                       │ 单推送通道：webContents.send     │
└─────────────────────────────────────────┼─────────────(stream 事件,kind union)─┘
                                          │
┌─────────────────────────────────────────▼───────────────────────────────────┐
│ PRELOAD（sandbox，channel 字面量，仅 import type；ipc.test.ts 护栏）         │
│  appBridge / agentBridge: send·abort·onStream·configGet·configSet           │
│  AgentBridge 接口单源化（P1：preload 导出 type，typings import）             │
└─────────────────────────────────────────┬───────────────────────────────────┘
                                          │ contextBridge
┌─────────────────────────────────────────▼───────────────────────────────────┐
│ RENDERER（React 19 + zustand 投影）—— 不是真相源，是视图                    │
│  store: 消息/流式状态是主进程 session store 的缓存投影                      │
│  UI: Message（流式+工具卡片+markdown）· ConfigModal · Sidebar·ChatList      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 当前实际架构（阶段 0.5）

```
┌────────────────────────────────────────────────────────────┐
│ MAIN 进程                                                    │
│  main.ts: initApp → DB worker → registerIpcHandlers        │
│          → registerAgentIpc()                                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ agent/ipc.ts                                          │  │
│  │  runs Map<runId, {wc, chatId, timer?, startedAt}>     │  │
│  │  mock: setInterval 20ms/字 → webContents.send(delta)  │  │
│  │  abort: run.wc===sender 校验 → clearRun → send(aborted)│  │
│  │  窗口 destroyed → clearRun                             │  │
│  └──────────────────────────────────────────────────────┘  │
│  DB worker: lowdb KV（目前只存 app_uuid，agent 未接入）    │
└───────────────────────────────┬────────────────────────────┘
                                │ webContents.send(agent:stream)
┌───────────────────────────────▼────────────────────────────┐
│ PRELOAD: agentBridge {send, abort, onStream} + appBridge    │
│          + webUtils（多余，当前无文件功能）                  │
└───────────────────────────────┬────────────────────────────┘
┌───────────────────────────────▼────────────────────────────┐
│ RENDERER                                                    │
│  store/index.ts: messagesByChat + streamingByChat            │
│  渲染端 = 唯一真相源（会话未持久化，重启全丢）               │
│  app.tsx: onStream → handleStreamEvent                       │
│  Message/chatInput/sidebar/chatList/header                   │
└────────────────────────────────────────────────────────────┘
```

### 1.3 演进映射（并排对比）

| 模块 | 现在（0.5） | 终态（4+） | 差距 |
|---|---|---|---|
| run 跟踪 | `agent/ipc.ts` 65 行 `runs Map` + mock timer | Orchestrator ledger（状态机+快照+取消源） | 缺状态机/快照/取消源/查询接口 |
| 消息真相源 | 渲染 zustand | 主进程 Session Store | **须迁移**，渲染降级为投影 |
| DB 写 | 单请求无串行 | 串行写队列 + 分 key | 并发写会丢更新 |
| LLM | 无（mock） | Provider + OpenAI compat | 阶段 1 主体 |
| 配置/密钥 | 无 | Config Store + safeStorage | 阶段 1 主体 |
| 工具 | 无 | ToolRegistry 契约 + MCP | 契约应阶段 1 立，实现阶段 3 |
| 推送 | 单通道 stream 事件 | 单通道 + kind union（含 tool 事件） | 保持单通道，扩 kind |
| 可观测 | console.error 零散 | trace 贯穿 | 字段阶段 1 固定（handoff 已计划） |

---

## 2. 缺口优先级清单

### P0 — 不做不是"真实可用"

| # | 缺口 | 现在在哪 | 最小解法 | 前置 |
|---|---|---|---|---|
| P0-1 | **无真实 LLM 调用**。整个应用是 mock | 全 app 无 `agent/llm/` | handoff 阶段 1 任务 1-5：Provider 接口 + OpenAI SSE 实现 + 错误映射 + 退避重试 | 无 |
| P0-2 | **无配置/密钥体系**。设不了 baseUrl/key，密钥无加密 | 无 `agent/config.ts` | Config Store + safeStorage 加密 + `agent:config:get/set`；**get 绝不返回明文 key，只返 hasKey**（硬契约，写进测试） | safeStorage 需 whenReady 后（main.ts:22 已满足） |
| P0-3 | **会话不持久化**。重启后对话全丢 | store/index.ts `messagesByChat` 仅内存 | 阶段 2：每轮 run 结束 `JSON.stringify` 存 `chat:{id}` key + `chat:index` 列表 key | P0-1（schema 定型） |
| P0-4 | **错误路径不端到端**。主进程 handler 抛错落 `unknown` code | store/index.ts `{ code: 'unknown' }`；agent/ipc.ts 裸 throw | 阶段 1 任务 4-7：结构化错误映射 + no_config 红字 + 配置弹窗入口 | P0-1, P0-2 |
| P0-5 | **无配置引导**。第一打开不弹配置，用户只能发消息撞 no_config | app.tsx 无 config 读取 | 启动时 config.get → 未配置 → 弹引导弹窗（而非等报错） | P0-2 |

### P1 — 真实可用后立即要

| # | 缺口 | 现在在哪 | 最小解法 | 前置 |
|---|---|---|---|---|
| P1-1 | **DB worker 并发写丢更新** | lowdb-worker 的 put/del 各自 `db.write()`，无串行化。lowdb 读-改-写整文件，并发写互相覆盖 | worker 内加 Promise 串行队列（一次一个请求） | —（现在就该做，阶段 2 前必须） |
| P1-2 | **渲染重载后主进程 run 孤儿**。reload/崩溃 → store 重置，旧 run 继续跑完烧 token；新 store 的 runId 防重恰好能丢弃旧事件，但旧 run 白跑 | agent/ipc.ts runs Map 无查询 | abort-all on quit + 主进程 per-chat 并发护栏（send 时查该 chat 是否已有 run，有则拒绝） | — |
| P1-3 | **AgentBridge 签名双源失联**。typings.d.ts 手写签名，preload.ts 是另一份，两边不一致 tsc 不报（测试只护 channel 字面量，不护签名） | typings.d.ts vs preload.ts | preload.ts 导出 `export type AgentBridge = {...}`（type-only，不产生运行时 chunk），typings.d.ts `import type`。签名单源，channel 双源由测试护 | — |
| P1-4 | **历史无裁剪 → context_length 必现**。长会话把全部消息喂给 LLM | store/index.ts 消息只增不减 | 阶段 2 裁剪 + 估算函数（估算阶段 1 写，接入阶段 2） | P0-3 |
| P1-5 | **UI Message 与 LLM Message 是两套 schema，阶段 3 前必须统一决策** | store/index.ts（user/assistant）vs handoff 任务 8（OpenAI 结构） | 阶段 1 定映射函数 + UI Message 预留 `toolCalls?`/tool 角色（即使不渲染） | P0-1 |
| P1-6 | **无 markdown/代码块渲染**。agent 回复纯文本，代码/表格没法看 | message/index.tsx `whitespace-pre-wrap` | react-markdown（需新增依赖——评估后值得）或先只加代码块；**禁止 dangerouslySetInnerHTML** | — |
| P1-7 | **UI 死按钮**。Library/Explore、分享/重命名/置顶点击无反应 | sidebar/chatList | MVP 隐藏，实现时再开 | — |
| P1-8 | **mock 残留风险**。阶段 1 替换后 mock 代码若留 if/else 分支，可能误触 dev 模式 | agent/ipc.ts | mock 收敛为显式 dev-only（`agent/llm/mock.ts`，仅 env flag 激活），生产路径 0 分支 | P0-1 |
| P1-9 | **webUtils 暴露多余**。无文件功能却暴露 getPathForFile | preload.ts | 删除，等功能落地再加（最小权限） | — |
| P1-10 | **标题是内容截断**，不是 LLM 生成 | store/index.ts `content.slice(0,20)` | 阶段 2 换"首轮 run 后主进程生成标题" | P0-1 |

### P2 — 规模化 / 多 agent

| # | 缺口 | 最小解法 | 前置 |
|---|---|---|---|
| P2-1 | MCP client | 标准 MCP 客户端，tool defs 注入 ToolRegistry | P3 工具调用 |
| P2-2 | 多 agent orchestrator | 扩展 runs ledger（任务依赖、HITL 门、仲裁）——**不是新写一套** | P0-1 的 ledger 演进 |
| P2-3 | token 计量/成本面板、可观测面板 | 阶段 1 固定的字段直接用 | P0-1 任务 9 |
| P2-4 | DB batch/scan、worker 崩溃重启 | worker 增 batch 请求 + launcher 重启策略 | P1-1 |
| P2-5 | 会话量大后整块 JSON 写放大 | 迁移 SQLite 或分消息 key——**现在不换**，等实测瓶颈 | P0-3 |
| P2-6 | 多窗口/多面板 | runs ledger 的 wc 绑定扩展；当前先定"单窗口多面板" | P2-2 |
| P2-7 | 上下文 checkpoint/压缩（多 hop 需要） | 摘要压缩 + 关键字段保真 | P2-2 |

---

## 3. 资产评估（逐文件）

### 3.1 资产（保留/扩展）

| 文件 | 评价 |
|---|---|
| `src/common/ipc.ts` | **核心资产**。kind union + 可选字段 + 事件带 runId/chatId 的设计恰好撑住多会话。扩展路径明确：加 kind（如 `'tool_call'`/`'tool_progress'`）而非开新通道——**保持"单推送通道 + kind union"是 orchestrator 时代最重要的决定** |
| `src/base/cancellation.ts` | **资产，够用，别扩**。单 agent 场景 `token.onCancellationRequested(() => controller.abort())` 足够；首 token/inactivity 超时用 provider 内部 setTimeout 管理，不需要给 token 类加 linked/timeout 功能（组合需求到多 agent 再议）。注意两点：每个 run new CTS，结束即弃（防 listener 累积）；Run 对象必须持有 CTS 引用供 abort 用 |
| `src/main/database/`（persister/types/launcher） | **资产**。请求/响应 + 超时 + rejectAll 工程性好。唯一缺陷：worker 无写串行（P1-1）。types.ts 的 string-only KV 够阶段 2 用，batch/scan 留 P2 |
| `src/main/preload.ts` 的 channel 双源模式 | **资产**。sandbox 约束下的正确务实解，且有测试护栏 |
| `src/common/ipc.test.ts` | **中性偏资产**。正则抓字面量是防呆不是保证，但成本极低、护栏价值真实。阶段 1 加新 channel 时同步扩展即可 |
| `src/main/main.ts` 的安全基线 | **资产**。sandbox/contextIsolation/windowOpenHandler deny/will-attach-webview prevent 全部正确 |
| `src/renderer/src/store/theme-context.ts`、`contextMenu`（含测试） | **资产**，可复用 |
| `src/main/tray.ts` | **中性**，无需改 |

### 3.2 负债（重构/删除）

| 文件 | 问题 | 处置 |
|---|---|---|
| `src/main/agent/ipc.ts` mock 逻辑 | startMockReply/timer 是纯临时品，阶段 1 替换时**整体删除**，不保留分支。当前 `Run` 接口的 `timer?` 字段是 mock 专用 | 删，换 Run 状态机 |
| `src/main/agent/ipc.ts` send handler | `BrowserWindow.fromWebContents(event.sender)` 的 `win` 变量**是死代码**（未使用）；无 per-chat 防重；error 分支裸 throw 无 code | 重构为 ledger 雏形 |
| `src/renderer/src/store/index.ts` | ① **真相源在渲染端**——阶段 2 必须迁移到主进程，这是重构不是扩展，现在就要在计划里显式排期；② `nextId()` 用 `Date.now()+random`，持久化后成为跨重启的消息键，**换成 `crypto.randomUUID()`**；③ Message 无 tool 字段；④ 标题逻辑耦合在 sendMessage | 阶段 1 改 id + schema，阶段 2 迁真相源 |
| `src/base/event.ts`（空文件）、`src/platform/instantiation/`、`src/base/async.ts` | 已确认雷区，handoff 记录正确 | 不碰。MVP 结束前**考虑删除** instantiation 目录，防止有人误引 |
| `src/renderer/src/components/sidebar/index.tsx`、`chatList/index.tsx` | 演示残留：Bob/bob@example.com、"Pro AI components showcase"、空按钮×5 | MVP 隐藏死按钮与演示文案 |
| `src/main/preload.ts` webUtils | 最小权限违规（当前无文件功能） | 删 |
| `src/base/static/uuid.ts` vs agent/ipc.ts `crypto.randomUUID()` | 双 uuid 来源 | 统一 `crypto.randomUUID` |

### 3.3 专项评价（用户指定 8 点）

**① runs Map 作为 orchestrator 雏形够不够？**
够作雏形，但**当前结构必须演进**：`Run` 只有 `{wc, chatId, timer, startedAt}`，没有状态机、取消源、配置快照、完成回调。阶段 1 建议拆两文件：`agent/run.ts`（Run 类型 + 生命周期：start→(running|awaiting_tool)→done/aborted/error）+ `agent/ipc.ts`（IPC 适配）。orchestrator 与 run Map 的本质差别只有三个能力：run 生命周期事件化（observer 订阅）、可查询快照（重载恢复）、per-chat 并发约束。这三件事现在不做，阶段 4 必然返工。

**② mock 流式去留？**
删干净。保留形式只有一种：独立 `agent/llm/mock.ts`，仅 dev env flag 激活，生产路径零分支。"默认 no_config 绝不静默 mock"是对的，注意别把判断写进 provider 内部。

**③ store 的 messagesByChat/streamingByChat 对阶段 3 适配度？**
**不够，且成本最低的补救窗口就是阶段 1**。两个硬伤：
- `Message.role: 'user' | 'assistant'` 没有 tool 角色、没有 `toolCalls` 字段。阶段 3 工具调用需要一条消息内 text + tool_calls + tool_result 交替，UI Message 与 LLM Message 之间必须有一条明确的映射。现在不改，阶段 3 要迁移消息模型。
- `streamingByChat` 的 `{runId, assistantId}` 假设"一个 run = 一条 assistant 消息"。单 agent 工具调用仍是单 run 单回复序列（工具结果在内容层拼接），勉强能撑；但"run 内多个 assistant 片段"（未来多 agent 或重试分支）会崩。至少把 `assistantId` 升级为"消息列表快照指针"或明确放弃这个假设。
数据模型本身（chatId 分桶）是好的，保留。

**④ IPC contract 扩展性？**
好。三条扩展纪律值得固化成文档/测试：
- 新能力 = 新 channel（如 `agent:config:get/set`），不扩 `SendAgentMessage` 入参；
- 主→渲染推送只走 `agent:stream` 单通道 + kind union（tool 进度/标题事件都进这里），渲染端路由逻辑保持单点；
- 事件永远带 runId + chatId（已经是）。
这个纪律是阶段 4 多 agent 不散架的前提。

**⑤ DB worker + 整块 JSON 存会话的长期可行性？**
阶段 2 可用，有两个前提必须满足：
- **写串行化**（P1-1）——lowdb 的 `db.write()` 是整文件读改写，worker 里并发 put 必丢更新。现在只有一个 writer 不触发，阶段 2 的"会话写 + config 写 + run 结束写"并发后必现。
- **分 key**：每 chat 一个 `chat:{id}` key + `chat:index` 列表 key，**绝不要一个 key 存所有会话**。配合裁剪，单 key 保持 ≤ 数十 KB。
长期（P2-5）：会话上百/消息上万时整块序列化+写盘成本会超过桌面应用可感知阈值，届时换 SQLite 或分消息 key。现在不换是对的。

**⑥ cancellation.ts 能否承担 provider 中止？**
能。`onCancellationRequested` 的 listener 在 cancel 后不会自动清空（只对立即请求的 listener 返回空 dispose），run 结束时要弃掉 CTS 引用而不是复用，否则 runs Map 里攒一堆已 cancel 的 source。

**⑦ preload/typings 双源 channel 方案？**
务实，保留。唯一真缺口是**签名双源**（P1-3）：typings.d.ts 的 Window 接口与 preload 的实际 expose 不共享类型，改一个忘一个 tsc 不报。解法是 preload 导出 type-only 的 `AgentBridge` 接口，typings import——`import type` 不产生运行时 require，不违反 sandbox 约束。channel 字符串双源保持由测试护栏护。

**⑧ chatList/sidebar/header/tray 等 UI 资产？**
tray 是资产。theme/contextMenu 是资产。sidebar/header/chatList 的骨架是可复用的，但**演示内容（Bob 假身份、空按钮×5）是负债**——"看起来能用、点了没反应"比"没有"更伤真实可用性。MVP 隐藏，功能落地再开。

---

## 4. MVP 四阶段评估

对照用户三要点：

| 要求 | 现状 | 结论 |
|---|---|---|
| LLM/agent 状态/密钥全主进程 | 架构已满足（CSP+sandbox 硬约束逼出来的） | ✅ 满足，唯一要写死：`agent:config:get` 永不返 key |
| 单 agent 起步留 ToolRegistry 边界 | **handoff 只在阶段 3 提"工具 schema"，阶段 1 没立 Tool 契约文件** | ⚠️ **偏差**。ToolRegistry 的边界应该阶段 1 就画：建 `agent/tools/types.ts` 定义 Tool 契约（name/description/inputSchema/execute 签名），空实现，阶段 3 填充。现在不立，阶段 3 又要做一轮 schema 决策 |
| MVP 四阶段 | 划分合理 | ✅ 满足 |

**阶段划分偏差与调整建议**：

1. **阶段 2 的最大隐藏工作没进清单**：清单只写"会话持久化 + 历史裁剪"，但持久化意味着**消息真相源从渲染 zustand 迁移到主进程 Session Store**——这是架构级重构（渲染降级为投影、store 的 messagesByChat 变成缓存），必须显式排在阶段 2 任务第一条，否则阶段 2 做完发现持久化与渲染状态不同步。
2. **阶段 1 任务清单缺 6 项**（P0-5 引导弹窗、P1-3 AgentBridge 类型单源化、P1-8 mock 收敛、P1-5 UI/LLM schema 映射决策、主进程 per-chat 防重、abort-all on quit）。其中 schema 映射决策尤其重要——它决定阶段 3 是填充还是迁移。
3. **阶段 3 依赖阶段 1 的 schema 定型**，但没说明 UI 侧要不要同步加 tool 字段——建议阶段 1 就把 UI Message 加 `toolCalls?`，渲染端先不渲染，避免阶段 3 迁移。
4. 阶段 4 的 orchestrator 应明确"扩展 runs ledger 而非新写"，observability 字段阶段 1 固定是对的，继续保持。

---

## 5. 风险清单（最可能翻车的 5 点）

| # | 风险 | 触发场景 | 防线 |
|---|---|---|---|
| R1 | **渲染重载/崩溃 → 主进程 run 孤儿 + 双 run**。reload 后 store 重置，旧 run 继续跑完烧 token；渲染端防重失效后主进程无 per-chat 防重兜底 | 打包后渲染进程异常 reload（Electron 真实场景）；dev Ctrl+R | P1-2：主进程 per-chat 并发护栏 + abort-all on quit + 重载后状态查询快照 |
| R2 | **DB 并发写丢更新**。lowdb 整文件读改写，worker 无串行队列 | 阶段 2 会话写 + config 写并发；未来多 agent 并发 put | P1-1：worker 内串行队列，阶段 2 前必做 |
| R3 | **密钥经 IPC 泄漏**。`agent:config:get` 实现时手滑返回明文 key，或 XSS 借 agentBridge 读配置 | 阶段 1 config IPC 实现；将来渲染引入外部内容渲染 | 硬契约：get 只返 `{baseUrl, model, hasKey}`，写进 ipc.test；preload 只暴露最小 API |
| R4 | **阶段 3 消息模型迁移**。UI Message 无 tool 角色/tool_calls，工具调用时被迫迁移，波及流式渲染、持久化 schema、历史裁剪 | 阶段 3 接工具调用第一天 | P1-5：阶段 1 就把 tool 字段/映射决策落掉 |
| R5 | **mock 残留进生产路径**。替换时 if/else 分支保留 mock，无配置时静默 mock，用户以为在跟真 LLM 对话 | 阶段 1 替换 agent/ipc.ts 时 | P1-8：mock 收敛独立文件 + dev-only flag，生产路径零分支；验收清单加"无配置必报 no_config" |

**次高风险（未进 top5 但值得知道）**：SSE 解析错误处理（靠 tdd 测试扛）；safeStorage 在 Linux 无 keyring 时抛错（Windows 为主，降级提示即可）；`transparent:true` frameless 窗口的 Windows 渲染偶发问题（历史遗留，非本次范围）。

---

**一句话总结**：阶段 0/0.5 的路走对了，但"runs Map 是无状态假笑、渲染端是伪真相源、DB 是串行单点"这三个隐患会在阶段 1→3 依次引爆。现在花半天把 Tool 契约空文件、AgentBridge 类型单源化、主进程 per-chat 防重、worker 写串行做掉，后面四阶段全是线性推进；不做，每个阶段都要回头补债。
