// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { enqueueMessage } from './lowdb-worker';

describe('lowdb-worker 串行写', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lowdb-test-'));

  it('并发 put 全部落盘不丢更新', async () => {
    const dbPath = path.join(tmpRoot, 'concurrent');
    await enqueueMessage({ type: 'init', payload: { path: dbPath } });

    const puts = Array.from({ length: 20 }, (_, i) =>
      enqueueMessage({ type: 'put', payload: { key: `k${i}`, value: `v${i}` } }),
    );
    await Promise.all(puts);

    const db = JSON.parse(fs.readFileSync(path.join(dbPath, 'db.json'), 'utf8'));
    for (let i = 0; i < 20; i++) {
      expect(db.records[`k${i}`]).toBe(`v${i}`);
    }
  });
});
