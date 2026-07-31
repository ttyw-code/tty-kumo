export type AgentStreamKind = 'delta' | 'done' | 'aborted' | 'error';

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
  code?: AgentErrorCode;
  message?: string;
  usage?: { inputTokens: number; outputTokens: number };
  finishReason?: string;
}

export interface SendAgentMessage {
  content: string;
  chatId: string;
}

export const IPC = {
  send: 'agent:chat:send',
  abort: 'agent:chat:abort',
  stream: 'agent:stream',
} as const;
