import fs from 'fs';
import path from 'path';
import { parentPort } from 'worker_threads';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

type WorkerMessage =
  | { type: 'init'; payload: { path: string }; requestId?: string }
  | { type: 'put'; payload: { key: string; value: string }; requestId?: string }
  | { type: 'get'; payload: { key: string }; requestId?: string }
  | { type: 'del'; payload: { key: string }; requestId?: string }
  | { type: 'close'; requestId?: string };

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; requestId?: string; payload?: unknown }
  | { type: 'error'; requestId?: string; error: string };

type DbData = {
  records: Record<string, string>;
};

let db: Low<DbData> | null = null;

function postMessage(message: WorkerResponse): void {
  if (parentPort) {
    parentPort.postMessage(message);
  }
}

function resolveDbFile(dbPath: string): string {
  if (dbPath.endsWith('.json')) {
    return dbPath;
  }
  return path.join(dbPath, 'db.json');
}

async function ensureDbOpen(dbPath: string): Promise<void> {
  if (db) return;
  const filePath = resolveDbFile(dbPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const adapter = new JSONFile<DbData>(filePath);
  db = new Low(adapter, { records: {} });
  await db.read();
  db.data ||= { records: {} };
  await db.write();
}

async function handleMessage(message: WorkerMessage): Promise<void> {
  try {
    switch (message.type) {
      case 'init':
        await ensureDbOpen(message.payload.path);
        if (message.requestId) {
          postMessage({ type: 'result', requestId: message.requestId });
        } else {
          postMessage({ type: 'ready' });
        }
        return;
      case 'put':
        if (!db) throw new Error('DB not initialized');
        db.data.records[message.payload.key] = message.payload.value;
        await db.write();
        postMessage({ type: 'result', requestId: message.requestId });
        return;
      case 'get':
        if (!db) throw new Error('DB not initialized');
        postMessage({
          type: 'result',
          requestId: message.requestId,
          payload: db.data.records[message.payload.key] ?? null,
        });
        return;
      case 'del':
        if (!db) throw new Error('DB not initialized');
        delete db.data.records[message.payload.key];
        await db.write();
        postMessage({ type: 'result', requestId: message.requestId });
        return;
      case 'close':
        db = null;
        postMessage({ type: 'result', requestId: message.requestId });
        return;
      default:
        postMessage({ type: 'error', error: 'Unknown message type' });
    }
  } catch (error) {
    const err = error as {
      message?: string;
      code?: string;
      errno?: number;
      path?: string;
      stack?: string;
    };
    const details = {
      message: err.message,
      code: err.code,
      errno: err.errno,
      path: err.path,
      stack: err.stack,
    };
    postMessage({
      type: 'error',
      requestId: message.requestId,
      error: JSON.stringify(details),
    });
  }
}

if (parentPort) {
  parentPort.on('message', (message: WorkerMessage) => {
    void handleMessage(message);
  });
}