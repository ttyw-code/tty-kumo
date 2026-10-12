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

type ReplyPayload = { ok: true; value?: unknown } | { ok: false; error: IPCError };

/** 收到主进程的请求：找服务 → 执行 → 回信（成功和失败都要回，否则主进程会一直等） */
async function handleRendererRequest(message: RendererRequestMessage): Promise<void> {
  const reply = (payload: ReplyPayload) => {
    ipcRenderer.send(IPC.requestReply, { ...payload, id: message.id });
  };

  const handler = rendererHandlers.get(message.channel);
  if (!handler) {
    reply({
      ok: false,
      error: { code: 'no_handler', message: `渲染端未注册服务：${message.channel}` },
    });
    return;
  }

  try {
    reply({ ok: true, value: await handler(message.command, message.args) });
  } catch (err) {
    reply({ ok: false, error: toIPCError(err) });
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
