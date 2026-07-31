import { safeStorage } from 'electron';
import type { IDBPersister } from '@/main/database/types';
import type { AgentConfig } from '@/common/ipc';

const CONFIG_KEY = 'agent.config';

interface StoredConfig {
  baseUrl: string;
  model: string;
  key: string;
}

export class AgentConfigStore {
  constructor(private db: IDBPersister) {}

  async get(): Promise<AgentConfig> {
    const stored = await this.read();
    return { baseUrl: stored.baseUrl, model: stored.model, hasKey: !!stored.key };
  }

  async set(input: { baseUrl: string; model: string; apiKey: string }): Promise<AgentConfig> {
    const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');
    const model = input.model.trim();
    if (!/^https?:\/\//.test(baseUrl)) throw new Error('baseUrl 必须是 http(s):// URL');
    if (!model) throw new Error('model 不能为空');
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储不可用，无法加密保存 API key');
    }
    const key = safeStorage.encryptString(input.apiKey).toString('base64');
    await this.db.put(CONFIG_KEY, JSON.stringify({ baseUrl, model, key }));
    return { baseUrl, model, hasKey: !!input.apiKey };
  }

  async getDecryptedKey(): Promise<string | null> {
    const stored = await this.read();
    if (!stored.key) return null;
    return safeStorage.decryptString(Buffer.from(stored.key, 'base64'));
  }

  private async read(): Promise<StoredConfig> {
    const raw = await this.db.get(CONFIG_KEY);
    if (!raw) return { baseUrl: '', model: '', key: '' };
    try {
      const parsed = JSON.parse(raw) as Partial<StoredConfig>;
      return {
        baseUrl: parsed.baseUrl ?? '',
        model: parsed.model ?? '',
        key: parsed.key ?? '',
      };
    } catch {
      return { baseUrl: '', model: '', key: '' };
    }
  }
}
