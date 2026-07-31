# Handoff — tty-kumo Agent 化阶段 0.5 完成，待阶段 1

**日期**：2026-07-31
**状态**：阶段 0（流式管道）+ 阶段 0.5（run 生命周期修正）已完成并通过构建/测试/人工 UI 验收；阶段 1（LLM 接入 + 配置）未开始。

## 背景

tty-kumo 是 Electron + Vite + React + TS 桌面应用（Windows），正在改造为 AI agent 应用。项目构建/架构命令见 `AGENTS.md`。完整改造路线（ASCII 架构图、缺口优先级清单、逐文件资产评估、MVP 阶段调整、风险清单）见 **`docs/handoff/architecture-report.md`**（Multi-Agent Systems Architect 子代理 2026-07-31 出具）。

## 已完成：阶段 0 — 流式管道（mock）

验收标准：点发送 → mock 流逐字到达 → 停止立即断。已实现 + 人工 UI 验收通过。

改动文件：

| 文件 | 改动 |
|---|---|
| `src/common/ipc.ts` | 新建。IPC contract：`AgentStreamEvent`（kind: delta/done/error）+ `IPC` channel 常量（send/abort/stream） |
| `src/main/agent/ipc.ts` | 新建。`registerAgentIpc()`：`agent:chat:send` handler 返回 runId + mock 流（20ms/字，setInterval）；`agent:chat:abort` 清 timer |
| `src/main/preload.ts` | 扩展 `agentBridge`：send/abort/onStream |
| `src/main/main.ts` | `initApp()` 末尾调 `registerAgentIpc()` |
| `src/renderer/src/store/index.ts` | 重写。messages/streaming state + sendMessage/appendDelta/finishStreaming/stopStreaming + 真会话 CRUD（newChat/deleteChat/标题自动生成） |
| `src/renderer/src/components/message/index.tsx` | 重写。真消息列表 + 流式光标 + 停止生成按钮 |
| `src/renderer/src/app.tsx` | onStream 订阅（useEffect，返回 unsubscribe）+ ChatInput onSend 接线 + 初始自动建会话 |
| `src/renderer/src/components/sidebar/index.tsx` | New Chat 按钮接线 `newChat()` |
| `src/renderer/src/components/chatList/index.tsx` | 删除菜单项接线 `deleteChat()`；移除空 console.log |
| `src/renderer/src/typings.d.ts` | 加 `window.agentBridge` 类型声明（import type from `@/common/ipc`） |

## 已完成：阶段 0.5 — run 生命周期修正

**目的**：阶段 0 只证明"管道通"，没证明"run 能活"。真实 run 的错误/中止/并发/窗口绑定问题由以下修正覆盖。人工 UI 验收通过（流式/停止/多会话/切会话/防重/删流式会话均无错误）。

验收标准：流式中停止标 `（已停止）`；切会话流式状态独立；双击发送不双跑；删流式会话自动中止。

改动文件：

| 文件 | 改动 |
|---|---|
| `src/common/ipc.ts` | 扩展。事件加 `chatId`；`kind` 加 `'aborted'`；error 带 `code`（`AgentErrorCode`）；send 入参改对象 `{content, chatId}`（`SendAgentMessage`）；done 预留 `usage`/`finishReason` 可选字段 |
| `src/main/agent/ipc.ts` | 重构。`Run` 存 `{ wc, chatId, timer?, startedAt }`；abort 用 `event.sender` 校验 `run.wc === event.sender`（弃用 `BrowserWindow.getFocusedWindow()`）；`webContents.on('destroyed')` 清该窗口 run；`setImmediate` 启动 mock → 契约"send resolve 前不产生任何流事件"；abort 发 `kind:'aborted'` 而非 done |
| `src/main/preload.ts` | send 入参改 `SendAgentMessage`；channel 字符串写死（sandbox preload 约束，不 import 运行时模块） |
| `src/renderer/src/typings.d.ts` | 同步 `send: (payload: SendAgentMessage) => Promise<string>` |
| `src/renderer/src/store/index.ts` | 重写。占位消息模式（发送时插 user+空 assistant 两条，delta 直接 append 到 assistant 消息）；消息按 `chatId` 分桶（`messagesByChat`）；流式按 chat 存（`streamingByChat`，含 `runId`+`assistantId`）；`sendMessage` 防重（已有 streaming 则 return）+ try/catch 落错误到占位消息；`handleStreamEvent` 统一分发（delta append / done 封口 / aborted 标 stopped / error 记 code+message）；`deleteChat` 自动 abort 该会话 run；`stopStreaming` 按当前会话 runId abort |
| `src/renderer/src/app.tsx` | onStream 改调 `handleStreamEvent`；`ChatInput disabled={!!streaming}`（流式中禁发） |
| `src/renderer/src/components/message/index.tsx` | 按 activeChatId 取消息/流式；光标定位到占位消息；`（已停止）` 标记；error 红字展示；空消息占位符 |
| `src/common/ipc.test.ts` | 新建。channel 同步测试：正则提取 preload.ts 与 common/ipc.ts 的 `'agent:...'` 字面量，断言集合相等（防 sandbox preload 双源静默失联） |

