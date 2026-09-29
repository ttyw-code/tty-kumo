import { describe, it, expect } from 'vitest';
import { MISSING_TOOL_RESULT, toLLMMessages } from './history';
import type { StoredMessage } from '@/common/session';

function user(id: string, content: string): StoredMessage {
  return { id, role: 'user', content, createdAt: 0 };
}

function assistant(id: string, content: string, extra: Partial<StoredMessage> = {}): StoredMessage {
  return { id, role: 'assistant', content, createdAt: 0, ...extra };
}

describe('历史重建', () => {
  it('用户与助手消息原样传递', () => {
    const out = toLLMMessages([user('u1', '你好'), assistant('a1', '你好呀')]);

    expect(out).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好呀', toolCalls: undefined },
    ]);
  });

  it('工具结果展开成独立的 tool 消息（协议要求）', () => {
    const out = toLLMMessages([
      user('u1', '现在几点'),
      assistant('a1', '', {
        toolCalls: [{ id: 'tc1', name: 'now', args: '{}', result: '2026-09-29' }],
      }),
      assistant('a2', '现在是 2026-09-29'),
    ]);

    expect(out).toEqual([
      { role: 'user', content: '现在几点' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', name: 'now', arguments: '{}' }],
      },
      { role: 'tool', toolCallId: 'tc1', content: '2026-09-29' },
      { role: 'assistant', content: '现在是 2026-09-29', toolCalls: undefined },
    ]);
  });

  it('工具结果缺失时补占位，避免端点因不配对报 400', () => {
    const out = toLLMMessages([
      assistant('a1', '', { toolCalls: [{ id: 'tc1', name: 'write_file', args: '{}' }] }),
    ]);

    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ role: 'tool', toolCallId: 'tc1', content: MISSING_TOOL_RESULT });
  });

  it('多个工具调用的顺序与调用顺序一致', () => {
    const out = toLLMMessages([
      assistant('a1', '', {
        toolCalls: [
          { id: 'tc1', name: 'now', args: '{}', result: 'r1' },
          { id: 'tc2', name: 'read_file', args: '{"path":"/a"}', result: 'r2' },
        ],
      }),
    ]);

    expect(out.map((m) => m.role)).toEqual(['assistant', 'tool', 'tool']);
    expect(out[1].content).toBe('r1');
    expect(out[2].content).toBe('r2');
  });

  it('中断留下的空占位消息不进入上下文', () => {
    const out = toLLMMessages([
      user('u1', '在吗'),
      assistant('a1', '', { status: 'interrupted' }),
      user('u2', '在吗？'),
    ]);

    expect(out).toEqual([
      { role: 'user', content: '在吗' },
      { role: 'user', content: '在吗？' },
    ]);
  });

  it('空白用户消息被跳过（避免端点报「content 不能为空」）', () => {
    const out = toLLMMessages([user('u1', '   '), user('u2', '有内容')]);

    expect(out).toEqual([{ role: 'user', content: '有内容' }]);
  });

  it('空历史返回空数组', () => {
    expect(toLLMMessages([])).toEqual([]);
  });
});
