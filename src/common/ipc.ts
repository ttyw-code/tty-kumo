import type { CancellationToken } from '@/base/cancellation';
import type { Event } from '@/base/event';

export type AgentStreamKind = 'delta' | 'tool' | 'tool_confirm' | 'done' | 'aborted' | 'error';

export type AgentErrorCode =
  | 'no_config'
  | 'network'
  | 'timeout'
  | 'auth'
  | 'rate_limit'
  | 'context_length'
  | 'unknown';

export interface AgentStreamEvent {
  runId: string;
  chatId: string;
  kind: AgentStreamKind;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: string;
  toolResult?: string;
  /** tool_confirm 事件的确认标识，渲染端回复时原样带回 */
  confirmId?: string;
  /** tool_confirm 事件上展示的后果说明 */
  confirmHint?: string;
  code?: AgentErrorCode;
  message?: string;
  usage?: { inputTokens: number; outputTokens: number };
  finishReason?: string;
}

/**
 * 发起一次对话。**不再携带 history** —— 历史由主进程从 SessionStore 读取，
 * 渲染端只是它的投影。重载窗口或多窗口才能拿到一致上下文。
 */
export interface SendAgentMessage {
  content: string;
  chatId: string;
  /** 渲染端乐观插入时的用户消息 id；主进程沿用，避免两端 id 分叉 */
  messageId?: string;
}

/** send 的返回值：assistantId 用于把后续流事件定位到同一条消息上 */
export interface StartRunResult {
  runId: string;
  assistantId: string;
}

/** 进行中的 run：窗口重载后渲染端靠它重新接上流式输出 */
export interface ActiveRun {
  runId: string;
  chatId: string;
  assistantId?: string;
  startedAt: number;
}

export interface AgentConfig {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  mock?: boolean;
}

/** 渲染端对 tool_confirm 的答复（经 agent:tool:confirm:reply 单向上报） */
export interface ToolConfirmReply {
  confirmId: string;
  decision: 'allow' | 'deny';
  /** allow 时是否记住「本次会话不再询问该工具」 */
  remember: boolean;
}

export const IPC = {
  send: 'agent:chat:send',
  abort: 'agent:chat:abort',
  stream: 'agent:stream',
  configGet: 'agent:config:get',
  configSet: 'agent:config:set',
  toolConfirmReply: 'agent:tool:confirm:reply',
  chatList: 'agent:chat:list',
  chatLoad: 'agent:chat:load',
  chatCreate: 'agent:chat:create',
  chatRename: 'agent:chat:rename',
  chatDelete: 'agent:chat:delete',
  runsList: 'agent:runs:list',
  appQuit: 'app:quit',
  appWindowMinimize: 'app:window:minimize',
  appWindowClose: 'app:window:close',
} as const;

export type IPCChannelName = (typeof IPC)[keyof typeof IPC];

/* ------------------------------------------------------------------ *
 * 通道抽象
 *
 * 目标是把「谁在调、调什么、失败长什么样」从 Electron 的 ipcMain /
 * ipcRenderer 里剥出来，业务侧只依赖下面这两个接口。
 * 分层与迁移步骤见 docs/specs/ipc-channel.md
 * ------------------------------------------------------------------ */

/**
 * 服务端（主进程）通道。
 *
 * `TContext` 是「谁发起的这次调用」，由实现方决定语义 ——
 * Electron 下应当是窗口标识（WebContents / BrowserWindow），
 * 而**不是**随手传一个 string。这里刻意不给默认值，
 * 免得调用方忽略它的存在。
 */
export interface IServerChannel<TContext> {
  call<T>(
    ctx: TContext,
    command: string,
    arg?: any,
    cancellationToken?: CancellationToken,
  ): Promise<T>;
  listen<T>(ctx: TContext, event: string, arg?: any): Event<T>;
}

/** 客户端（渲染端）通道：与服务端配对的另一半 */
export interface IClientChannel {
  call<T>(command: string, arg?: any, cancellationToken?: CancellationToken): Promise<T>;
  listen<T>(event: string, arg?: any): Event<T>;
}

/* ------------------------------------------------------------------ *
 * 客户端可访问面（白名单）
 *
 * ⚠️ 安全约束：contextIsolation + sandbox 下，preload 对外暴露一个泛型
 * `call` 等于把「任意 ipcRenderer.invoke」的能力交给渲染进程 —— 一旦渲染
 * 进程被注入，攻击面就从「十几个具名方法」放大到「所有 Electron 通道」。
 * 所以这里显式列出可访问命令，preload 只放行名单内的调用。
 *
 * 这份名单派生自 IPC 常量，由 common/ipc.test.ts 守着两件事：
 * 名单里的每个值都真实存在；IPC 里的每个通道都被归入下面三类之一。
 * ------------------------------------------------------------------ */

