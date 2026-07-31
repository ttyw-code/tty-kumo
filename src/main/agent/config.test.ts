import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IDBPersister } from '@/main/database/types';

class MemDB implements IDBPersister {
  data = new Map<string, string>();
  init() { return Promise.resolve(); }
  get(key: string) { return Promise.resolve(this.data.get(key) ?? null); }
  put(key: string, value: string) { this.data.set(key, value); return Promise.resolve(); }
  del(key: string) { this.data.delete(key); return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

function mockSafeStorage() {
  const encryptString = vi.fn((s: string) => Buffer.from(`enc:${s}`));
  const decryptString = vi.fn((b: Buffer) => b.toString('utf8').replace('enc:', ''));
  const isEncryptionAvailable = vi.fn(() => true);
  vi.doMock('electron', () => ({
    safeStorage: { isEncryptionAvailable, encryptString, decryptString },
  }));
  return { encryptString, decryptString, isEncryptionAvailable };
}

describe('AgentConfigStore', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSafeStorage();
  });

  afterEach(() => {
    vi.doUnmock('electron');
  });

  it('无配置时返回空配置 hasKey=false', async () => {
    const { AgentConfigStore } = await import('./config');
    const store = new AgentConfigStore(new MemDB());
    expect(await store.get()).toEqual({ baseUrl: '', model: '', hasKey: false });
  });

  it('set 后 get 只返回 hasKey 不含明文 key', async () => {
    const db = new MemDB();
    const { AgentConfigStore } = await import('./config');
    const store = new AgentConfigStore(db);

    await store.set({ baseUrl: 'https://api.example.com/v1/', model: 'gpt-4o', apiKey: 'sk-secret' });

    const config = await store.get();
    expect(config).toEqual({ baseUrl: 'https://api.example.com/v1', model: 'gpt-4o', hasKey: true });
    expect(JSON.stringify(config)).not.toContain('sk-secret');
    const stored = db.data.get('agent.config')!;
    expect(stored).not.toContain('sk-secret');
    expect(stored).not.toContain('enc:sk-secret');
  });

  it('getDecryptedKey 解出明文供主进程使用', async () => {
    const db = new MemDB();
    const { AgentConfigStore } = await import('./config');
    const store = new AgentConfigStore(db);
    await store.set({ baseUrl: 'https://api.example.com', model: 'm', apiKey: 'sk-secret' });
    expect(await store.getDecryptedKey()).toBe('sk-secret');
  });

  it('baseUrl 非 http(s) 拒绝', async () => {
    const { AgentConfigStore } = await import('./config');
    const store = new AgentConfigStore(new MemDB());
    await expect(store.set({ baseUrl: 'file:///x', model: 'm', apiKey: 'k' })).rejects.toThrow(
      'baseUrl 必须是 http(s):// URL',
    );
  });
});
