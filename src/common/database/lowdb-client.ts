import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';

enum LowDbResponseType {
  READY = 'ready',
  RESULT = 'result',
  ERROR = 'error',
}

enum LowDbRequestType {
  INIT = 'init',
  PUT = 'put',
  GET = 'get',
  DEL = 'del',
  CLOSE = 'close',
}

type WorkerRequestBase = { type: LowDbRequestType; payload?: unknown; };


type WorkerRequest = WorkerRequestBase & { requestId?: string; };

type WorkerResponse = { type: LowDbResponseType; requestId?: string; payload?: unknown; error?: string; };


type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
};

export class LowDbWorkerClient {
  private worker: Worker;
  private pending = new Map<string, PendingRequest>();
  private requestCounter = 0;

  constructor(worker: Worker) {
    this.worker = worker;

    this.worker.on('message', (message: WorkerResponse) => {
      if (message.type === LowDbResponseType.READY) {
        return;
      }

      if (!message.requestId) {
        return;
      }

      const pending = this.pending.get(message.requestId);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timer);
      this.pending.delete(message.requestId);

      if (message.type === LowDbResponseType.ERROR) {
        pending.reject(new Error(message.error));
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
    return this.request({ type: LowDbRequestType.INIT, payload: { path } }, timeoutMs).then(() => undefined);
  }

  put(key: string, value: string, timeoutMs = 5000): Promise<void> {
    return this.request({ type: LowDbRequestType.PUT, payload: { key, value } }, timeoutMs).then(() => undefined);
  }

  get(key: string, timeoutMs = 5000): Promise<string | null> {
    return this.request({ type: LowDbRequestType.GET, payload: { key } }, timeoutMs) as Promise<string | null>;
  }

  del(key: string, timeoutMs = 5000): Promise<void> {
    return this.request({ type: LowDbRequestType.DEL, payload: { key } }, timeoutMs).then(() => undefined);
  }

  close(timeoutMs = 5000): Promise<void> {
    return this.request({ type: LowDbRequestType.CLOSE }, timeoutMs).then(() => undefined);
  }

  private request(message: WorkerRequestBase, timeoutMs: number): Promise<unknown> {
    const requestId = `req_${Date.now()}_${this.requestCounter++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Worker request timeout: ${message.type}`));
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });
      this.worker.postMessage({ ...message, requestId } as WorkerRequest);
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

export function createLowDbWorker(workerPath: string | null): LowDbWorkerClient | null {
  if (!workerPath) {
    return null;
  }

  const worker = new Worker(workerPath);
  return new LowDbWorkerClient(worker);
}

function getWorkerPath(): string | null {
  const appRoot = app.isPackaged ? app.getAppPath() : process.cwd();
  const workerCandidates = [
    path.join(appRoot, 'out/src/main/worker.cjs'),
  ];
  const workerPath = workerCandidates.find((candidate) => fs.existsSync(candidate));
  if (!workerPath) {
    console.warn('Worker file not found. Tried:', workerCandidates);
  }
  return workerPath || null;
}

let lowDbWorker: LowDbWorkerClient | null = null;

export function getLowDbWorker(): LowDbWorkerClient | null {
  if (!lowDbWorker) {
    lowDbWorker = createLowDbWorker(getWorkerPath());
  }
  return lowDbWorker;
}
