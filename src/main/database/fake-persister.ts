import { type DatabasePersister } from '@/main/database/types';

export class FakePersister implements DatabasePersister {
  private store = new Map<string, string>();
  private initialized = false;

  async init(_path: string): Promise<void> {
    this.initialized = true;
  }

  async get(key: string): Promise<string | null> {
    this.ensureInitialized();
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.ensureInitialized();
    this.store.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.ensureInitialized();
    this.store.delete(key);
  }

  async close(): Promise<void> {
    this.store.clear();
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Persister not initialized. Call init() first.');
    }
  }
}
