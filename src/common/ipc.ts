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

export interface SendAgentMessage {
  content: string;
  chatId: string;
  history: Array<{
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolCallId?: string;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  }>;
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
} as const;
