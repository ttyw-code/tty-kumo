import { contextBridge, ipcRenderer,webUtils } from 'electron';
import type { AgentStreamEvent, SendAgentMessage } from '@/common/ipc';

const SEND = 'agent:chat:send';
const ABORT = 'agent:chat:abort';
const STREAM = 'agent:stream';

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
});

contextBridge.exposeInMainWorld('webUtils', {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});
