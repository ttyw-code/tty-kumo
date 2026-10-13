# Spec — IPC 通道抽象

**日期**：2026-10-12（10-13 补页面重载后的请求续传）
**状态**：已落地 —— 13 个请求-响应通道迁移完成；支持反向请求（主 → 渲染），并能在页面重载后续传未决请求
**背景**：IPC 此前有三套各写各的写法 —— `main.ts` 里 3 个通道用字面量硬编码、`agent/ipc.ts` 里 12 个通道把校验/逻辑/抛错全平铺、`preload.ts` 再手写一遍 12 个字符串常量和对应的具名方法。新增一个命令要同时改三处，且通道名在两处各自维护、随时可能漂移。

## 分层

```
                        ┌─ 渲染端主动 ─────────────────────────┐
渲染端  window.ipcChannel.call / listen  ──►  preload  ──►  ipcMain.handle
                        └──────────────────────────────────────┘

                        ┌─ 主进程主动（反向请求）────────────────┐
渲染端  window.ipcChannel.register(服务)  ◄──  preload  ◄──  RendererRequester
                        └──────────────────────────────────────┘
```

| 位置 | 职责 |
|---|---|
| `common/ipc.ts` | 接口、`IPC` 常量、四份名单、错误信封、反向请求协议形状 |
| `base/event.ts` | `Event<T>` 订阅契约（此前散在三处，现已收敛） |
| `main/preload.ts` | `IClientChannel` 的 Electron 实现：白名单、错误还原、反向请求分发 |
| `main/agent/renderer-request.ts` | `RendererRequester`：主进程发起反向请求、按 id 关联答复 |
| `main/agent/confirm.ts` | `ToolConfirmGateway`：建立在请求器之上的工具确认语义 |

`Event<T>` 之所以单独一个文件：`lifecycle.ts` 只管 Disposable 生命周期，而 Event 是「可被订阅的东西」的通用契约。**新增事件类型请从 `@/base/event` 引用，不要再就地定义。**

## ⚠️ 安全边界：三份白名单

contextIsolation + sandbox 下，preload 对外暴露泛型 `call(command, arg)`，等于把「任意 `ipcRenderer.invoke`」的能力交给渲染进程。一旦渲染进程被注入，攻击面就从「十几个具名方法」放大到「所有 Electron 通道」。

所以 `common/ipc.ts` 里显式列出名单，preload 只放行名单内的调用：

| 名单 | 数量 | 覆盖 | 语义 |
|---|---|---|---|
| `INVOKE_COMMANDS` | 13 | `agent:*` 10 + `app:*` 3 | `ipcMain.handle` 型，渲染端可 `call` |
| `EVENT_CHANNELS` | 1 | `agent:stream` | 主 → 渲染推送，渲染端可 `listen` |
| `INTERNAL_CHANNELS` | 2 | `agent:request` / `agent:request:reply` | preload 内部处理，**不对外开放** |
| `RENDERER_CHANNELS` | 1 | `toolConfirm` | 渲染端可注册给主进程调用的服务名 |

**这是这个抽象能成立的前提，别为了「方便」把它去掉。** `RENDERER_CHANNELS` 与 `INVOKE_COMMANDS` 是对称的：那边限制「渲染端能调主进程什么」，这边限制「渲染端能提供什么给主进程调」—— 主进程按名字找服务，名字必须来自名单，免得起草一个服务名去劫持主进程的预期。

`common/ipc.test.ts` 守着：名单里的命令都真实存在、每个通道都被归类不留孤儿、各类互不重叠且正好覆盖全部、全部 invoke 通道都已迁信封、preload 与主进程里没有手写的通道字符串。

## 通道参数约定

`call(command, arg)` 只接受**单个**可结构化克隆的值。多参数命令必须打包成对象：

```ts
// ✗ 通道契约不支持
call(IPC.chatRename, chatId, title);
// ✓
call(IPC.chatRename, { chatId, title });
```

