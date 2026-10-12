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
  timer: NodeJS.Timeout;
  /** 归属分组（例如 runId），用于批量取消 */
  group?: string;
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

  request<T>(target: RequestTarget, opts: RequestOptions): Promise<T> {
    const id = generateUuid();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.take(id)?.reject(
          new Error(`等待渲染端响应超时（${timeoutMs}ms）：${opts.channel}.${opts.command}`),
        );
      }, timeoutMs);
      // 不因为一个待答复的请求而拖住进程退出
      timer.unref?.();

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        group: opts.group,
      });

      if (target.isDestroyed()) {
        this.take(id)?.reject(new Error('窗口已销毁，请求未送达'));
        return;
      }

      const message: RendererRequestMessage = {
        id,
        channel: opts.channel,
        command: opts.command,
        args: opts.args,
      };

      try {
        target.send(IPC.request, message);
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

  /** 批量取消某个分组下未决的请求，返回取消条数 */
  cancelGroup(group: string): number {
    let cancelled = 0;
    for (const id of [...this.pending.keys()]) {
      if (this.pending.get(id)?.group !== group) continue;
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

  private take(id: string): PendingRequest | null {
    const pending = this.pending.get(id);
    if (!pending) return null;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    return pending;
  }
}