/** 可经 `IClientChannel.call` 调用（ipcMain.handle 型，有返回值） */
export const INVOKE_COMMANDS: readonly string[] = [
  // agent 域
  IPC.send,
  IPC.abort,
  IPC.configGet,
  IPC.configSet,
  IPC.chatList,
  IPC.chatLoad,
  IPC.chatCreate,
  IPC.chatRename,
  IPC.chatDelete,
  IPC.runsList,
  // 窗口控制域
  IPC.appQuit,
  IPC.appWindowMinimize,
  IPC.appWindowClose,
];

/** 可经 `IClientChannel.listen` 订阅（主 → 渲染推送型） */
export const EVENT_CHANNELS: readonly string[] = [IPC.stream];

/**
 * 单向 fire-and-forget（ipcRenderer.send 型）。
 * 语义上不是请求-响应，因此不纳入 call/listen，仍由具名方法暴露。
 */
export const ONE_WAY_COMMANDS: readonly string[] = [IPC.toolConfirmReply];

/* ------------------------------------------------------------------ *
 * 跨进程错误
 * ------------------------------------------------------------------ */

/**
 * 跨 IPC 边界的错误形态。
 *
 * Error 实例无法结构化克隆：直接 `throw` 到达渲染端时只剩一坨字符串，
 * 形如 `Error invoking remote method 'agent:chat:load': Error: 会话不存在或已被删除`，
 * `code` 等字段全部丢失。要保住结构，就只能不抛异常、改为返回下面的信封。
 */
export interface IPCError {
  code: string;
  message: string;
}

/** 统一信封：handler 失败时返回它，而不是抛异常 */
export type IPCResult<T> = { ok: true; value: T } | { ok: false; error: IPCError };

/**
 * 已迁移到 `IPCResult` 信封的通道。
 *
 * 渐进迁移期间不能「看返回值像不像信封」来猜 —— 业务返回值里可能恰好
 * 有 `ok` 字段。这份名单是唯一判据。
 *
 * 目前全部 invoke 通道都已迁移，因此它与 `INVOKE_COMMANDS` 等值；
 * 保留为独立名单是为了守住「新增通道要记得改 handler」这件事 ——
 * `common/ipc.test.ts` 会断言两者一致。
 */
export const ENVELOPE_COMMANDS: readonly string[] = [
  IPC.send,
  IPC.abort,
  IPC.configGet,
  IPC.configSet,
  IPC.chatList,
  IPC.chatLoad,
  IPC.chatCreate,
  IPC.chatRename,
  IPC.chatDelete,
  IPC.runsList,
  IPC.appQuit,
  IPC.appWindowMinimize,
  IPC.appWindowClose,
];

export function isEnvelopeCommand(command: string): boolean {
  return ENVELOPE_COMMANDS.includes(command);
}

export function isIPCResult(value: unknown): value is IPCResult<unknown> {
  if (!value || typeof value !== 'object') return false;
  const ok = (value as { ok?: unknown }).ok;
  if (ok === true) return 'value' in value;
  if (ok === false) return 'error' in value;
  return false;
}

/** 任意异常 → 可跨进程的 `IPCError` */
export function toIPCError(err: unknown, fallbackCode = 'unknown'): IPCError {
  if (err instanceof IPCChannelError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof Error) {
    // 业务错误（如 LLMError）会自带 code，例如 auth / rate_limit
    const withCode = err as unknown as { code?: unknown };
    const code = typeof withCode.code === 'string' ? withCode.code : fallbackCode;
    return { code, message: err.message || err.name || '未知错误' };
  }
  return { code: fallbackCode, message: String(err ?? '未知错误') };
}

/**
 * 把可能抛异常的 handler 包成信封。
 *
 * 这是「不抛异常」约定的主进程一半，另一半是客户端侧的 `IClientChannel.call`
 * 解包。两边都要有才成立 —— 只包不解等于把 `{ok:false}` 当正常值返回。
 */
export async function asIPCResult<T>(run: () => Promise<T> | T): Promise<IPCResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    return { ok: false, error: toIPCError(err) };
  }
}

/** 渲染端侧的通道错误：`code` 一定存在，catch 之后不必再猜字段 */
export class IPCChannelError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    /** 出错时正在执行的命令，便于定位 */
    public readonly command?: string,
  ) {
    super(message);
    this.name = 'IPCChannelError';
  }

  static from(error: IPCError, command?: string): IPCChannelError {
    return new IPCChannelError(error.code, error.message, command);
  }
}

/**
 * 从 Electron 包装过的 rejection 里尽力还原原始信息。
 *
 * 未迁移到信封的通道只能走到这里：Electron 把原始 message 拼进
 * `Error invoking remote method 'CHANNEL': Error: MESSAGE`，
 * 我们能救回 message，但 code 已经丢了 —— 这正是信封存在的理由。
 */
export function parseElectronError(err: unknown, command?: string): IPCChannelError {
  if (err instanceof IPCChannelError) return err;
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const match = /Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?(.*)/s.exec(raw);
  const message = (match?.[1] ?? raw).trim() || '未知错误';
  return new IPCChannelError('unknown', message, command);
}
