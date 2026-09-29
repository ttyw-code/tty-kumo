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

/** OpenAI function calling 所需的工具声明格式 */
export interface LLMTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** ToolDefinition → OpenAI tool 对象；risk/confirmHint 属于本地方针，不外发给模型 */
export function toOpenAITool(definition: ToolDefinition): LLMTool {
  return {
    type: 'function',
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.inputSchema,
    },
  };
}

export interface ChatRequest {
  messages: LLMMessage[];
  model: string;
  baseUrl: string;
  apiKey: string;
  signal: AbortSignal;
  tools?: LLMTool[];
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
