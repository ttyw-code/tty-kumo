import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AgentConfig, AgentStreamEvent, SendAgentMessage } from '@/common/ipc';

const SEND = 'agent:chat:send';
const ABORT = 'agent:chat:abort';
const STREAM = 'agent:stream';
const CONFIG_GET = 'agent:config:get';
const CONFIG_SET = 'agent:config:set';

export interface AgentBridge {
  send: (payload: SendAgentMessage) => Promise<string>;
  abort: (runId: string) => Promise<void>;
  onStream: (callback: (evt: AgentStreamEvent) => void) => () => void;
  configGet: () => Promise<AgentConfig>;
  configSet: (cfg: { baseUrl: string; model: string; apiKey: string }) => Promise<AgentConfig>;
}

contextBridge.exposeInMainWorld('appBridge', {
  quit: () => ipcRenderer.invoke('app:quit'),
  minimize: () => ipcRenderer.invoke('app:window:minimize'),
  close: () => ipcRenderer.invoke('app:window:close'),
});

contextBridge.exposeInMainWorld('agentBridge', {
  send: (payload: SendAgentMessage) => ipcRenderer.invoke(SEND, payload),
  abort: (runId: string) => ipcRenderer.invoke(ABORT, runId),
  onStream: (callback: (evt: AgentStreamEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, evt: AgentStreamEvent) => callback(evt);
    ipcRenderer.on(STREAM, listener);
    return () => ipcRenderer.removeListener(STREAM, listener);
  },
  configGet: () => ipcRenderer.invoke(CONFIG_GET),
  configSet: (cfg: { baseUrl: string; model: string; apiKey: string }) =>
    ipcRenderer.invoke(CONFIG_SET, cfg),
});

contextBridge.exposeInMainWorld('webUtils', {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});
