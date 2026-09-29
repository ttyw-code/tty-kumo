import { IPC, type AgentStreamEvent, type ToolConfirmReply } from '@/common/ipc';
import { generateUuid } from '@/base/static/uuid';

/**
 * 工具确认网关。
 *
 * 主进程的工具执行在此「挂起」等待渲染端答复：
 * 主 → 渲染：走唯一的推送通道 `agent:stream`，kind = 'tool_confirm'
 * 渲染 → 主：单向 `agent:tool:confirm:reply`（ipcRenderer.send，不用 invoke）
 *
 * 安全默认：超时、窗口销毁、run 被中止，一律按「拒绝」处理。
 */
export const DEFAULT_CONFIRM_TIMEOUT_MS = 120_000;

interface PendingConfirm {
  resolve: (allowed: boolean) => void;
  timer: NodeJS.Timeout;
  runId: string;
  toolName: string;
}

/**
 * 推送目标的最小接口（WebContents 的子集）。
 * 网关只需要「还活着吗」和「发事件」，不必依赖完整 Electron 类型。
 */
export interface StreamTarget {
  isDestroyed(): boolean;
  send(channel: string, event: AgentStreamEvent): void;
}

export interface ConfirmRequest {
  runId: string;
  chatId: string;
  wc: StreamTarget;
  toolCallId: string;
  toolName: string;
  toolArgs: string;
  /** 弹窗上展示的后果说明 */
  hint?: string;
  timeoutMs?: number;
}

export class ToolConfirmGateway {
  private readonly pending = new Map<string, PendingConfirm>();

  /**
   * 「本次会话不再询问」记住的工具名。仅存活于进程内存——
   * 重启必须重新询问，避免一次误勾变成永久授权。
   */
  private readonly remembered = new Set<string>();

  get pendingCount(): number {
    return this.pending.size;
  }

  isRemembered(toolName: string): boolean {
    return this.remembered.has(toolName);
  }

  forgetAll(): void {
    this.remembered.clear();
  }

  /** 请求用户放行，无异常路径：拿不到肯定答复就返回 false */
  request(opts: ConfirmRequest): Promise<boolean> {
    if (this.remembered.has(opts.toolName)) return Promise.resolve(true);

    const confirmId = generateUuid();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
    const event: AgentStreamEvent = {
      runId: opts.runId,
      chatId: opts.chatId,
      kind: 'tool_confirm',
      confirmId,
      toolCallId: opts.toolCallId,
      toolName: opts.toolName,
      toolArgs: opts.toolArgs,
      confirmHint: opts.hint,
    };

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.settle(confirmId, false);
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(confirmId, { resolve, timer, runId: opts.runId, toolName: opts.toolName });

      if (opts.wc.isDestroyed()) {
        this.settle(confirmId, false);
        return;
      }
      opts.wc.send(IPC.stream, event);
    });
  }

  /** 渲染端答复。返回 false 表示 confirmId 已失效（重复回复或已超时） */
  reply(reply: ToolConfirmReply): boolean {
    if (!reply || typeof reply.confirmId !== 'string') return false;
    const pending = this.pending.get(reply.confirmId);
    if (!pending) return false;

    if (reply.decision === 'allow' && reply.remember) {
      this.remembered.add(pending.toolName);
    }
    this.settle(reply.confirmId, reply.decision === 'allow');
    return true;
  }

  /** run 被中止/清理时调用，避免承诺永久悬着 */
  cancelRun(runId: string): void {
    for (const [confirmId, pending] of [...this.pending.entries()]) {
      if (pending.runId !== runId) continue;
      this.settle(confirmId, false);
    }
  }

  dispose(): void {
    for (const confirmId of [...this.pending.keys()]) {
      this.settle(confirmId, false);
    }
    this.remembered.clear();
  }

  private settle(confirmId: string, allowed: boolean): void {
    const pending = this.pending.get(confirmId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(confirmId);
    pending.resolve(allowed);
  }
}
