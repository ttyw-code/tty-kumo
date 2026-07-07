import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';

export interface WorkerLauncherOptions {
  workerPath?: string;
}

const DEFAULT_WORKER_CANDIDATES = ['out/src/main/worker.cjs'];

export function launchWorker(options: WorkerLauncherOptions = {}): Worker {
  const workerPath = options.workerPath ?? resolveWorkerPath();
  return new Worker(workerPath);
}

function resolveWorkerPath(): string {
  const root = app.isPackaged ? app.getAppPath() : process.cwd();
  for (const relative of DEFAULT_WORKER_CANDIDATES) {
    const full = path.join(root, relative);
    if (fs.existsSync(full)) {
      return full;
    }
  }
  const tried = DEFAULT_WORKER_CANDIDATES.map((c) => path.join(root, c));
  throw new Error(`Worker not found. Tried: ${tried.join(', ')}`);
}
