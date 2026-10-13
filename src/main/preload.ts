import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  EVENT_CHANNELS,
  INVOKE_COMMANDS,
  IPC,
  IPCChannelError,
  RENDERER_CHANNELS,
  isEnvelopeCommand,
  isIPCResult,
  parseElectronError,
  toIPCError,
  type AgentStreamEvent,
  type IClientChannel,
  type IPCError,
  type RendererChannelHandler,
  type RendererRequestMessage,
} from '@/common/ipc';
import type { CancellationToken } from '@/base/cancellation';
import type { Event } from '@/base/event';
import type { IDisposable } from '@/base/lifecycle';

// 通道名唯一来源是 common/ipc.ts —— 这里不再手写字符串
const STREAM = IPC.stream;

/**
 * 只剩一项能力：主 → 渲染的单向推送。
 * 请求-响应走 `window.ipcChannel`，反向询问走 `register`。
 */
export interface AgentBridge {
  onStream: (callback: (evt: AgentStreamEvent) => void) => () => void;
}

/** 渲染端注册的服务：服务名 → 处理函数 */
const rendererHandlers = new Map<string, RendererChannelHandler>();

/**
 * 服务尚未注册就先到的请求，先扣住。
 *
 * 页面重载后主进程会把挂起的请求重发过来，而重发完全可能早于渲染端的注册动作
 * （`did-finish-load` 触发时 React 的 effect 未必跑完）。扣住并在注册时补投，
 * 两侧就不必假设对方的时序，也不会出现「请求已到却被当成未注册服务拒掉」的偶发失败。
 */
const heldRequests: { message: RendererRequestMessage; timer: ReturnType<typeof setTimeout> }[] = [];

/**
 * 扣住的请求最多等多久。
 *
 * 扣住是为了容忍「重发比注册早」这个窗口期，但不能变成无限等待 ——
 * 如果渲染端压根没注册这个服务，应当尽快回绝，而不是让主进程等满自己的超时。
 */
const HELD_TIMEOUT_MS = 5_000;

type ReplyPayload = { ok: true; value?: unknown } | { ok: false; error: IPCError };

/** 收到主进程的请求：找服务 → 执行 → 回信（成功和失败都要回，否则主进程会一直等） */
async function handleRendererRequest(message: RendererRequestMessage): Promise<void> {
  const reply = (payload: ReplyPayload) => {
    ipcRenderer.send(IPC.requestReply, { ...payload, id: message.id });
  };

  const handler = rendererHandlers.get(message.channel);
  if (!handler) {
    const timer = setTimeout(() => {
      const index = heldRequests.findIndex((held) => held.message.id === message.id);
      if (index === -1) return; // 已经被 flush 投递走了
      heldRequests.splice(index, 1);
      reply({
        ok: false,
        error: { code: 'no_handler', message: `渲染端未注册服务：${message.channel}` },
      });
    }, HELD_TIMEOUT_MS);

    heldRequests.push({ message, timer });
    return;
  }

  try {
    reply({ ok: true, value: await handler(message.command, message.args) });
  } catch (err) {
    reply({ ok: false, error: toIPCError(err) });
  }
}

/** 新服务注册后，把它一直扣着的请求补投出去 */
function flushHeldRequests(): void {
  for (let i = heldRequests.length - 1; i >= 0; i--) {
    const held = heldRequests[i];
    if (!rendererHandlers.has(held.message.channel)) continue;
    clearTimeout(held.timer);
    heldRequests.splice(i, 1);
    void handleRendererRequest(held.message);
  }
}

/**
 * `IClientChannel` 的 Electron 实现。
 *
 * 三条硬约束：
 * - **白名单**：只放行 `INVOKE_COMMANDS` / `EVENT_CHANNELS` / `RENDERER_CHANNELS`。
 *   contextIsolation 下没有这道闸，泛型 call 就等于把整个 ipcRenderer 交给渲染进程
 * - **错误还原**：已迁信封的通道能保住 `code`（目前全部 invoke 通道都已迁）
 * - **注册幂等**：同名服务覆盖即可，页面重载后重新注册，不必手动注销
 */
const channel: IClientChannel = {
  async call<T>(
    command: string,
    arg?: unknown,
    cancellationToken?: CancellationToken,
  ): Promise<T> {
    if (!INVOKE_COMMANDS.includes(command)) {
      throw new IPCChannelError('unknown', `命令不在白名单内：${command}`, command);
    }
    // 取消目前仍走 agent:chat:abort(runId)，token 只做「调用前已取消」的短路。
    // 真正的 mid-flight 取消需要 requestId ↔ token 映射，见 docs/specs/ipc-channel.md
    if (cancellationToken?.isCancellationRequested) {
      throw new IPCChannelError('unknown', '调用已被取消', command);
    }

    try {
      const raw = await ipcRenderer.invoke(command, arg);
      if (isEnvelopeCommand(command) && isIPCResult(raw)) {
        if (!raw.ok) throw IPCChannelError.from(raw.error, command);
        return raw.value as T;
      }
      return raw as T;
    } catch (err) {
      throw parseElectronError(err, command);
    }
  },

  listen<T>(event: string, _arg?: unknown): Event<T> {
    if (!EVENT_CHANNELS.includes(event)) {
      throw new IPCChannelError('unknown', `事件通道不在白名单内：${event}`, event);
    }
    // Electron 的通道不支持按参数过滤，arg 目前只是契约占位
    return (listener) => {
      const wrapped = (_e: Electron.IpcRendererEvent, payload: T) => {
        listener(payload);
      };
      ipcRenderer.on(event, wrapped);
      return {
        dispose: () => {
          ipcRenderer.removeListener(event, wrapped);
        },
      };
    };
  },

  register(name: string, handler: RendererChannelHandler): IDisposable {
    if (!RENDERER_CHANNELS.includes(name)) {
      throw new IPCChannelError('unknown', `不可注册的服务名：${name}`, name);
    }
    if (typeof handler !== 'function') {
      throw new IPCChannelError('invalid_payload', 'handler 必须是函数', name);
    }
    rendererHandlers.set(name, handler);
    // 这个服务可能已经有请求在等着（页面重载后主进程抢跑），补投
    flushHeldRequests();
    return {
      dispose: () => {
        // 只有还没被新注册覆盖时才移除，避免把后来的注册误删
        if (rendererHandlers.get(name) === handler) rendererHandlers.delete(name);
      },
    };
  },
};

ipcRenderer.on(IPC.request, (_e, message: RendererRequestMessage) => {
  void handleRendererRequest(message);
});

contextBridge.exposeInMainWorld('ipcChannel', channel);

contextBridge.exposeInMainWorld('agentBridge', {
  onStream: (callback: (evt: AgentStreamEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, evt: AgentStreamEvent) => callback(evt);
    ipcRenderer.on(STREAM, listener);
    return () => ipcRenderer.removeListener(STREAM, listener);
  },
} satisfies AgentBridge);

contextBridge.exposeInMainWorld('webUtils', {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});
