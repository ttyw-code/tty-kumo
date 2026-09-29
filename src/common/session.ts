// 会话数据模型：主进程（真相源）与渲染端（投影）共用。
// 这里只放类型、常量与纯校验，不得引入任何 node / electron 依赖。

export const SESSION_SCHEMA_VERSION = '1';
export const DEFAULT_CHAT_TITLE = '新会话';

/** chatId 只允许白名单字符：否则 `chat:${id}` 可能拼出 `chat:index` 覆盖索引 */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_ID_CHARS = 80;

/** 会话 id / 消息 id 的统一格式约束（白名单字符 + 长度上限） */
export function isValidEntityId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_CHARS && ID_PATTERN.test(id);
}

export const isValidChatId = isValidEntityId;

export interface ToolCallRecord {
  id: string;
  name: string;
  args: string;
  result?: string;
}

/**
 * assistant 消息的生命周期状态。
 * `streaming` 是运行中的占位，进程重启后仍残留的会被标成 `interrupted`。
 */
export type MessageStatus = 'streaming' | 'done' | 'aborted' | 'error' | 'interrupted';

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  status?: MessageStatus;
  stopped?: boolean;
  error?: { code: string; message: string };
  toolCalls?: ToolCallRecord[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ChatSummary {
  id: string;
  title: string;
  lastMessage: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
}
