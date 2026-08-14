import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIProvider } from './openai';
import { LLMError } from './provider';

function makeResponse(body: ReadableStream<Uint8Array>, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    body,
  } as unknown as Response;
}

function sse(...events: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(enc.encode(e));
      controller.close();
    },
  });
}

function chunks(lines: Array<Record<string, unknown>>) {
  return lines
    .map((l) => `data: ${JSON.stringify(l)}\n\n`)
    .join('');
}

const req = {
  messages: [{ role: 'user' as const, content: 'hi' }],
  model: 'm',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'k',
  signal: new AbortController().signal,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAIProvider SSE 解析', () => {
  it('逐块产出 text delta 与 finishReason', async () => {
    const data = chunks([
      { choices: [{ delta: { content: '你' } }] },
      { choices: [{ delta: { content: '好' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(sse(data))));

    const provider = new OpenAIProvider();
    const deltas: string[] = [];
    let finish: string | undefined;
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    for await (const d of provider.chat(req)) {
      if (d.text) deltas.push(d.text);
      if (d.finishReason) finish = d.finishReason;
      if (d.usage) usage = d.usage;
    }

    expect(deltas).toEqual(['你', '好']);
    expect(finish).toBe('stop');
    expect(usage).toEqual({ inputTokens: 3, outputTokens: 2 });
  });

  it('[DONE] 正常结束', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeResponse(sse(
        chunks([{ choices: [{ delta: { content: 'a' } }] }]),
        'data: [DONE]\n\n',
      )),
    ));

    const provider = new OpenAIProvider();
    const texts: string[] = [];
    for await (const d of provider.chat(req)) if (d.text) texts.push(d.text);
    expect(texts).toEqual(['a']);
  });

  it('多行 chunk 跨 read 边界正确拼接', async () => {
    const enc = new TextEncoder();
    const full = chunks([
      { choices: [{ delta: { content: 'abc' } }] },
      { choices: [{ delta: { content: 'def' } }] },
    ]);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = enc.encode(full);
        controller.enqueue(bytes.slice(0, 11));
        controller.enqueue(bytes.slice(11, 23));
        controller.enqueue(bytes.slice(23));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(body)));

    const provider = new OpenAIProvider();
    const texts: string[] = [];
    for await (const d of provider.chat(req)) if (d.text) texts.push(d.text);
    expect(texts.join('')).toBe('abcdef');
  });

  it('401 → auth 错误不可重试', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeResponse(sse('data: {"error":{"message":"bad key"}}\n\n'), 401),
    ));
    const provider = new OpenAIProvider();
    try {
      for await (const _ of provider.chat(req)) { /* noop */ }
      expect.unreachable('应当抛出 LLMError');
    } catch (e) {
      const err = e as LLMError;
      expect(err.code).toBe('auth');
      expect(err.retryable).toBe(false);
    }
  });

  it('429 → rate_limit 可重试', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeResponse(sse('data: {"error":{"message":"slow down"}}\n\n'), 429),
    ));
    const provider = new OpenAIProvider();
    try {
      for await (const _ of provider.chat(req)) { /* noop */ }
    } catch (e) {
      const err = e as LLMError;
      expect(err.code).toBe('rate_limit');
      expect(err.retryable).toBe(true);
    }
  });

  it('中止后不再产出', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(chunks([{ choices: [{ delta: { content: 'x' } }] }])));
        controller.close();
      },
    });
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Promise<Response>((resolve) => {
        controller.abort();
        setTimeout(() => resolve(makeResponse(body)), 5);
      }),
    ));

    const provider = new OpenAIProvider();
    const texts: string[] = [];
    for await (const d of provider.chat({ ...req, signal: controller.signal })) {
      if (d.text) texts.push(d.text);
    }
    expect(texts.length).toBe(0);
  });

it('流式 tool_calls 跨块累积并随 finishReason 产出完整参数', async () => {
    const data = chunks([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'now', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"f' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ormat:iso' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] }, finish_reason: 'tool_calls' }] },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(sse(data))));

    const provider = new OpenAIProvider();
    let toolCalls: Array<{ id: string; name: string; arguments: string }> | undefined;
    let finish: string | undefined;
    for await (const d of provider.chat(req)) {
      if (d.toolCalls) toolCalls = d.toolCalls;
      if (d.finishReason) finish = d.finishReason;
    }

    expect(finish).toBe('tool_calls');
    expect(toolCalls).toEqual([
      { id: 'call_1', name: 'now', arguments: '{"format:iso}' },
    ]);
  });
});
