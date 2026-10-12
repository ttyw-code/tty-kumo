import { describe, it, expect } from 'vitest';
import {
  asIPCResult,
  INVOKE_COMMANDS,
  IPC,
  IPCChannelError,
  isEnvelopeCommand,
  isIPCResult,
  parseElectronError,
  toIPCError,
} from './ipc';

class LLMErrorLike extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'LLMError';
  }
}

describe('跨进程错误序列化', () => {
  it('保留业务错误自带的 code', () => {
    const err = new LLMErrorLike('rate_limit', '请求过于频繁');
    expect(toIPCError(err)).toEqual({ code: 'rate_limit', message: '请求过于频繁' });
  });

  it('普通 Error 落到 fallback code', () => {
    expect(toIPCError(new Error('会话不存在'))).toEqual({
      code: 'unknown',
      message: '会话不存在',
    });
  });

  it('非 Error 值也能序列化，不会抛', () => {
    expect(toIPCError('炸了')).toEqual({ code: 'unknown', message: '炸了' });
    expect(toIPCError(null)).toEqual({ code: 'unknown', message: '未知错误' });
    expect(toIPCError(undefined, 'no_config')).toEqual({ code: 'no_config', message: '未知错误' });
  });

  it('IPCChannelError 往返后 code 不变', () => {
    const original = new IPCChannelError('invalid_chat_id', 'chatId 格式不合法', IPC.chatLoad);
    expect(toIPCError(original)).toEqual({
      code: 'invalid_chat_id',
      message: 'chatId 格式不合法',
    });
  });
});

describe('IPCResult 信封', () => {
  it('成功时包成 ok:true', async () => {
    const result = await asIPCResult(() => 42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('异步成功同样包成信封', async () => {
    const result = await asIPCResult(async () => ['a', 'b']);
    expect(result).toEqual({ ok: true, value: ['a', 'b'] });
  });

  it('抛异常时转成 ok:false，而不是继续抛', async () => {
    const result = await asIPCResult(() => {
      throw new IPCChannelError('boom', '炸了');
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: 'boom', message: '炸了' });
  });

  it('可以判别信封与裸值', () => {
    expect(isIPCResult({ ok: true, value: 1 })).toBe(true);
    expect(isIPCResult({ ok: false, error: { code: 'x', message: 'y' } })).toBe(true);
    // 业务返回值里恰好有 ok 字段时，缺 value/error 应视为裸值
    expect(isIPCResult({ ok: true })).toBe(false);
    expect(isIPCResult({ ok: 'yes', value: 1 })).toBe(false);
    expect(isIPCResult(null)).toBe(false);
    expect(isIPCResult([{ ok: true, value: 1 }])).toBe(false);
  });

  it('所有 invoke 通道都按信封解包', () => {
    for (const cmd of INVOKE_COMMANDS) {
      expect(isEnvelopeCommand(cmd), `${cmd} 应当已迁到信封`).toBe(true);
    }
  });

  it('推送与单向通道不在 invoke 名单内，也不会被当信封解包', () => {
    for (const cmd of [IPC.stream, IPC.toolConfirmReply]) {
      expect(INVOKE_COMMANDS).not.toContain(cmd);
      expect(isEnvelopeCommand(cmd)).toBe(false);
    }
  });
});

describe('Electron 包装过的 rejection 还原', () => {
  it('从包装文本里剥出原始 message', () => {
    const raw = new Error(
      "Error invoking remote method 'agent:chat:load': Error: 会话不存在或已被删除",
    );
    const restored = parseElectronError(raw, IPC.chatLoad);

    expect(restored.message).toBe('会话不存在或已被删除');
    expect(restored.code).toBe('unknown');
    expect(restored.command).toBe(IPC.chatLoad);
  });

  it('没有包装前缀时原样保留 message', () => {
    const restored = parseElectronError(new Error('直接炸了'), IPC.chatList);
    expect(restored.message).toBe('直接炸了');
  });

  it('多行 message 不被截断', () => {
    const raw = new Error("Error invoking remote method 'x': Error: 第一行\n第二行");
    expect(parseElectronError(raw).message).toBe('第一行\n第二行');
  });

  it('已经是通道错误时原样透传，不二次包装', () => {
    const original = new IPCChannelError('custom', '已结构化的错误', IPC.chatLoad);
    expect(parseElectronError(original)).toBe(original);
  });

  it('非 Error 值也能还原', () => {
    expect(parseElectronError('字符串错误').message).toBe('字符串错误');
  });
});
