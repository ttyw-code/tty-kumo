import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from './index';
import type { AgentBridge } from '@/main/preload';
import { IPC, type IClientChannel, type ToolConfirmAsk } from '@/common/ipc';

/** 请求-响应型调用走 ipcChannel */
const call = vi.fn().mockResolvedValue(undefined);

function bridge(): AgentBridge {
  return { onStream: vi.fn() } as unknown as AgentBridge;
}

function channel(): IClientChannel {
  return { call, listen: vi.fn(), register: vi.fn() } as unknown as IClientChannel;
}

function ask(overrides: Partial<ToolConfirmAsk> = {}): ToolConfirmAsk {
  return {
    runId: 'run-1',
    chatId: 'chat-1',
    toolCallId: 'tc-1',
    toolName: 'write_file',
    toolArgs: '{"path":"C:\\\\Users\\\\me\\\\a.txt","content":"x"}',
    hint: '将覆盖或新建你电脑上的一个文件，同名文件内容会丢失',
    ...overrides,
  };
}

function seed(chatId: string): void {
  useStore.setState({
    chats: [{ id: chatId, title: '会话', lastMessage: '', createdAt: 0, updatedAt: 0 }],
    activeChatId: chatId,
    messagesByChat: { [chatId]: [] },
    streamingByChat: {},
    confirmQueue: [],
  });
}

beforeEach(() => {
  call.mockClear();
  call.mockResolvedValue(undefined);
  window.agentBridge = bridge();
  window.ipcChannel = channel();
  useStore.setState({ confirmQueue: [] });
});

describe('工具确认（反向请求的响应侧）', () => {
  it('主进程的确认请求会进队列等待用户决定', () => {
    seed('chat-1');
    void useStore.getState().askToolConfirm(ask());

    const queue = useStore.getState().confirmQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].toolName).toBe('write_file');
    expect(queue[0].chatId).toBe('chat-1');
    expect(queue[0].confirmHint).toContain('同名文件内容会丢失');
  });

  it('用户放行后 Promise 兑现，队列清空', async () => {
    seed('chat-1');
    const pending = useStore.getState().askToolConfirm(ask());
    const id = useStore.getState().confirmQueue[0].id;

    useStore.getState().resolveConfirm(id, 'allow', false);

    await expect(pending).resolves.toEqual({ decision: 'allow', remember: false });
    expect(useStore.getState().confirmQueue).toHaveLength(0);
  });

  it('用户拒绝时答复 deny', async () => {
    seed('chat-1');
    const pending = useStore.getState().askToolConfirm(ask());
    const id = useStore.getState().confirmQueue[0].id;

    useStore.getState().resolveConfirm(id, 'deny', false);

    await expect(pending).resolves.toEqual({ decision: 'deny', remember: false });
  });

  it('「不再询问」只在放行时上报，拒绝时不带 remember', async () => {
    seed('chat-1');
    const allowPending = useStore.getState().askToolConfirm(ask());
    useStore.getState().resolveConfirm(useStore.getState().confirmQueue[0].id, 'allow', true);
    await expect(allowPending).resolves.toEqual({ decision: 'allow', remember: true });

    const denyPending = useStore.getState().askToolConfirm(ask());
    useStore.getState().resolveConfirm(useStore.getState().confirmQueue[0].id, 'deny', true);
    await expect(denyPending).resolves.toEqual({ decision: 'deny', remember: false });
  });

  it('多个确认按到达顺序排队，各自独立兑现', async () => {
    seed('chat-1');
    const first = useStore.getState().askToolConfirm(ask({ toolName: 'write_file' }));
    const second = useStore.getState().askToolConfirm(ask({ toolName: 'run_command' }));

    const queue = useStore.getState().confirmQueue;
    expect(queue.map((e) => e.toolName)).toEqual(['write_file', 'run_command']);

    // 后到的先答复，互不影响
    useStore.getState().resolveConfirm(queue[1].id, 'allow', false);
    useStore.getState().resolveConfirm(queue[0].id, 'deny', false);

    await expect(first).resolves.toEqual({ decision: 'deny', remember: false });
    await expect(second).resolves.toEqual({ decision: 'allow', remember: false });
    expect(useStore.getState().confirmQueue).toHaveLength(0);
  });

  it('删除会话时把它挂着的确认请求按拒绝答复，不让主进程白等到超时', async () => {
    seed('chat-1');
    const pending = useStore.getState().askToolConfirm(ask({ chatId: 'chat-1' }));
    expect(useStore.getState().confirmQueue).toHaveLength(1);

    await useStore.getState().deleteChat('chat-1');

    await expect(pending).resolves.toEqual({ decision: 'deny', remember: false });
    expect(useStore.getState().confirmQueue).toHaveLength(0);
    expect(call).toHaveBeenCalledWith(IPC.chatDelete, 'chat-1');
  });

  it('删除会话不影响别的会话挂着的确认请求', async () => {
    seed('chat-1');
    const mine = useStore.getState().askToolConfirm(ask({ chatId: 'chat-1' }));
    const other = useStore.getState().askToolConfirm(ask({ chatId: 'chat-2' }));

    await useStore.getState().deleteChat('chat-1');

    await expect(mine).resolves.toEqual({ decision: 'deny', remember: false });
    expect(useStore.getState().confirmQueue).toHaveLength(1);
    expect(useStore.getState().confirmQueue[0].chatId).toBe('chat-2');

    // 另一个仍可正常答复
    useStore.getState().resolveConfirm(useStore.getState().confirmQueue[0].id, 'allow', false);
    await expect(other).resolves.toEqual({ decision: 'allow', remember: false });
  });

  it('重复答复同一个 id 不会重复出队或二次兑现', async () => {
    seed('chat-1');
    const pending = useStore.getState().askToolConfirm(ask());
    const id = useStore.getState().confirmQueue[0].id;

    useStore.getState().resolveConfirm(id, 'allow', false);
    useStore.getState().resolveConfirm(id, 'deny', false);

    await expect(pending).resolves.toEqual({ decision: 'allow', remember: false });
  });
});