好处是参数有明确的名字、加字段不算破坏性变更。

## 错误信封：为什么不能继续 throw

Error 实例无法结构化克隆。主进程直接 `throw new Error('会话不存在')`，渲染端收到的是一坨字符串：

```
Error invoking remote method 'agent:chat:load': Error: 会话不存在或已被删除
```

`code` 全丢，渲染端只能把整段文本原样展示。改为返回信封后 code 保住了：

| code | 含义 |
|---|---|
| `invalid_payload` / `invalid_chat_id` / `empty_content` | 参数问题 |
| `chat_busy` / `chat_not_found` / `no_window` | 状态问题 |
| `no_handler` | 反向请求时渲染端没注册对应服务 |
| `unknown` | 未分类；业务错误自带的 code（`auth` / `rate_limit` 等）会原样保留 |

两边都要有才成立 —— 主进程 `asIPCResult(...)` 包，客户端 `call` 解。**只包不解等于把 `{ok:false}` 当正常值返回。**

渐进迁移期间不能靠「返回值像不像信封」来猜（业务值里可能恰好有 `ok` 字段），唯一判据是 `ENVELOPE_COMMANDS` 名单；目前它与 `INVOKE_COMMANDS` 等值，保留为独立名单是为了守住「新增通道记得改 handler」，测试会断言两者一致。

## 反向请求：主进程怎么问渲染端

工具确认（「这个危险操作要不要放行」）本质上是**主进程向渲染端发起一次请求**。Electron 没有「主进程 invoke 渲染进程」的机制——`webContents.send` 只能单向推，所以自己配 id 关联答复：

```
主进程                                         渲染端
  │
  │  RendererRequester.request(wc, {channel, command, args, group: runId})
  │  ── agent:request { id, channel, command, args } ──►
  │                                                  preload 查服务表
  │                                                  handler(command, args)
  │                                                    ↓ 弹窗，等用户点击
  │  ◄── agent:request:reply { id, ok, value|error } ──
  │  按 id 找到 pending，resolve / reject
  ▼
```

时序上的关键点：

1. **渲染端要先注册**。应用启动时 `app.tsx` 注册 `toolConfirm` 服务，handler 返回 `store.askToolConfirm(...)` 的 Promise —— 这个 Promise 由弹窗在用户点击时兑现，**它就是「响应」**。
2. **请求的 id 由主进程生成**，渲染端原样带回；`ToolConfirmAsk` 里不再需要 `confirmId`。
3. **超时、窗口销毁、发送异常、run 中止，一律 reject**，`ToolConfirmGateway` catch 之后按「拒绝」处理（fail-closed）。渲染端没注册服务时 preload 回 `no_handler`，同样算拒绝。
4. **`remember` 只在明确放行时生效**，收敛在主进程和渲染端两处都做了。

收益：确认与「取消 / 超时 / 窗口销毁」共用一套失败语义；将来「让用户选个文件」「确认删除会话」这类反向询问可以直接复用同一条链路，不必再各造一条单向通道。

### 页面重载怎么办

确认框弹着的时候用户按了 Ctrl+R（或渲染进程崩溃后自动恢复）——**页面会回来，问题还在等答案**。这里必须把两种「页面消失」分开处理，混在一起就错了：

| 情况 | 处理 | 理由 |
|---|---|---|
| 重载 / 导航 | `suspendTarget` 停表 → `did-finish-load` 后 `resumeTarget` 重发，**id 不变** | 页面会回来，弹窗要重新出现，用户接着操作 |
| 窗口销毁 | `cancelTarget` 立即按失败结算 | 页面不会回来了，没必要白等到超时 |

接线在 `main.ts` 的 `createWindow()`：`did-start-navigation`（页内跳转如 hash 变化不算，不会触发）、`did-finish-load`、`destroyed`。

