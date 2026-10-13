import { describe, it, expect, beforeEach } from 'vitest';
import { RendererRequester } from './renderer-request';
import { IPC, type RendererRequestMessage } from '@/common/ipc';

function createTarget(options: { destroyed?: boolean; throwOnSend?: boolean } = {}) {
  const sent: RendererRequestMessage[] = [];
  let destroyed = options.destroyed === true;
  return {
    sent,
    /** 模拟窗口在挂起期间被销毁 */
    destroy: () => {
      destroyed = true;
    },
    isDestroyed: () => destroyed,
    send: (channel: string, message: RendererRequestMessage) => {
      if (options.throwOnSend) throw new Error('通道已关闭');
      if (channel === IPC.request) sent.push(message);
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let requester: RendererRequester;

beforeEach(() => {
  requester = new RendererRequester();
});

describe('主 → 渲染的反向请求', () => {
  it('发出带 id 的请求消息', async () => {
    const target = createTarget();
    const pending = requester.request<string>(target, {
      channel: 'demo',
      command: 'ping',
      args: { n: 1 },
    });

    expect(target.sent).toHaveLength(1);
    expect(target.sent[0]).toMatchObject({
      channel: 'demo',
      command: 'ping',
      args: { n: 1 },
    });
    expect(typeof target.sent[0].id).toBe('string');

    requester.reply({ id: target.sent[0].id, ok: true, value: 'pong' });
    await expect(pending).resolves.toBe('pong');
  });

  it('渲染端报错时以 IPCChannelError 拒绝，code 不丢', async () => {
    const target = createTarget();
    const pending = requester.request(target, { channel: 'demo', command: 'ping' });

    requester.reply({
      id: target.sent[0].id,
      ok: false,
      error: { code: 'no_handler', message: '未注册服务' },
    });

    await expect(pending).rejects.toMatchObject({ code: 'no_handler', message: '未注册服务' });
  });

  it('超时拒绝，且清掉待决表', async () => {
    const target = createTarget();
    const pending = requester.request(target, {
      channel: 'demo',
      command: 'ping',
      timeoutMs: 10,
    });

    await expect(pending).rejects.toThrow(/超时/);
    expect(requester.pendingCount).toBe(0);
  });

  it('窗口已销毁时拒绝，不发消息', async () => {
    const target = createTarget({ destroyed: true });

    await expect(requester.request(target, { channel: 'demo', command: 'ping' })).rejects.toThrow(
      /窗口已销毁/,
    );
    expect(target.sent).toHaveLength(0);
    expect(requester.pendingCount).toBe(0);
  });

  it('发送本身抛错时拒绝，不留下悬垂请求', async () => {
    const target = createTarget({ throwOnSend: true });

    await expect(requester.request(target, { channel: 'demo', command: 'ping' })).rejects.toThrow(
      /通道已关闭/,
    );
    expect(requester.pendingCount).toBe(0);
  });

  it('cancelGroup 只取消同一分组的请求', async () => {
    const target = createTarget();
    const a = requester.request(target, { channel: 'demo', command: 'ping', group: 'run-a' });
    const b = requester.request(target, { channel: 'demo', command: 'ping', group: 'run-b' });

    expect(requester.cancelGroup('run-a')).toBe(1);
    await expect(a).rejects.toThrow(/取消/);

    // run-b 不受影响
    requester.reply({ id: target.sent[1].id, ok: true, value: 'ok' });
    await expect(b).resolves.toBe('ok');
  });

  it('dispose 拒绝所有未决请求', async () => {
    const target = createTarget();
    const a = requester.request(target, { channel: 'demo', command: 'ping' });
    const b = requester.request(target, { channel: 'demo', command: 'ping' });

    requester.dispose();

    await expect(a).rejects.toThrow(/已释放/);
    await expect(b).rejects.toThrow(/已释放/);
    expect(requester.pendingCount).toBe(0);
  });

  it('重复或未知 id 的答复被忽略', () => {
    const target = createTarget();
    void requester.request(target, { channel: 'demo', command: 'ping' });
    const id = target.sent[0].id;

    expect(requester.reply({ id, ok: true, value: 1 })).toBe(true);
    expect(requester.reply({ id, ok: true, value: 2 })).toBe(false);
    expect(requester.reply({ id: 'never-seen', ok: true })).toBe(false);
  });

  it('形状不对的答复不会把请求打挂', () => {
    expect(requester.reply(undefined as never)).toBe(false);
    expect(requester.reply({} as never)).toBe(false);
  });

  it('多个请求互不串号', async () => {
    const target = createTarget();
    const first = requester.request<string>(target, { channel: 'demo', command: 'a' });
    const second = requester.request<string>(target, { channel: 'demo', command: 'b' });

    // 乱序答复
    requester.reply({ id: target.sent[1].id, ok: true, value: 'B' });
    requester.reply({ id: target.sent[0].id, ok: true, value: 'A' });

    await expect(first).resolves.toBe('A');
    await expect(second).resolves.toBe('B');
  });
});

describe('页面重载：挂起与续传', () => {
  it('挂起期间停表，不会因为页面正在加载而超时', async () => {
    const target = createTarget();
    const pending = requester.request(target, { channel: 'demo', command: 'ping', timeoutMs: 10 });

    requester.suspendTarget(target);
    await sleep(40); // 远超 10ms 的超时线

    expect(requester.pendingCount).toBe(1);
    expect(requester.suspendedCount).toBe(1);

    // 页面回来后照常答复
    requester.resumeTarget(target);
    requester.reply({ id: target.sent[0].id, ok: true, value: 'ok' });
    await expect(pending).resolves.toBe('ok');
  });

  it('续传会重发请求，id 保持不变（否则答复对不上原 Promise）', () => {
    const target = createTarget();
    void requester.request(target, { channel: 'demo', command: 'ping' });
    const originalId = target.sent[0].id;

    requester.suspendTarget(target);
    expect(requester.suspendedCount).toBe(1);
    requester.resumeTarget(target);

    expect(target.sent).toHaveLength(2);
    expect(target.sent[1].id).toBe(originalId);
    expect(requester.suspendedCount).toBe(0);
  });

  it('续传后重新开始计时，不是接着旧表走', async () => {
    const target = createTarget();
    const pending = requester.request(target, { channel: 'demo', command: 'ping', timeoutMs: 30 });

    requester.suspendTarget(target);
    await sleep(60); // 旧表早就该超时了
    requester.resumeTarget(target);

    await sleep(10);
    expect(requester.pendingCount).toBe(1);

    await expect(pending).rejects.toThrow(/超时/);
  });

  it('挂起与续传只影响指定窗口', async () => {
    const mine = createTarget();
    const other = createTarget();
    void requester.request(mine, { channel: 'demo', command: 'ping' });
    void requester.request(other, { channel: 'demo', command: 'ping' });

    expect(requester.suspendTarget(mine)).toBe(1);
    expect(requester.resumeTarget(mine)).toBe(1);
    // 另一个窗口的请求没被碰过，也没被重发
    expect(other.sent).toHaveLength(1);
  });

  it('重复挂起是幂等的', () => {
    const target = createTarget();
    void requester.request(target, { channel: 'demo', command: 'ping' });

    expect(requester.suspendTarget(target)).toBe(1);
    expect(requester.suspendTarget(target)).toBe(0);
    expect(requester.resumeTarget(target)).toBe(1);
  });

  it('没有挂起过的请求不会被续传误重发', () => {
    const target = createTarget();
    void requester.request(target, { channel: 'demo', command: 'ping' });

    expect(requester.resumeTarget(target)).toBe(0);
    expect(target.sent).toHaveLength(1);
  });

  it('续传时窗口已销毁，请求按失败结算', async () => {
    const target = createTarget();
    const pending = requester.request(target, { channel: 'demo', command: 'ping' });

    requester.suspendTarget(target);
    target.destroy();

    expect(requester.resumeTarget(target)).toBe(0);
    await expect(pending).rejects.toThrow(/销毁/);
    expect(requester.pendingCount).toBe(0);
  });

  it('窗口销毁时立即结算，不白等到超时', async () => {
    const target = createTarget();
    const pending = requester.request(target, {
      channel: 'demo',
      command: 'ping',
      timeoutMs: 60_000,
    });

    expect(requester.cancelTarget(target)).toBe(1);

    await expect(pending).rejects.toThrow(/窗口已销毁/);
    expect(requester.pendingCount).toBe(0);
  });

  it('作废只影响指定窗口', async () => {
    const mine = createTarget();
    const other = createTarget();
    const minePending = requester.request(mine, { channel: 'demo', command: 'ping' });
    const otherPending = requester.request(other, { channel: 'demo', command: 'ping' });

    expect(requester.cancelTarget(mine)).toBe(1);
    await expect(minePending).rejects.toThrow(/销毁/);

    requester.reply({ id: other.sent[0].id, ok: true, value: 'ok' });
    await expect(otherPending).resolves.toBe('ok');
  });
});
