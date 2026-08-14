import { ChatProvider, ChatRequest, LLMDelta } from './provider';

export class MockProvider implements ChatProvider {
  requiresConfig = false;

  async *chat(req: ChatRequest): AsyncGenerator<LLMDelta> {
    const last = [...req.messages].reverse().find((m) => m.role === 'user');
    const content = last?.content ?? '';

    const asksTime = /时间|日期|now|几点/i.test(content);
    const toolAlreadyRun = req.messages.some((m) => m.role === 'tool');

    if (asksTime && !toolAlreadyRun) {
      yield {
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'mock-now', name: 'now', arguments: '{}' }],
      };
      return;
    }

    if (asksTime && toolAlreadyRun) {
      const nowResult = [...req.messages].reverse().find((m) => m.role === 'tool');
      const reply = `（mock）当前时间是：${nowResult?.content ?? '未知'}。`;
      for (let i = 0; i < reply.length; i++) {
        if (req.signal.aborted) return;
        yield { text: reply[i] };
        await new Promise((r) => setTimeout(r, 20));
      }
      if (req.signal.aborted) return;
      yield { finishReason: 'stop' };
      return;
    }

    const reply = `（mock）你说了：「${content}」。这是逐字到达的流式回复，用于验证阶段 1 的流式管道。`;

    for (let i = 0; i < reply.length; i++) {
      if (req.signal.aborted) return;
      yield { text: reply[i] };
      await new Promise((r) => setTimeout(r, 20));
    }
    if (req.signal.aborted) return;
    yield { finishReason: 'stop' };
  }
}
