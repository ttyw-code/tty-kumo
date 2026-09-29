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
} as const;