**续传的 id 必须保持不变**，否则渲染端的答复对不上原来的 Promise。续传时**重新开始计时**——页面加载本身可能好几秒，不该算进用户的思考时间。

重发可能早于渲染端的注册动作（`did-finish-load` 触发时 React 的 effect 未必跑完），所以 preload 里有一道**待投队列**：服务还没注册就先扣住，注册时补投。扣住有 5 秒上限——真没人注册就回 `no_handler`，不让主进程白等自己的 120 秒超时。

## 取消机制（当前取舍）

`call()` 签名保留了 `CancellationToken`，但**目前只做「调用前已取消」的短路**，真正的 mid-flight 取消仍走 `agent:chat:abort(runId)`。

要支持 mid-flight 取消，得在客户端为每次 call 分配 requestId、维护 `requestId ↔ token` 映射，再走一条 `$cancel` 通知 —— 而 Electron 的 `invoke` 本身不可中断，得改成 `send` + 回调通道。当前只有「停止生成」一个场景需要取消，`abort(runId)` 更直接。

代价是 `runId` 泄漏成了渲染端概念。将来取消场景变多再按上面的方案补。

反向请求那边已经有分组取消能力（`RendererRequester.cancelGroup(runId)`），run 中止时会把该 run 挂着的确认请求一并作废。

## `AgentBridge` 的残留职责

迁移后 `window.agentBridge` **只剩一个方法**，不要再往上加：

| 方法 | 为什么留着 |
|---|---|
| `onStream(cb)` | 主 → 渲染的单向推送。订阅式「返回取消函数」比 `IDisposable` 对象更贴合 React cleanup，且免去跨 contextBridge 代理对象的风险（未实测） |

`confirmTool` 已随反向请求一起删除 —— 答复不再是「调一个方法告诉主进程」，而是 handler 的返回值。

## 加一个新能力

**正向（渲染端调主进程）**：
1. `common/ipc.ts` 加进 `IPC` 常量、`INVOKE_COMMANDS`、`ENVELOPE_COMMANDS`
2. 主进程 handler 用 `asIPCResult(() => ...)` 包，错误抛 `IPCChannelError(code, message)`
3. 渲染端 `window.ipcChannel.call<T>(IPC.xxx, arg)`
4. `yarn test`

**反向（主进程调渲染端）**：
1. 服务名加进 `RENDERER_CHANNELS`
2. 渲染端启动时 `window.ipcChannel.register(name, handler)`
3. 主进程 `requester.request(wc, { channel, command, args, group })`
4. 记得给请求设置合理超时，并想清楚失败时按什么语义处理

## 已知边界 / 后续

> 这一节只列**设计取舍**与**待办**，不放缺陷。发现真缺陷请修掉或单独立项，别混进「边界」里 —— 那样容易把该修的东西说成是特性。

1. ~~渲染端重载后反向请求失联~~ → **已修**（挂起 + 续传 + 待投队列，见上面「页面重载怎么办」）。
2. **preload 的白名单检查、请求分发与待投队列没有自动化测试**（依赖 `ipcRenderer`，vitest 里跑不了）。目前靠 `common/ipc.test.ts` 校验名单数据自洽；协议逻辑本身由 `renderer-request.test.ts` 覆盖（19 个用例，含挂起/续传/作废）。
3. **主进程产物含共享 chunk**：`common/ipc.ts` 被 main 与 preload 共享，rollup 会抽出 `out/src/main/chunk-ipc.cjs`。
   - `chunkFileNames` 已固定为 `chunk-[name].cjs`。**改回默认的内容 hash 命名会出事**：`emptyOutDir: false` 下每次内容变化都留一个新 hash 文件且永不清理，而 `electron-builder.yml` 用 `out/**/*` glob —— 死 chunk 会被一起打进安装包。
   - 若将来把打包清单改成显式列文件，**务必带上 chunk**。
4. **`app:*` 已纳入，前缀约定放宽为 `agent:` 或 `app:`**。