## 关键架构决策与坑（必须遵守）

1. **LLM 调用只能放主进程**。渲染进程 CSP 打包后只允许 `'self'`，外网封死；`sandbox: true` 下渲染无 Node。硬约束。
2. **sandbox preload 不能 require 外部模块**。rollup 会把共享模块拆成独立 chunk，preload 若 import 运行时模块会生成 `require('./xxx.cjs')` → 打包后崩溃。**已实际命中**。解法：preload 只用纯类型 import（`import type`），运行时 channel 字符串写死。新加 preload 逻辑保持此模式。**同步护栏**：`src/common/ipc.test.ts` 校验两处 channel 一致。
3. **渲染进程只持 zustand 投影**，agent 运行状态全在主进程。
4. **流式推送**：主→渲染用 `webContents.send('agent:stream', evt)`，渲染按 `chatId`+`runId` 路由（事件必须带 chatId，多会话并发靠它）。未用 MessageChannelMain（等实测需要再升级）。
5. **占位消息模式**：发送时插 user+空 assistant 两条消息，流式内容直接 append 到占位消息，消息数组是唯一真相源。`streaming` 只存 `{runId, assistantId}` 用于路由/标记。done/aborted/error 统一封口。
6. **run 生命周期契约**：send resolve 前不产生任何流事件（主进程 `setImmediate` 启动）；abort 事件用 `event.sender` 定位窗口，`run.wc === event.sender` 校验；窗口 `destroyed` 必须清 run（防泄漏）；abort 发 `kind:'aborted'`，停止与完成在数据层可区分。
7. **DB 复用**：lowdb worker 已走通，会话持久化直接 `JSON.stringify` 整块存 KV，不改 worker。**每轮 run 结束写一次，不逐 chunk 写**。
8. **零依赖 LLM 调用**：Electron 37 = Node 22，全局 fetch + ReadableStream 可用，手写 OpenAI 兼容调用，不引 SDK（避开 CJS bundle 问题）。若引 SDK 只选 CJS/纯 JS 包，禁原生二进制包。
9. **DI 是雷区**：`src/platform/instantiation/` 的 VSCode 风格 DI 零使用 + 装饰器在 vite-plugin-oxc 构建链未验证 + `GlobalIdleValue` 依赖未定义的 `_runWhenIdle`（`src/base/async.ts`）。MVP 不要启用。`src/base/cancellation.ts` 的 CancellationToken 自包含无 DI 依赖，可用。
10. **base/event.ts 是空文件**，不要恢复 VSCode Emitter。主进程用 Node EventEmitter，渲染用 zustand。
11. **safeStorage 必须在 `app.whenReady()` 后调用**。key 加密存 lowdb，明文绝不过 IPC。
12. **`src/renderer/src/store/index.ts` 里的 `AgentErrorCode`/`AgentStreamEvent` 从 `@/common/ipc` type import**，渲染端可安全引用类型（type-only 不产生运行时依赖）。

## 未完成 / 下一步：阶段 1 — LLM 接入 + 配置

验收标准：真实流式回复端到端到达；**错误路径端到端可见（无配置/断网/认证失败均报结构化错误，UI 红字展示）**；key 落盘为密文；重启后解密可用；双击发送不双跑；流式中切会话不丢回复。

