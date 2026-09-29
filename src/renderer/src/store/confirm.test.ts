import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from './index';
import type { AgentBridge } from '@/main/preload';
import type { AgentStreamEvent } from '@/common/ipc';

const confirmTool = vi.fn();
const abort = vi.fn();

const chatDelete = vi.fn().mockResolvedValue(undefined);

function bridge(): AgentBridge {
  return {
    send: vi.fn().mockResolvedValue({ runId: 'run-1', assistantId: 'a1' }),
    abort,
    onStream: vi.fn(),
    confirmTool,
    configGet: vi.fn(),
    configSet: vi.fn(),
    chatList: vi.fn().mockResolvedValue([]),
    chatLoad: vi.fn().mockResolvedValue(null),
    chatCreate: vi.fn(),
    chatRename: vi.fn(),
    chatDelete,
    runsList: vi.fn().mockResolvedValue([]),
  } as unknown as AgentBridge;
}

/** 构造「某会话正在流式输出」的初始态，handleStreamEvent 才会处理事件 */
function seed(chatId: string, runId: string | null = 'run-1'): void {
  useStore.setState({
    chats: [{ id: chatId, title: '会话', lastMessage: '', createdAt: 0, updatedAt: 0 }],
    activeChatId: chatId,
    messagesByChat: {
      [chatId]: [{ id: 'a1', role: 'assistant', content: '', createdAt: 0 }],
    },
    streamingByChat: { [chatId]: { runId, assistantId: 'a1' } },
    confirmQueue: [],
  });
}

function confirmEvent(overrides: Partial<AgentStreamEvent> = {}): AgentStreamEvent {
  return {
    runId: 'run-1',
    chatId: 'chat-1',
    kind: 'tool_confirm',
    confirmId: 'cf-1',
    toolName: 'write_file',
    toolArgs: '{"path":"C:\\\\Users\\\\me\\\\a.txt","content":"x"}',
    confirmHint: '将覆盖或新建你电脑上的一个文件，同名文件内容会丢失',
    ...overrides,
  };
}

beforeEach(() => {
  confirmTool.mockReset();
  abort.mockReset();
  chatDelete.mockClear();
  window.agentBridge = bridge();
});

describe('工具确认队列', () => {
  it('收到 tool_confirm 时入队等待用户决定', () => {
    seed('chat-1');
    useStore.getState().handleStreamEvent(confirmEvent());

    const queue = useStore.getState().confirmQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].toolName).toBe('write_file');
    expect(queue[0].confirmHint).toContain('同名文件内容会丢失');
    expect(confirmTool).not.toHaveBeenCalled();
  });

  it('多个确认按到达顺序排队', () => {
    seed('chat-1');
    useStore.getState().handleStreamEvent(confirmEvent({ confirmId: 'cf-1' }));
    useStore.getState().handleStreamEvent(confirmEvent({ confirmId: 'cf-2' }));

    expect(useStore.getState().confirmQueue.map((e) => e.confirmId)).toEqual(['cf-1', 'cf-2']);
  });

  it('放行时把决定回传主进程并出队', () => {
    seed('chat-1');
    useStore.getState().handleStreamEvent(confirmEvent());
    useStore.getState().resolveConfirm('cf-1', 'allow', false);

    expect(confirmTool).toHaveBeenCalledWith({
      confirmId: 'cf-1',
      decision: 'allow',
      remember: false,
    });
    expect(useStore.getState().confirmQueue).toHaveLength(0);
  });

  it('「不再询问」只在放行时生效，拒绝时不带 remember', () => {
    seed('chat-1');
    useStore.getState().handleStreamEvent(confirmEvent());
    useStore.getState().resolveConfirm('cf-1', 'deny', true);

    expect(confirmTool).toHaveBeenCalledWith({
      confirmId: 'cf-1',
      decision: 'deny',
      remember: false,
    });
  });

  it('缺少 confirmId 的确认请求不进队列（无法答复，避免卡死）', () => {
    seed('chat-1');
    useStore.getState().handleStreamEvent(confirmEvent({ confirmId: undefined }));

    expect(useStore.getState().confirmQueue).toHaveLength(0);
  });

  it('不属于当前 run 的确认请求被忽略', () => {
    seed('chat-1', 'run-1');
    useStore.getState().handleStreamEvent(confirmEvent({ runId: 'run-2' }));

    expect(useStore.getState().confirmQueue).toHaveLength(0);
  });

  it('删除会话时丢弃它挂着没答复的确认请求', async () => {
    seed('chat-1');
    useStore.getState().handleStreamEvent(confirmEvent({ chatId: 'chat-1' }));
    expect(useStore.getState().confirmQueue).toHaveLength(1);

    await useStore.getState().deleteChat('chat-1');

    expect(useStore.getState().confirmQueue).toHaveLength(0);
    // 会话正在流式输出，删除时顺带中止 run
    expect(abort).toHaveBeenCalledWith('run-1');
  });
});
