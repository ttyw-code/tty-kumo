import type { AgentErrorCode } from '@/common/ipc';
import type { ToolDefinition } from '../tools/types';

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
}

export interface LLMDelta {
  text?: string;
  toolCalls?: LLMToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
  finishReason?: string;
}

export interface ChatRequest {
  messages: LLMMessage[];
  model: string;
  baseUrl: string;
  apiKey: string;
  signal: AbortSignal;
  tools?: ToolDefinition[];
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
