import {
  IPC,
  IPCChannelError,
  type RendererRequestMessage,
  type RendererRequestReply,
} from '@/common/ipc';
import { generateUuid } from '@/base/static/uuid';

/**
 * 主进程 → 渲染端的 request/response。
 *
 * Electron 没有「主进程 invoke 渲染进程」的机制：`webContents.send` 只能单向推，
 * 所以这里自己配 id 把答复关联回来（协议形状见 common/ipc.ts）。
 *
 * **失败一律 fail-closed**：超时、窗口销毁、发送异常、显式取消，全部 reject。
 * 调用方拿不到肯定答复时，应当按「用户拒绝」处理。
 *
 * 窗口生命周期要分两种情况对待，混在一起就会出错：
 * - **重载**（开发时 Ctrl+R、渲染进程崩溃后恢复）：页面会回来，
 *   请求应当挂起等待并续传，否则用户看不到弹窗、工具被静默拒绝
 * - **销毁**：页面不会回来了，必须立即结算，不能白等到超时
 */

export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

/** 请求目标的最小接口（`WebContents` 的子集，便于测试替身） */
export interface RequestTarget {
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  /** 挂起期间为空 */
  timer?: NodeJS.Timeout;
  /** 归属分组（例如 runId），用于批量取消 */
  group?: string;
  /** 发出时的目标与消息，续传要用 */
  target: RequestTarget;
  message: RendererRequestMessage;
  timeoutMs: number;
  /** 页面导航中：已停表，等加载完成后续传 */
  suspended: boolean;
}

export interface RequestOptions {
  channel: string;
  command: string;
  args?: unknown;
  timeoutMs?: number;
  /** 批量取消时用，通常填 runId */
  group?: string;
}

export class RendererRequester {
  private readonly pending = new Map<string, PendingRequest>();

  get pendingCount(): number {
    return this.pending.size;
  }

  /** 挂起中的请求数（页面正在导航），便于诊断 */
  get suspendedCount(): number {
    let count = 0;
    for (const pending of this.pending.values()) {
      if (pending.suspended) count += 1;
    }
    return count;
  }

  request<T>(target: RequestTarget, opts: RequestOptions): Promise<T> {
    const id = generateUuid();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    return new Promise<T>((resolve, reject) => {
      if (target.isDestroyed()) {
        reject(new Error('窗口已销毁，请求未送达'));
        return;
      }

      const pending: PendingRequest = {
        resolve: resolve as (value: unknown) => void,
        reject,
        group: opts.group,
        target,
        message: {
          id,
          channel: opts.channel,
          command: opts.command,
          args: opts.args,
        },
        timeoutMs,
        suspended: false,
      };

      this.pending.set(id, pending);
      pending.timer = this.armTimeout(id, pending);

      try {
        target.send(IPC.request, pending.message);
      } catch (err) {
        this.take(id)?.reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** 渲染端答复。返回 false 表示 id 已失效（超时、重复答复或已取消） */
  reply(payload: RendererRequestReply): boolean {
    if (!payload || typeof payload.id !== 'string') return false;
    const pending = this.take(payload.id);
    if (!pending) return false;

    if (payload.ok) {
      pending.resolve(payload.value);
    } else {
      pending.reject(IPCChannelError.from(payload.error));
    }
    return true;
  }

  /**
   * 页面开始导航：停掉该窗口所有未决请求的计时。
   * 此时不能结算 —— 页面重载后会回来，弹窗要能重新出现。
   */
  suspendTarget(target: RequestTarget): number {
    let suspended = 0;
    for (const pending of this.pending.values()) {
      if (pending.target !== target || pending.suspended) continue;
      if (pending.timer) clearTimeout(pending.timer);
      pending.timer = undefined;
      pending.suspended = true;
      suspended += 1;
    }
    return suspended;
  }

  /**
   * 页面加载完成：把挂起的请求重新发过去，并**重新开始计时**。
   * id 保持不变，所以渲染端答复时还能对上原来的 Promise。
   */
  resumeTarget(target: RequestTarget): number {
    let resent = 0;
    for (const [id, pending] of [...this.pending.entries()]) {
      if (pending.target !== target || !pending.suspended) continue;

      if (target.isDestroyed()) {
        this.take(id)?.reject(new Error('窗口已销毁，请求未能续传'));
        continue;
      }

      pending.suspended = false;
      try {
        target.send(IPC.request, pending.message);
        pending.timer = this.armTimeout(id, pending);
        resent += 1;
      } catch (err) {
        this.take(id)?.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
    return resent;
  }

  /**
   * 窗口真的没了：立即按失败结算，不留到超时。
   * 与 suspendTarget 的区别就在「页面还会不会回来」。
   */
  cancelTarget(target: RequestTarget, reason = '窗口已销毁'): number {
    let cancelled = 0;
    for (const id of [...this.pending.keys()]) {
      if (this.pending.get(id)?.target !== target) continue;
      this.take(id)?.reject(new Error(reason));
      cancelled += 1;
    }
    return cancelled;
  }

  /** 批量取消某个分组下未决的请求，返回取消条数 */
  cancelGroup(group: string): number {
    let cancelled = 0;
    for (const id of [...this.pending.keys()]) {
      const pending = this.pending.get(id);
      if (pending?.group !== group) continue;
      this.take(id)?.reject(new Error(`请求已被取消：${group}`));
      cancelled += 1;
    }
    return cancelled;
  }

  /** 进程退出前收尾，不留悬垂 Promise */
  dispose(): void {
    for (const id of [...this.pending.keys()]) {
      this.take(id)?.reject(new Error('请求器已释放'));
    }
  }

  private armTimeout(id: string, pending: PendingRequest): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.take(id)?.reject(
        new Error(
          `等待渲染端响应超时（${pending.timeoutMs}ms）：${pending.message.channel}.${pending.message.command}`,
        ),
      );
    }, pending.timeoutMs);
    // 不因为一个待答复的请求而拖住进程退出
    timer.unref?.();
    return timer;
  }

  private take(id: string): PendingRequest | null {
    const pending = this.pending.get(id);
    if (!pending) return null;
    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(id);
    return pending;
  }
}
