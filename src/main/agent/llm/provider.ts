import type { AgentErrorCode } from '@/common/ipc';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

export interface LLMDelta {
  text?: string;
  usage?: { inputTokens: number; outputTokens: number };
  finishReason?: string;
}

export interface ChatRequest {
  messages: LLMMessage[];
  model: string;
  baseUrl: string;
  apiKey: string;
  signal: AbortSignal;
}

export interface ChatProvider {
  requiresConfig?: boolean;
  chat(req: ChatRequest): AsyncIterable<LLMDelta>;
}

export class LLMError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}
