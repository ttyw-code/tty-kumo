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
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AgentConfig {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  mock?: boolean;
}

export const IPC = {
  send: 'agent:chat:send',
  abort: 'agent:chat:abort',
  stream: 'agent:stream',
  configGet: 'agent:config:get',
  configSet: 'agent:config:set',
} as const;
