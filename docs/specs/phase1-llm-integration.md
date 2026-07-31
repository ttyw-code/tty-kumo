# Spec — 阶段 1:LLM 接入 + 配置

**日期**:2026-07-31
**状态**:规格化完成,待实现
**前置文档**:`docs/handoff/handoff-agent-phase1.md`(0.5 完成态)、`docs/handoff/architecture-report.md`(完整架构评估)

## Problem Statement

tty-kumo 目前所有对话回复都是 mock 流式(20ms/字假数据)。用户无法配置真实 LLM 服务,没有密钥加密体系,断网/无配置/认证失败时错误被吞,重启后对话全丢。应用看起来能对话,实际不能。

## Solution

接入真实 OpenAI 兼容 LLM 调用(零依赖 fetch + SSE),主进程持有配置与密钥(safeStorage 加密),结构化错误端到端可见,首打开无配置弹引导。为阶段 2 持久化与阶段 3 工具调用铺好 schema 与契约边界。

## User Stories

1. 作为用户,我想在应用里填写 baseUrl/model/API key,以便接入自己的 LLM 服务
2. 作为用户,我想 API key 落盘是密文,以便重启应用后无需重填且不被明文泄漏
3. 作为用户,我想首次打开(未配置)时弹出配置引导,以便不被"发消息才报错"撞懵
4. 作为用户,我想发送消息后看到真实模型逐字流式回复,以便确认 LLM 真的连上了
5. 作为用户,我想流式中点停止后已生成内容保留并标记已停止,以便不丢失半截回复
6. 作为用户,我想无配置/断网/认证失败/限流时看到结构化错误提示,以便知道发生了什么而不是静默失败
7. 作为用户,我想网络抖动时应用自动重试,以便不被瞬时错误打断
8. 作为用户,我想双击发送不会产生两个 run,以便回复不乱序
9. 作为用户,我想流式中切到别的会话再切回来,流式不丢,以便多会话并行可用
10. 作为用户,我想删除正在流式的会话时 run 自动中止,以便不浪费 token
11. 作为开发者,我想 Tool 契约边界在阶段 1 就画好,以便阶段 3 工具调用是填充不是迁移
12. 作为开发者,我想 AgentBridge 类型单源,以便 preload 与 typings 不会静默失联
13. 作为开发者,我想 worker 写串行化,以便阶段 2 多来源并发写 lowdb 不丢更新
14. 作为开发者,我想主进程 per-chat 并发护栏,以便渲染重载后不出现双 run 孤儿
15. 作为开发者,我想每个 run 有结构化日志字段,以便阶段 4 可观测面板有数据可画

## Implementation Decisions

### 架构不变式(写死,进测试)

- **密钥全主进程**:`agent:config:get` 永不返回明文 key,只返回 `{baseUrl, model, hasKey}`。明文 key 只进 `set`,主进程加密后落 lowdb。此契约写进 ipc 测试。
- **LLM 调用只进主进程**:renderer CSP `'self'` + `sandbox:true` 无 Node,硬约束不讨论。
- **mock 绝不静默顶替**:无配置时发送 → 结构化错误 `no_config`。mock 收敛到独立文件,仅 dev env flag 激活,生产路径零分支。
- **单推送通道 + kind union**:主→渲染只走 `agent:stream`,新事件(kind)进 union,不开新推送通道。事件永远带 `runId` + `chatId`。

### 模块与接口

- **`agent/llm/provider.ts`** — Provider 接口:`chat(messages, token) → AsyncIterable<Delta>`。Delta 含 `text?`、`usage?`、`finishReason?`。流式 + 中止(CancellationToken + AbortController)。
- **`agent/llm/openai.ts`** — OpenAI 兼容实现。零依赖:`fetch(url, {body: {stream:true}})` + ReadableStream 解析 SSE `data:` 行。**首 token 超时 + inactivity 超时**在此实现(provider 内部 setTimeout,不动 token 类)。
- **`agent/llm/mock.ts`** — mock 收敛于此,dev-only。生产路径不 import。
- **`agent/config.ts`** — Config Store。safeStorage 加密 key 存 lowdb KV(`app.whenReady()` 后调用,main.ts:22 已满足)。baseUrl 校验 http(s) URL。配置热更新语义:运行中 run 用旧快照,新 run 用新配置。
- **`agent/tools/types.ts`** — **阶段 1 就立**(架构报告偏差修正):Tool 契约 `name/description/inputSchema/execute 签名`,空实现,阶段 3 填充。这是 ToolRegistry 的边界。
- **`agent/run.ts` + `agent/ipc.ts` 拆分** — Run 类型状态机:`start→(running|awaiting_tool)→done/aborted/error`,含 `cts/configSnapshot/createdAt/finishedAt/usage`。ipc.ts 只做 IPC 适配。runs ledger = 未来 orchestrator 雏形。
- **IPC 扩展** — 新 channel:`agent:config:get` / `agent:config:set`。不扩 `SendAgentMessage` 入参。`agent:stream` 事件加 `code`/`usage`/`finishReason` 字段(contract 已预留)。