任务清单（按顺序，前 4 步是 0.5 债已还完，这里直接开工阶段 1 主体）：
1. `src/main/agent/llm/provider.ts` — Provider 接口：`chat(messages, token) → AsyncIterable<Delta>`，支持流式 + 中止（用 `src/base/cancellation.ts` 的 CancellationToken + AbortController）。**首 token 超时 + inactivity 超时在此实现**。
2. `src/main/agent/llm/openai.ts` — OpenAI 兼容实现。零依赖：`fetch(url, {body: {stream: true}})` + `ReadableStream` 解析 SSE `data: {...}`。**用 tdd 写测试**：mock fetch 返回 SSE 流，断言 delta 序列与中止行为。
3. `src/main/agent/config.ts` — 配置（baseUrl/model/key）+ `safeStorage` 加密 key 存 lowdb。注意：safeStorage 在 main 进程 whenReady 后；`app.getPath('userData')` 下已有 `mydb` DB。`agent:config:set` 校验 baseUrl 是 http(s) URL。
4. 结构化错误映射：网络/超时/认证/rate_limit/context_length → `AgentErrorCode` + retryable。主进程退避重试（幂等——占位消息模式天然防重复落消息）。
5. 替换 `src/main/agent/ipc.ts` 的 mock 为真 runtime：provider 注入，mock 降级为显式 dev 模式，**默认无配置报 `no_config` 错误，绝不静默 mock**。
6. 新 IPC：`agent:config:get` / `agent:config:set`（set 只收明文 key，主进程加密，明文不外传）。配置热更新语义：运行中的 run 继续用旧配置，新 run 用新配置。
7. 渲染端配置弹窗（设置 baseUrl/model/key）——复用 HeroUI。配置缺失时发送 → error 事件带 `no_config`，UI 展示。
8. **Message schema 阶段 1 定型**：按 OpenAI 兼容结构预留 `tool_calls`/`tool_call_id`/role `tool` 字段（现在不用，阶段 3 填充而非迁移）。
9. 可观测性：每 run 一条结构化日志（runId/chatId/耗时/token/错误码），MVP 用 console + 内存环形缓冲，**字段从阶段 1 固定**（阶段 4 多 agent 面板靠它）。

依赖后续阶段（不在本次范围）：
- 阶段 2：会话持久化到 lowdb（`src/main/agent/session/store.ts`）+ 历史裁剪（估算函数阶段 1 可先写，接入点阶段 2）
- 阶段 3：工具调用系统（单 agent 单模型先立工具 schema）
- 阶段 4+：MCP client、多 agent orchestrator、token 计量、可观测面板

## 验证现状

- `npx tsc --noEmit` ✓
- `yarn build`（main + renderer）✓
- `yarn test` ✓（vitest 4/4：contextMenu 3 + ipc channel 同步 1）
- **人工 UI 验收** ✓（`yarn dev`：流式到达/停止即断标（已停止）/多会话切换不串台/流式中切会话不丢/双击不双跑/删流式会话中止——全部无错误）
- preload.cjs 打包产物无外部 chunk require ✓

## Suggested skills

- **`implement`** — 阶段 1 有明确任务清单（provider/openai/config/ipc），按 spec 逐项实现。
- **`tdd`** — 阶段 1 的 SSE 解析（`openai.ts`）是解析器逻辑，先写测试：mock fetch 返回 SSE 流，断言 Delta 序列与中止行为。
- **`code-review`** — 阶段 0.5 + 1 完成后 review 改动，对照架构报告验收（进程边界、sandbox preload 约束是否被破坏）。
- **`diagnose`** — 若阶段 1 验收发现流式不达/中止失效/首 token 竞态，用它定位。
- **`caveman`** — 本仓库 AGENTS.md 及所有 skill 要求简体中文交互，caveman 模式（中文压缩）匹配沟通风格。

## 注意

- 完整架构分析报告（ASCII 架构图、缺口优先级、资产评估）已落盘：**`docs/handoff/architecture-report.md`**。阶段 1 中需要完整依据直接读该文件，无需重跑分析。
- 无敏感信息涉及本文档。
