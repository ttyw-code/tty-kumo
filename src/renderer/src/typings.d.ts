import type { AgentBridge } from '@/main/preload';
import type { IClientChannel } from '@/common/ipc';

declare module '*.css';

export {};

declare global {
  interface Window {
    /**
     * 通用 IPC 通道 —— **所有请求-响应型调用都走这里**，
     * 可调用的命令受 preload 白名单约束（见 common/ipc.ts 的 INVOKE_COMMANDS）。
     */
    ipcChannel?: IClientChannel;
    /** 仅剩推送订阅与单向答复两类能力，不再承载请求-响应调用 */
    agentBridge?: AgentBridge;
  }
}
