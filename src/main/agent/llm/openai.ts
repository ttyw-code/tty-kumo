import {
  ChatProvider,
  ChatRequest,
  LLMDelta,
  LLMError,
} from './provider';

interface StreamChunk {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string };
}

export class OpenAIProvider implements ChatProvider {
  requiresConfig = true;

  constructor(
    private opts: { firstTokenTimeoutMs?: number; inactivityTimeoutMs?: number } = {},
  ) {}

  async *chat(req: ChatRequest): AsyncGenerator<LLMDelta> {
    const { baseUrl, model, apiKey, signal, messages } = req;
    const firstTokenTimeoutMs = this.opts.firstTokenTimeoutMs ?? 30_000;
    const inactivityTimeoutMs = this.opts.inactivityTimeoutMs ?? 60_000;

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });

    let firstTokenTimer: NodeJS.Timeout | undefined;
    let inactivityTimer: NodeJS.Timeout | undefined;
    const clearTimers = () => {
      if (firstTokenTimer) clearTimeout(firstTokenTimer);
      if (inactivityTimer) clearTimeout(inactivityTimer);
    };
    const armInactivity = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => controller.abort(), inactivityTimeoutMs);
    };

    try {
      firstTokenTimer = setTimeout(() => controller.abort(), firstTokenTimeoutMs);

      let res: Response;
      try {
        res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if (signal.aborted || controller.signal.aborted) return;
        if (err instanceof LLMError) throw err;
        throw new LLMError('network', `网络请求失败: ${err instanceof Error ? err.message : String(err)}`, true);
      }

      if (!res.ok) {
        const body = await safeJson(res);
        if (signal.aborted || controller.signal.aborted) return;
        throw mapStatusError(res.status, body);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new LLMError('network', '响应无数据流', true);
      }

      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (signal.aborted || controller.signal.aborted) return;
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, '').trim();
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          if (data === '[DONE]') return;

          let chunk: StreamChunk;
          try {
            chunk = JSON.parse(data) as StreamChunk;
          } catch {
            continue;
          }
          if (chunk.error) throw mapStatusError(res.status, chunk.error as unknown as StreamChunk);

          const choice = chunk.choices?.[0];
          const text = choice?.delta?.content;
          if (text) {
            if (firstTokenTimer) {
              clearTimeout(firstTokenTimer);
              firstTokenTimer = undefined;
            }
            armInactivity();
            yield { text };
          }
          if (choice?.finish_reason) {
            yield {
              finishReason: choice.finish_reason,
              usage: chunk.usage
                ? {
                    inputTokens: chunk.usage.prompt_tokens ?? 0,
                    outputTokens: chunk.usage.completion_tokens ?? 0,
                  }
                : undefined,
            };
          }
        }
      }
    } finally {
      clearTimers();
      signal.removeEventListener('abort', onAbort);
    }
  }
}

async function safeJson(res: Response): Promise<StreamChunk | undefined> {
  try {
    return (await res.json()) as StreamChunk;
  } catch {
    return undefined;
  }
}

function mapStatusError(
  status: number,
  body: StreamChunk | undefined,
): LLMError {
  const msg = body?.error?.message ?? `HTTP ${status}`;
  switch (status) {
    case 401:
    case 403:
      return new LLMError('auth', msg, false);
    case 429:
      return new LLMError('rate_limit', msg, true);
    case 400:
      if (/context|token/i.test(msg)) return new LLMError('context_length', msg, false);
      return new LLMError('unknown', msg, false);
    case 408:
    case 502:
    case 503:
    case 504:
      return new LLMError('network', msg, true);
    default:
      return new LLMError('unknown', msg, false);
  }
}