### 结构化错误

`AgentErrorCode`:no_config / network / timeout / auth / rate_limit / context_length / unknown。错误映射在主进程,退避重试(网络/限流可重试,认证/无配置不可重试)。重试幂等——占位消息模式天然防重复落消息。

### 渲染端

- store 占位消息模式保留;`sendMessage` try/catch 落结构化错误到占位消息;无配置时发送 → `no_config` 红字。
- `nextId()` 换 `crypto.randomUUID()`(持久化后跨重启消息键)。
- **Message schema 定型**:按 OpenAI 兼容结构,UI Message 加 `toolCalls?`/tool 角色字段(阶段 1 先不渲染,阶段 3 填充不迁移)。UI Message 与 LLM Message 之间定义明确映射函数。
- **AgentBridge 类型单源**:preload.ts 导出 type-only `AgentBridge`,typings.d.ts `import type`(不产生运行时 chunk,不违反 sandbox 约束)。channel 字符串双源保留,由 `src/common/ipc.test.ts` 护栏护。
- **配置引导**:启动时 `config.get` → 未配置 → 弹 HeroUI 配置弹窗(baseUrl/model/key)。发送中禁发已实现,保留。
- **主进程 per-chat 并发护栏**:send 时查该 chat 是否已有活跃 run,有则拒绝(防渲染重载后双 run)。
- **abort-all on quit**:应用退出时中止所有活跃 run,防孤儿烧 token。

### 数据模型

- 消息/流式状态按 chatId 分桶(zustand)保留。
- `streamingByChat {runId, assistantId}` 单 agent 场景够用;记录"一个 run = 一条 assistant 消息"假设,多 assistant 片段是未来升级点(阶段 4 处理,现在不实现)。

## Testing Decisions

- **好测试判据**:只测外部行为(SSE 流 → Delta 序列、中止 → 流中断、错误映射 → code),不测内部实现。
- **SSE 解析器**(`openai.ts`):mock fetch 返回 SSE 流,断言 Delta 序列与中止行为(手写 fake fetch + ReadableStream,不 mock 库)。这是纯解析器逻辑,最高价值的单测。
- **channel 同步**:`src/common/ipc.test.ts` 已有正则护栏,扩展覆盖新 channel 字面量。
- **config 契约**:`get` 返回值形状 + 永不返回明文 key + baseUrl URL 校验。
- **Run 状态机**:start→done/aborted/error 转换 + 中止传播(CTS → abort → 流中断)。
- **错误映射**:network/timeout/auth/rate_limit/context_length → 正确 code + retryable 标志。
- **先例**:`src/renderer/src/components/contextMenu/index.test.tsx`(vitest + happy-dom)、`src/common/ipc.test.ts`(纯 node 读文件断言)。
- **前置**:worker 写串行化(P1-1)——lowdb 整文件读改写,阶段 2 前必须,阶段 1 顺手做并测试并发 put 不丢。

## Out of Scope

- 会话持久化到 lowdb(阶段 2,含真相源迁移到主进程)
- 历史裁剪(阶段 2,估算函数可阶段 1 先写)
- 工具调用实现(阶段 3,Tool 契约边界阶段 1 已立)
- MCP client、多 agent orchestrator、token 计量面板、可观测面板(阶段 4+)
- markdown/代码块渲染(P1-6,单独排)
- UI 死按钮清理、演示文案移除(P1-7,独立小任务)
- 多窗口/多面板

## Further Notes

- 架构评估见 `docs/handoff/architecture-report.md`:P0 五项(真实 LLM/配置密钥/持久化/错误路径/引导)、P1 十项、P2 七项全表。
- 阶段 1 验收标准(从 handoff 更新):真实流式端到端到达;**错误路径端到端可见(无配置/断网/认证失败均结构化错误红字)**;key 落盘密文重启可用;双击不双跑;流式中切会话不丢;无配置绝不静默 mock。
- 依赖 skill:`tdd`(SSE 解析先写测试)、`implement`(任务清单实现)、`code-review`(完成后对照架构报告验收进程边界/sandbox 约束)。
