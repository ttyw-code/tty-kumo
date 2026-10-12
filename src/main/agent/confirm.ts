import {
  TOOL_CONFIRM_ASK,
  TOOL_CONFIRM_CHANNEL,
  type ToolConfirmAnswer,
  type ToolConfirmAsk,
} from '@/common/ipc';
import type { RendererRequester, RequestTarget } from './renderer-request';

/**
 * 工具确认网关。
 *
 * 「危险工具执行前挂起，等用户在弹窗里放行」这件事本质上是**主进程向渲染端
 * 发起一次请求**，所以它直接建立在 RendererRequester 的 request/response 之上，
 * 而不是自己拼一条流事件出去、再等一条单向答复通道回来。
 *
 * 换来的是：确认与「取消」「超时」「窗口销毁」共用一套失败语义；
 * 将来「让用户选个文件」之类的反向询问可以复用同一条链路。
 */

export const DEFAULT_CONFIRM_TIMEOUT_MS = 120_000;

export interface ConfirmRequest {
  runId: string;
  chatId: string;
  wc: RequestTarget;
  toolCallId: string;
  toolName: string;
  toolArgs: string;
  /** 弹窗上展示的后果说明 */
  hint?: string;
  timeoutMs?: number;
}

export class ToolConfirmGateway {
  /**
   * 「本次会话不再询问」记住的工具名。仅存活于进程内存——
   * 重启必须重新询问，避免一次误勾变成永久授权。
   */
  private readonly remembered = new Set<string>();

  constructor(private readonly requester: RendererRequester) {}

  /** 未决请求数，供测试与诊断使用 */
  get pendingCount(): number {
    return this.requester.pendingCount;
  }

  isRemembered(toolName: string): boolean {
    return this.remembered.has(toolName);
  }

  forgetAll(): void {
    this.remembered.clear();
  }

  /**
   * 请求用户放行。无异常路径：拿不到肯定答复就返回 false
   * （超时、窗口销毁、run 被中止、渲染端未注册服务，全都算拒绝）。
   */
  async request(opts: ConfirmRequest): Promise<boolean> {
    if (this.remembered.has(opts.toolName)) return true;

    const ask: ToolConfirmAsk = {
      runId: opts.runId,
      chatId: opts.chatId,
      toolCallId: opts.toolCallId,
      toolName: opts.toolName,
      toolArgs: opts.toolArgs,
      hint: opts.hint,
    };

    try {
      const answer = await this.requester.request<ToolConfirmAnswer>(opts.wc, {
        channel: TOOL_CONFIRM_CHANNEL,
        command: TOOL_CONFIRM_ASK,
        args: ask,
        timeoutMs: opts.timeoutMs,
        group: opts.runId,
      });
      // 「不再询问」只在明确放行时生效 —— 一次误点不该变成永久授权
      if (answer?.decision !== 'allow') return false;
      if (answer.remember) this.remembered.add(opts.toolName);
      return true;
    } catch {
      return false;
    }
  }

  /** run 被中止或清理时调用，避免承诺永久悬着 */
  cancelRun(runId: string): void {
    this.requester.cancelGroup(runId);
  }

  dispose(): void {
    this.requester.dispose();
    this.remembered.clear();
  }
}
