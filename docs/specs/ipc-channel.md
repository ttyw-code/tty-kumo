# Spec — IPC 通道抽象

**日期**：2026-10-12
**状态**：已落地 —— 13 个请求-响应通道全部迁移完成
**背景**：IPC 此前有三套各写各的写法 —— `main.ts` 里 3 个通道用字面量硬编码、`agent/ipc.ts` 里 12 个通道把校验/逻辑/抛错全平铺、`preload.ts` 再手写一遍 12 个字符串常量和对应的具名方法。新增一个命令要同时改三处，且通道名在两处各自维护、随时可能漂移。

## 分层

```
渲染端   window.ipcChannel          ← IClientChannel：call / listen
            │
preload  命令白名单 + 错误还原       ← 唯一的安全闸门，见下
            │
主进程    ipcMain.handle + asIPCResult
```

| 位置 | 职责 |
|---|---|
| `common/ipc.ts` | 接口、`IPC` 常量、三类白名单、错误信封与工具函数 |
| `base/event.ts` | `Event<T>` 订阅契约（此前散在三处，现已收敛） |
| `main/preload.ts` | `IClientChannel` 的 Electron 实现，暴露为 `window.ipcChannel` |
| `main/agent/ipc.ts` / `main/main.ts` | 业务 handler，全部经 `asIPCResult` 返回信封 |

`Event<T>` 之所以单独一个文件：`lifecycle.ts` 只管 Disposable 生命周期，而 Event 是「可被订阅的东西」的通用契约，IPC 的 `listen` 和 InstantiationService 都要用。**新增事件类型请从 `@/base/event` 引用，不要再就地定义。**

## ⚠️ 安全边界：泛型 call 必须配白名单

contextIsolation + sandbox 下，preload 对外暴露一个泛型 `call(command, arg)`，等于把「任意 `ipcRenderer.invoke`」的能力交给渲染进程。一旦渲染进程被注入，攻击面就从「十几个具名方法」放大到「所有 Electron 通道」。

所以 `common/ipc.ts` 里显式列出三类名单，preload 只放行名单内的调用：

| 名单 | 数量 | 覆盖 | 语义 |
|---|---|---|---|
| `INVOKE_COMMANDS` | 13 | `agent:*` 10 个 + `app:*` 3 个 | `ipcMain.handle` 型，有返回值，可 `call` |
| `EVENT_CHANNELS` | 1 | `agent:stream` | 主 → 渲染推送型，可 `listen` |
| `ONE_WAY_COMMANDS` | 1 | `agent:tool:confirm:reply` | `ipcRenderer.send` 型，fire-and-forget |

**这是这个抽象能成立的前提，别为了「方便」把它去掉。** `common/ipc.test.ts` 守着四件事：名单里的命令都真实存在、每个通道都被归类（不留孤儿）、三类互不重叠且正好覆盖全部、同一个通道不会同时出现在两类里。

## 通道参数约定

`call(command, arg)` 只接受**单个**可结构化克隆的值。多参数命令必须打包成对象：

```ts
// ✗ 通道契约不支持
call(IPC.chatRename, chatId, title);
// ✓
call(IPC.chatRename, { chatId, title });
```

这条约束来自 VSCode 的 channel 契约，好处是参数有明确的名字、易于向后兼容（加字段不算破坏性变更）。

## 错误信封：为什么不能继续 throw

Error 实例无法结构化克隆。主进程直接 `throw new Error('会话不存在')`，渲染端收到的是一坨字符串：

```
Error invoking remote method 'agent:chat:load': Error: 会话不存在或已被删除
```

`code` 等字段全丢，渲染端只能把整段文本原样展示给用户。

改为返回信封后，错误带上了明确的 code，渲染端可以据此区分「该提示用户」还是「该重试」：

| code | 含义 |
|---|---|
| `invalid_payload` | 参数结构不对 |
| `invalid_chat_id` | chatId 格式不合法（必须 `^[A-Za-z0-9_-]{1,80}$`） |
| `empty_content` | 消息内容为空 |
| `chat_busy` | 该会话已有进行中的回复 |
| `chat_not_found` | 会话不存在或已被删除 |
| `no_window` | 找不到发送窗口 |
| `unknown` | 未分类 |

