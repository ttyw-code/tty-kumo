import { describe, it, expect, beforeEach } from 'vitest';
import { ToolConfirmGateway, type ConfirmRequest } from './confirm';
import { RendererRequester } from './renderer-request';
import {
  IPC,
  TOOL_CONFIRM_ASK,
  TOOL_CONFIRM_CHANNEL,
  type RendererRequestMessage,
  type ToolConfirmAnswer,
} from '@/common/ipc';

/** 假窗口：记下发出去的反向请求，测试再据此模拟渲染端的答复 */
function createTarget(options: { destroyed?: boolean } = {}) {
  const sent: RendererRequestMessage[] = [];
  return {
    sent,
    isDestroyed: () => options.destroyed === true,
    send: (channel: string, message: RendererRequestMessage) => {
      if (channel === IPC.request) sent.push(message);
    },
  };
}

let requester: RendererRequester;
let gateway: ToolConfirmGateway;

beforeEach(() => {
  requester = new RendererRequester();
  gateway = new ToolConfirmGateway(requester);
});

function askRequest(overrides: Partial<ConfirmRequest> = {}): ConfirmRequest {
  return {
    runId: 'run-1',
    chatId: 'chat-1',
    toolCallId: 'tc-1',
    toolName: 'write_file',
    toolArgs: '{"path":"/tmp/a.txt"}',
    hint: '将覆盖或新建你电脑上的一个文件，同名文件内容会丢失',
    ...overrides,
    wc: overrides.wc ?? createTarget(),
  };
}

/** 直接放行/拒绝最早那条未决请求 */
function answer(requester: RendererRequester, target: { sent: RendererRequestMessage[] }, payload: ToolConfirmAnswer) {
  const message = target.sent[target.sent.length - 1];
  return requester.reply({ id: message.id, ok: true, value: payload });
}

describe('工具确认网关（反向请求）', () => {
  it('把确认请求以 toolConfirm.ask 发给渲染端，并带上后果说明', async () => {
    const target = createTarget();
    const pending = gateway.request(askRequest({ wc: target }));

    expect(target.sent).toHaveLength(1);
    expect(target.sent[0].channel).toBe(TOOL_CONFIRM_CHANNEL);
    expect(target.sent[0].command).toBe(TOOL_CONFIRM_ASK);
    expect(target.sent[0].args).toMatchObject({
      runId: 'run-1',
      toolName: 'write_file',
      hint: '将覆盖或新建你电脑上的一个文件，同名文件内容会丢失',
    });

    answer(requester, target, { decision: 'allow', remember: false });
    await expect(pending).resolves.toBe(true);
  });

  it('用户拒绝时返回 false', async () => {
    const target = createTarget();
    const pending = gateway.request(askRequest({ wc: target }));

    answer(requester, target, { decision: 'deny', remember: false });

    await expect(pending).resolves.toBe(false);
  });

  it('只有明确放行且勾了「不再询问」才记住', async () => {
    const target = createTarget();
    const pending = gateway.request(askRequest({ wc: target }));
    answer(requester, target, { decision: 'allow', remember: true });
    await expect(pending).resolves.toBe(true);

    expect(gateway.isRemembered('write_file')).toBe(true);

    // 同类工具第二次直接放行，不再打扰用户
    const second = createTarget();
    await expect(gateway.request(askRequest({ wc: second }))).resolves.toBe(true);
    expect(second.sent).toHaveLength(0);
  });

  it('拒绝时即使勾了「不再询问」也不记住', async () => {
    const target = createTarget();
    const pending = gateway.request(askRequest({ wc: target }));
    answer(requester, target, { decision: 'deny', remember: true });
    await expect(pending).resolves.toBe(false);

    expect(gateway.isRemembered('write_file')).toBe(false);
  });

  it('超时按拒绝处理，且不留下悬垂请求', async () => {
    const target = createTarget();

    await expect(gateway.request(askRequest({ wc: target, timeoutMs: 10 }))).resolves.toBe(false);
    expect(requester.pendingCount).toBe(0);
  });

  it('窗口已销毁时直接拒绝，连消息都不发', async () => {
    const target = createTarget({ destroyed: true });

    await expect(gateway.request(askRequest({ wc: target }))).resolves.toBe(false);
    expect(target.sent).toHaveLength(0);
  });

  it('渲染端未注册服务（答复 ok:false）按拒绝处理', async () => {
    const target = createTarget();
    const pending = gateway.request(askRequest({ wc: target }));

    requester.reply({
      id: target.sent[0].id,
      ok: false,
      error: { code: 'no_handler', message: '渲染端未注册服务：toolConfirm' },
    });

    await expect(pending).resolves.toBe(false);
    expect(requester.pendingCount).toBe(0);
  });

  it('run 中止时该 run 的确认请求一并失败', async () => {
    const target = createTarget();
    const pending = gateway.request(askRequest({ wc: target, runId: 'run-9' }));

    gateway.cancelRun('run-9');

    await expect(pending).resolves.toBe(false);
    expect(requester.pendingCount).toBe(0);
  });

  it('cancelRun 只影响指定 run', async () => {
    const mine = createTarget();
    const other = createTarget();
    const minePending = gateway.request(askRequest({ wc: mine, runId: 'run-a' }));
    const otherPending = gateway.request(askRequest({ wc: other, runId: 'run-b' }));

    gateway.cancelRun('run-a');
    await expect(minePending).resolves.toBe(false);

    // 另一个 run 的请求仍然可以正常答复
    answer(requester, other, { decision: 'allow', remember: false });
    await expect(otherPending).resolves.toBe(true);
  });

  it('dispose 会拒绝所有未决请求并清空记忆', async () => {
    const target = createTarget();
    const pending = gateway.request(askRequest({ wc: target }));

    gateway.dispose();

    await expect(pending).resolves.toBe(false);
    expect(gateway.pendingCount).toBe(0);
    expect(gateway.isRemembered('write_file')).toBe(false);
  });

  it('重复答复同一条请求会被忽略', async () => {
    const target = createTarget();
    const pending = gateway.request(askRequest({ wc: target }));
    const id = target.sent[0].id;

    expect(requester.reply({ id, ok: true, value: { decision: 'deny', remember: false } })).toBe(true);
    expect(requester.reply({ id, ok: true, value: { decision: 'allow', remember: true } })).toBe(false);

    await expect(pending).resolves.toBe(false);
    expect(gateway.isRemembered('write_file')).toBe(false);
  });
});

describe('工具确认遇到页面重载', () => {
  it('重载后请求续传，用户仍能在新页面上放行', async () => {
    const target = createTarget();
    const pending = gateway.request(askRequest({ wc: target }));
    expect(target.sent).toHaveLength(1);

    // 页面开始重载 → 停表等待；新页面加载完成 → 把请求重发过去
    requester.suspendTarget(target);
    expect(requester.resumeTarget(target)).toBe(1);
    expect(target.sent).toHaveLength(2);
    expect(target.sent[1].id).toBe(target.sent[0].id);

    // 用户在新页面弹出来的确认框上点了放行
    requester.reply({
      id: target.sent[1].id,
      ok: true,
      value: { decision: 'allow', remember: false },
    });

    await expect(pending).resolves.toBe(true);
  });

  it('窗口销毁时立即按拒绝结算，不让 run 白等超时', async () => {
    const target = createTarget();
    const pending = gateway.request(askRequest({ wc: target }));

    requester.cancelTarget(target);

    await expect(pending).resolves.toBe(false);
    expect(requester.pendingCount).toBe(0);
  });
});
