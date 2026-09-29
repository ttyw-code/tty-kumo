import type { LLMMessage } from './llm/provider';
import type { StoredMessage } from '@/common/session';

/**
 * 持久化消息 → LLM 消息序列的重建。
 *
 * 存储里工具结果挂在 assistant 消息的 toolCalls[].result 上（便于 UI 渲染），
 * 但协议要求 tool 结果是**独立的 `role: 'tool'` 消息**，因此这里展开。
 */

/** 中断/失败导致结果缺失时补的占位：每个 tool_call 都必须有对应的 tool 消息 */
export const MISSING_TOOL_RESULT = '（该工具未执行完成）';

export function toLLMMessages(messages: StoredMessage[]): LLMMessage[] {
  const out: LLMMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (!msg.content.trim()) continue;
      out.push({ role: 'user', content: msg.content });
      continue;
    }

    const calls = msg.toolCalls ?? [];
    const toolCalls = calls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.args,
    }));

    // 中断留下的空占位消息没有任何信息量，喂给模型只会污染上下文
    if (!msg.content.trim() && toolCalls.length === 0) continue;

    out.push({
      role: 'assistant',
      content: msg.content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    for (const tc of calls) {
      out.push({
        role: 'tool',
        toolCallId: tc.id,
        content: tc.result ?? MISSING_TOOL_RESULT,
      });
    }
  }

  return out;
}
