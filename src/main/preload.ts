import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  ActiveRun,
  AgentConfig,
  AgentStreamEvent,
  SendAgentMessage,
  StartRunResult,
  ToolConfirmReply,
} from '@/common/ipc';
import type { ChatRecord, ChatSummary } from '@/common/session';

const SEND = 'agent:chat:send';
const ABORT = 'agent:chat:abort';
const STREAM = 'agent:stream';
const CONFIG_GET = 'agent:config:get';
const CONFIG_SET = 'agent:config:set';
const TOOL_CONFIRM_REPLY = 'agent:tool:confirm:reply';
const CHAT_LIST = 'agent:chat:list';
const CHAT_LOAD = 'agent:chat:load';
const CHAT_CREATE = 'agent:chat:create';
const CHAT_RENAME = 'agent:chat:rename';
const CHAT_DELETE = 'agent:chat:delete';
const RUNS_LIST = 'agent:runs:list';

export interface AgentBridge {
  send: (payload: SendAgentMessage) => Promise<StartRunResult>;
  abort: (runId: string) => Promise<void>;
  onStream: (callback: (evt: AgentStreamEvent) => void) => () => void;
  configGet: () => Promise<AgentConfig>;
  configSet: (cfg: { baseUrl: string; model: string; apiKey: string }) => Promise<AgentConfig>;
  /** 答复主进程的工具执行确认请求 */
  confirmTool: (reply: ToolConfirmReply) => void;

  /** 会话列表（摘要，按更新时间倒序） */
  chatList: () => Promise<ChatSummary[]>;
  /** 读取单个会话的完整消息；不存在返回 null */
  chatLoad: (chatId: string) => Promise<ChatRecord | null>;
  chatCreate: (title?: string) => Promise<ChatRecord>;
  chatRename: (chatId: string, title: string) => Promise<ChatSummary | null>;
  chatDelete: (chatId: string) => Promise<void>;
  /** 窗口重载后用它重新接上仍在进行的 run */
  runsList: () => Promise<ActiveRun[]>;
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
  confirmTool: (reply: ToolConfirmReply) => {
    ipcRenderer.send(TOOL_CONFIRM_REPLY, reply);
  },

  chatList: () => ipcRenderer.invoke(CHAT_LIST),
  chatLoad: (chatId: string) => ipcRenderer.invoke(CHAT_LOAD, chatId),
  chatCreate: (title?: string) => ipcRenderer.invoke(CHAT_CREATE, title),
  chatRename: (chatId: string, title: string) => ipcRenderer.invoke(CHAT_RENAME, chatId, title),
  chatDelete: (chatId: string) => ipcRenderer.invoke(CHAT_DELETE, chatId),
  runsList: () => ipcRenderer.invoke(RUNS_LIST),
});

contextBridge.exposeInMainWorld('webUtils', {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});
