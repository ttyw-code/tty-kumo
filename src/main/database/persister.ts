import { Worker } from 'worker_threads';
import { type DatabasePersister, DbError } from '@/main/database/types';

enum ResponseType {
  READY = 'ready',
  RESULT = 'result',
  ERROR = 'error',
}

enum RequestType {
  INIT = 'init',
  PUT = 'put',
  GET = 'get',
  DEL = 'del',
  CLOSE = 'close',
}

type RequestBase = { type: RequestType; payload?: unknown; };
type Request = RequestBase & { requestId?: string; };
type Response = { type: ResponseType; requestId?: string; payload?: unknown; error?: string; };

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
};

export class WorkerPersister implements DatabasePersister {
  private worker: Worker;
  private pending = new Map<string, PendingRequest>();
  private requestCounter = 0;

  constructor(worker: Worker) {
    this.worker = worker;

    this.worker.on('message', (message: Response) => {
      if (message.type === ResponseType.READY) return;
      if (!message.requestId) return;

      const pending = this.pending.get(message.requestId);
      if (!pending) return;

      clearTimeout(pending.timer);
      this.pending.delete(message.requestId);

      if (message.type === ResponseType.ERROR) {
        pending.reject(parseWorkerError(message.error));
        return;
      }

      pending.resolve(message.payload);
    });

    this.worker.on('error', (error) => {
      this.rejectAll(error);
    });

    this.worker.on('exit', (code) => {
      if (code !== 0) {
        this.rejectAll(new Error(`Worker exited with code ${code}`));
      }
    });
  }

  init(path: string, timeoutMs = 5000): Promise<void> {
    return this.request({ type: RequestType.INIT, payload: { path } }, timeoutMs).then(() => undefined);
  }

  put(key: string, value: string, timeoutMs = 5000): Promise<void> {
    return this.request({ type: RequestType.PUT, payload: { key, value } }, timeoutMs).then(() => undefined);
  }

  get(key: string, timeoutMs = 5000): Promise<string | null> {
    return this.request({ type: RequestType.GET, payload: { key } }, timeoutMs) as Promise<string | null>;
  }

  del(key: string, timeoutMs = 5000): Promise<void> {
    return this.request({ type: RequestType.DEL, payload: { key } }, timeoutMs).then(() => undefined);
  }

  close(timeoutMs = 5000): Promise<void> {
    return this.request({ type: RequestType.CLOSE }, timeoutMs).then(() => undefined);
  }

  private request(message: RequestBase, timeoutMs: number): Promise<unknown> {
    const requestId = `req_${Date.now()}_${this.requestCounter++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Worker request timeout: ${message.type}`));
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });
      this.worker.postMessage({ ...message, requestId } as Request);
    });
  }

  private rejectAll(error: unknown): void {
    for (const [requestId, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(requestId);
    }
  }
}

function parseWorkerError(raw: string | undefined): Error {
  if (!raw) return new DbError('Unknown worker error');
  try {
    const parsed = JSON.parse(raw) as {
      message?: string;
      code?: string;
      errno?: number;
      path?: string;
    };
    return new DbError(parsed.message ?? 'Worker error', parsed.code, parsed.path, parsed.errno);
  } catch {
    return new Error(raw);
  }
}
