import { ChatProvider, ChatRequest, LLMDelta } from './provider';

export class MockProvider implements ChatProvider {
  requiresConfig = false;

  async *chat(req: ChatRequest): AsyncGenerator<LLMDelta> {
    const last = [...req.messages].reverse().find((m) => m.role === 'user');
    const content = last?.content ?? '';
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
