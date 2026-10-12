import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  EVENT_CHANNELS,
  INVOKE_COMMANDS,
  IPC,
  IPCChannelError,
  isEnvelopeCommand,
  isIPCResult,
  parseElectronError,
  type AgentStreamEvent,
  type IClientChannel,
  type ToolConfirmReply,
} from '@/common/ipc';
import type { CancellationToken } from '@/base/cancellation';
import type { Event } from '@/base/event';

// 通道名唯一来源是 common/ipc.ts —— 这里不再手写字符串
const STREAM = IPC.stream;
const TOOL_CONFIRM_REPLY = IPC.toolConfirmReply;

/**
 * 只剩下两类**非请求-响应**能力：
 * - `onStream`：主 → 渲染的单向推送。订阅式的「返回取消函数」比 IDisposable
 *   对象更贴合 React 的 cleanup 写法，且免去跨 contextBridge 代理对象的风险
 * - `confirmTool`：fire-and-forget，本来就没有返回值可等
 *
 * 其余请求-响应型通道一律走 `window.ipcChannel`，不要再往这里加方法。
 */
export interface AgentBridge {
  onStream: (callback: (evt: AgentStreamEvent) => void) => () => void;
  confirmTool: (reply: ToolConfirmReply) => void;
}

/**
 * `IClientChannel` 的 Electron 实现。
 *
 * 两个约束：
 * - **白名单**：只放行 `INVOKE_COMMANDS` / `EVENT_CHANNELS`。contextIsolation 下
 *   没有这道闸，泛型 call 就等于把整个 ipcRenderer 交给渲染进程
 * - **错误还原**：已迁信封的通道能保住 `code`（目前全部 invoke 通道都已迁）
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
};

contextBridge.exposeInMainWorld('ipcChannel', channel);

contextBridge.exposeInMainWorld('agentBridge', {
  onStream: (callback: (evt: AgentStreamEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, evt: AgentStreamEvent) => callback(evt);
    ipcRenderer.on(STREAM, listener);
    return () => ipcRenderer.removeListener(STREAM, listener);
  },
  confirmTool: (reply: ToolConfirmReply) => {
    ipcRenderer.send(TOOL_CONFIRM_REPLY, reply);
  },
} satisfies AgentBridge);

contextBridge.exposeInMainWorld('webUtils', {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});