业务错误自带的 code（如 `LLMError` 的 `auth` / `rate_limit`）会被 `toIPCError` 原样保留。

两边都要有才成立 —— 主进程 `asIPCResult(...)` 负责包，客户端 `call` 负责解。**只包不解等于把 `{ok:false}` 当正常值返回。**

渐进迁移期间**不能靠「返回值像不像信封」来猜** —— 业务返回值里可能恰好有 `ok` 字段。唯一判据是 `ENVELOPE_COMMANDS` 名单；目前它与 `INVOKE_COMMANDS` 等值，保留为独立名单是为了守住「新增通道记得改 handler」，测试会断言两者一致。

## 取消机制（当前取舍）

`call()` 签名保留了 `CancellationToken`，但**目前只做「调用前已取消」的短路**，真正的 mid-flight 取消仍走 `agent:chat:abort(runId)`。

原因是两者成本差一个量级：要支持 mid-flight 取消，得在客户端为每次 call 分配 requestId、维护 `requestId ↔ token` 映射，再走一条 `$cancel` 通知 —— 而 Electron 的 `invoke` 本身不可中断，得改成 `send` + 回调通道。当前只有「停止生成」一个场景需要取消，`abort(runId)` 更直接。

代价是 `runId` 泄漏成了渲染端概念。将来若取消场景变多，再按上面的方案补。

## `AgentBridge` 的残留职责

迁移后 `window.agentBridge` 只剩下两类**非请求-响应**能力，不要再往上加方法：

| 方法 | 为什么留着 |
|---|---|
| `onStream(cb)` | 主 → 渲染的单向推送。订阅式「返回取消函数」比 `IDisposable` 对象更贴合 React cleanup，且免去跨 contextBridge 代理对象的风险（未实测） |
| `confirmTool(reply)` | fire-and-forget，本来就没有返回值可等 |

## 迁一个新通道

1. `common/ipc.ts`：把通道加进 `IPC` 常量、`INVOKE_COMMANDS`、`ENVELOPE_COMMANDS`
2. 主进程 handler 用 `asIPCResult(() => ...)` 包起来，内部错误抛 `IPCChannelError(code, message)`
3. 渲染端调用点用 `window.ipcChannel.call<T>(IPC.xxx, arg)`
4. `yarn test` —— 通道表护栏会检查归类是否完整，也会检查 preload / 主进程里没再手写通道字符串

## 已知边界 / 后续

1. **`ONE_WAY_COMMANDS` 未纳入抽象**：`tool_confirm` 本质是「主进程向渲染端发起的请求-响应」，现在被拆成「stream 出 + 单向 send 回」两条通道来规避 invoke 悬挂。真正的双向 channel 需要单独设计。
2. **preload 的白名单检查逻辑没有自动化测试**（依赖 `ipcRenderer`，vitest 里跑不了）。目前靠 `common/ipc.test.ts` 校验名单数据本身自洽。
3. **主进程产物含共享 chunk**：`common/ipc.ts` 被 main 与 preload 共享，rollup 会抽出 `out/src/main/chunk-ipc.cjs`，preload 用相对路径 require 它。
   - 已把 `chunkFileNames` 固定为 `chunk-[name].cjs`。**改回默认的内容 hash 命名会出事**：`emptyOutDir: false` 下每次内容变化都留一个新 hash 文件且永不清理，而 `electron-builder.yml` 用 `out/**/*` glob —— 死 chunk 会被一起打进安装包（实测曾累积出 3 个，其中一个是两个月前的）。
   - 若将来把打包清单改成显式列文件，**务必带上 chunk**，否则打包后 preload 加载失败。
4. **`app:*` 已纳入，但前缀约定放宽了**：原来测试要求所有通道以 `agent:` 开头，现在允许 `agent:` 或 `app:`。
