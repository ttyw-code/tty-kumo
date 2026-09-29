import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AgentStreamEvent, ToolConfirmReply } from '@/common/ipc';
import { DEFAULT_CONFIRM_TIMEOUT_MS, ToolConfirmGateway } from './confirm';

interface FakeWindow {
  wc: {
    isDestroyed: () => boolean;
    send: (channel: string, event: AgentStreamEvent) => void;
  };
  events: AgentStreamEvent[];
  destroy: () => void;
}

function fakeWindow(): FakeWindow {
  const events: AgentStreamEvent[] = [];
  let destroyed = false;
  const wc = {
    isDestroyed: () => destroyed,
    send: (_channel: string, event: AgentStreamEvent) => {
      events.push(event);
    },
  };
  return { wc, events, destroy: () => { destroyed = true; } };
}

function baseRequest(window: FakeWindow, toolName = 'write_file') {
  return {
    runId: 'run-1',
    chatId: 'chat-1',
    wc: window.wc,
    toolCallId: 'call-1',
    toolName,
    toolArgs: '{"path":"/tmp/a"}',
    hint: '会覆盖一个文件',
  };
}

function reply(confirmId: string, decision: 'allow' | 'deny', remember = false): ToolConfirmReply {
  return { confirmId, decision, remember };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ToolConfirmGateway', () => {
  it('向渲染端推送 tool_confirm 事件并带上 confirmId 与后果说明', async () => {
    const gw = new ToolConfirmGateway();
    const win = fakeWindow();

    const pending = gw.request(baseRequest(win));
    expect(win.events).toHaveLength(1);
    const evt = win.events[0];
    expect(evt.kind).toBe('tool_confirm');
    expect(evt.runId).toBe('run-1');
    expect(evt.chatId).toBe('chat-1');
    expect(evt.toolCallId).toBe('call-1');
    expect(evt.confirmHint).toBe('会覆盖一个文件');
    expect(typeof evt.confirmId).toBe('string');

    gw.reply(reply(evt.confirmId!, 'allow'));
    await expect(pending).resolves.toBe(true);
  });

  it('用户拒绝时返回 false', async () => {
    const gw = new ToolConfirmGateway();
    const win = fakeWindow();
    const pending = gw.request(baseRequest(win));
    gw.reply(reply(win.events[0].confirmId!, 'deny'));
    await expect(pending).resolves.toBe(false);
  });

  it('超时按拒绝处理，且不残留挂起请求', async () => {
    vi.useFakeTimers();
    const gw = new ToolConfirmGateway();
    const win = fakeWindow();

    const pending = gw.request({ ...baseRequest(win), timeoutMs: DEFAULT_CONFIRM_TIMEOUT_MS });
    await vi.advanceTimersByTimeAsync(DEFAULT_CONFIRM_TIMEOUT_MS);

    await expect(pending).resolves.toBe(false);
    expect(gw.pendingCount).toBe(0);
  });

  it('勾选记住后同一工具不再重复询问，且 deny 不记忆', async () => {
    const gw = new ToolConfirmGateway();
    const win = fakeWindow();

    const first = gw.request(baseRequest(win, 'run_command'));
    gw.reply(reply(win.events[0].confirmId!, 'allow', true));
    await expect(first).resolves.toBe(true);
    expect(gw.isRemembered('run_command')).toBe(true);

    await expect(gw.request(baseRequest(win, 'run_command'))).resolves.toBe(true);
    // 没有再推送新的确认事件
    expect(win.events).toHaveLength(1);

    const other = gw.request(baseRequest(win, 'write_file'));
    expect(win.events).toHaveLength(2);
    gw.reply(reply(win.events[1].confirmId!, 'deny', true));
    await expect(other).resolves.toBe(false);
    expect(gw.isRemembered('write_file')).toBe(false);
  });

  it('remember 仅存活于当前实例，forgetAll 可清空', async () => {
    const gw = new ToolConfirmGateway();
    const win = fakeWindow();
    const pending = gw.request(baseRequest(win));
    gw.reply(reply(win.events[0].confirmId!, 'allow', true));
    await pending;

    gw.forgetAll();
    expect(gw.isRemembered('write_file')).toBe(false);
  });

  it('run 被中止时挂起的确认按拒绝结算', async () => {
    const gw = new ToolConfirmGateway();
    const win = fakeWindow();
    const pending = gw.request(baseRequest(win));
    gw.cancelRun('run-1');
    await expect(pending).resolves.toBe(false);
    expect(gw.pendingCount).toBe(0);
  });

  it('cancelRun 只影响指定 run', async () => {
    const gw = new ToolConfirmGateway();
    const win = fakeWindow();
    const first = gw.request(baseRequest(win));
    const second = gw.request({ ...baseRequest(win), runId: 'run-2' });

    gw.cancelRun('run-1');
    await expect(first).resolves.toBe(false);
    expect(gw.pendingCount).toBe(1);

    gw.reply(reply(win.events[1].confirmId!, 'allow'));
    await expect(second).resolves.toBe(true);
  });

  it('窗口已销毁时不等待用户答复', async () => {
    const gw = new ToolConfirmGateway();
    const win = fakeWindow();
    win.destroy();
    await expect(gw.request(baseRequest(win))).resolves.toBe(false);
    expect(win.events).toHaveLength(0);
  });

  it('重复或无效的答复返回 false', () => {
    const gw = new ToolConfirmGateway();
    const win = fakeWindow();
    const pending = gw.request(baseRequest(win));
    const confirmId = win.events[0].confirmId!;

    expect(gw.reply(reply(confirmId, 'allow'))).toBe(true);
    expect(gw.reply(reply(confirmId, 'allow'))).toBe(false);
    expect(gw.reply({ confirmId: 'nope', decision: 'allow', remember: false })).toBe(false);
    expect(gw.reply({ decision: 'allow', remember: false } as unknown as ToolConfirmReply)).toBe(false);
    void pending;
  });

  it('dispose 清空所有挂起请求', async () => {
    const gw = new ToolConfirmGateway();
    const win = fakeWindow();
    const pending = gw.request(baseRequest(win));
    gw.dispose();
    await expect(pending).resolves.toBe(false);
    expect(gw.pendingCount).toBe(0);
  });
});
