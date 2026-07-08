export class DBError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly path?: string,
    public readonly errno?: number,
  ) {
    super(message);
    this.name = 'DBError';
  }
}

export interface IDBPersister {
  init(path: string): Promise<void>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  close(): Promise<void>;
}
