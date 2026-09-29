import type { IDBPersister } from '@/main/database/types';
import { generateUuid } from '@/base/static/uuid';
import {
  DEFAULT_CHAT_TITLE,
  SESSION_SCHEMA_VERSION,
  isValidChatId,
  type ChatRecord,
  type ChatSummary,
  type MessageStatus,
  type StoredMessage,
  type ToolCallRecord,
} from '@/common/session';

// 会话仓储：真相源在主进程，渲染端只是投影。
// 存储布局（lowdb 是 string → string 的 KV，故 JSON 序列化后分 key 存放）：
//   schema:version → "1"
//   chat:index     → ChatSummary[]（按 updatedAt 倒序）
//   chat:{id}      → ChatRecord（含完整消息）
//
// 设计说明见 docs/specs/phase2-session-persistence.md

const INDEX_KEY = 'chat:index';
const VERSION_KEY = 'schema:version';

const MAX_TITLE_CHARS = 120;
/** 单条消息正文上限，防止一次异常写入撑爆整文件（lowdb 每次写是全文件重写） */
const MAX_CONTENT_CHARS = 200_000;

function chatKey(id: string): string {
  return `chat:${id}`;
}

export type { ChatRecord, ChatSummary, MessageStatus, StoredMessage, ToolCallRecord };

export interface ISessionStore {
  list(): Promise<ChatSummary[]>;
  load(chatId: string): Promise<ChatRecord | null>;
  create(title?: string): Promise<ChatRecord>;
  rename(chatId: string, title: string): Promise<ChatSummary | null>;
  remove(chatId: string): Promise<void>;
  /** 追加消息，并同步索引里的标题与摘要 */
  append(chatId: string, messages: StoredMessage[]): Promise<void>;
  patchMessage(chatId: string, messageId: string, patch: Partial<StoredMessage>): Promise<void>;
  /** 把上次进程遗留的 streaming 消息标记为中断，返回处理条数 */
  markInterrupted(): Promise<number>;
}

function clampText(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.length > max ? text.slice(0, max) : text;
}

/** 摘要文案：换行折叠成空格，避免侧栏出现多行 */
function summarize(messages: StoredMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messages[i].content.replace(/\s+/g, ' ').trim();
    if (text) return clampText(text, 80);
  }
  return '';
}

function deriveTitle(content: string): string {
  return clampText(content.replace(/\s+/g, ' ').trim(), 20) || DEFAULT_CHAT_TITLE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMessage(raw: unknown): StoredMessage | null {
  if (!isRecord(raw)) return null;
  const role = raw.role === 'assistant' ? 'assistant' : raw.role === 'user' ? 'user' : null;
  if (!role) return null;
  const message: StoredMessage = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : generateUuid(),
    role,
    content: clampText(raw.content, MAX_CONTENT_CHARS),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  };
  if (typeof raw.status === 'string') message.status = raw.status as MessageStatus;
  if (raw.stopped === true) message.stopped = true;
  if (isRecord(raw.error) && typeof raw.error.message === 'string') {
    message.error = {
      code: typeof raw.error.code === 'string' ? raw.error.code : 'unknown',
      message: clampText(raw.error.message, 2_000),
    };
  }
  if (Array.isArray(raw.toolCalls)) {
    const calls: ToolCallRecord[] = [];
    for (const item of raw.toolCalls) {
      if (!isRecord(item) || typeof item.name !== 'string') continue;
      calls.push({
        id: typeof item.id === 'string' ? item.id : generateUuid(),
        name: item.name,
        args: clampText(item.args, MAX_CONTENT_CHARS),
        result: typeof item.result === 'string' ? clampText(item.result, MAX_CONTENT_CHARS) : undefined,
      });
    }
    if (calls.length > 0) message.toolCalls = calls;
  }
  if (isRecord(raw.usage)) {
    const input = Number(raw.usage.inputTokens);
    const output = Number(raw.usage.outputTokens);
    if (Number.isFinite(input) && Number.isFinite(output)) {
      message.usage = { inputTokens: input, outputTokens: output };
    }
  }
  return message;
}

function normalizeRecord(id: string, raw: unknown): ChatRecord | null {
  if (!isRecord(raw)) return null;
  const messages: StoredMessage[] = [];
  if (Array.isArray(raw.messages)) {
    for (const item of raw.messages) {
      const msg = normalizeMessage(item);
      if (msg) messages.push(msg);
    }
  }
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
  return {
    id,
    title: clampText(typeof raw.title === 'string' ? raw.title : DEFAULT_CHAT_TITLE, MAX_TITLE_CHARS) ||
      DEFAULT_CHAT_TITLE,
    createdAt,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt,
    messages,
  };
}

function normalizeSummary(raw: unknown): ChatSummary | null {
  if (!isRecord(raw)) return null;
  if (!isValidChatId(raw.id)) return null;
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
  return {
    id: raw.id,
    title: clampText(typeof raw.title === 'string' ? raw.title : DEFAULT_CHAT_TITLE, MAX_TITLE_CHARS) ||
      DEFAULT_CHAT_TITLE,
    lastMessage: clampText(typeof raw.lastMessage === 'string' ? raw.lastMessage : '', 200),
    createdAt,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt,
  };
}

export class SessionStore implements ISessionStore {
  /**
   * 所有操作串行化。索引与记录都是 read-modify-write，两个 run 同时收尾
   * （或用户删会话撞上 run 落盘）会互相覆盖，必须排队。
   */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: IDBPersister) {}

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    // 队列本身不能被单次失败卡死
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async readJson(key: string): Promise<unknown> {
    const raw = await this.db.get(key);
    if (raw === null || raw === undefined || raw === '') return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      // 单条记录损坏不该拖垮整个列表；当作不存在，调用方按空处理
      return null;
    }
  }

  private async writeJson(key: string, value: unknown): Promise<void> {
    await this.db.put(key, JSON.stringify(value));
  }

  private async readIndex(): Promise<ChatSummary[]> {
    const raw = await this.readJson(INDEX_KEY);
    if (!Array.isArray(raw)) return [];
    const out: ChatSummary[] = [];
    for (const item of raw) {
      const summary = normalizeSummary(item);
      if (summary) out.push(summary);
    }
    return out;
  }

  private async writeIndex(list: ChatSummary[]): Promise<void> {
    const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
    await this.writeJson(INDEX_KEY, sorted);
  }

  /** 概要信息只在索引里维护，避免每次落盘都重读整条记录 */
  private static touchSummary(record: ChatRecord, prev?: ChatSummary): ChatSummary {
    return {
      id: record.id,
      title: record.title,
      lastMessage: summarize(record.messages) || prev?.lastMessage || '',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async ensureSchema(): Promise<void> {
    return this.serialize(async () => {
      const version = await this.db.get(VERSION_KEY);
      if (version === SESSION_SCHEMA_VERSION) return;
      // 目前只有 v1；将来 v1 → v2 的迁移在这里按 version 分支
      await this.db.put(VERSION_KEY, SESSION_SCHEMA_VERSION);
    });
  }

  list(): Promise<ChatSummary[]> {
    return this.serialize(() => this.readIndex());
  }

  load(chatId: string): Promise<ChatRecord | null> {
    return this.serialize(async () => {
      if (!isValidChatId(chatId)) return null;
      return normalizeRecord(chatId, await this.readJson(chatKey(chatId)));
    });
  }

  create(title?: string): Promise<ChatRecord> {
    return this.serialize(async () => {
      const now = Date.now();
      const record: ChatRecord = {
        id: generateUuid(),
        title: clampText(title?.trim() || DEFAULT_CHAT_TITLE, MAX_TITLE_CHARS) || DEFAULT_CHAT_TITLE,
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      await this.writeJson(chatKey(record.id), record);
      const index = await this.readIndex();
      await this.writeIndex([SessionStore.touchSummary(record), ...index]);
      return record;
    });
  }

  rename(chatId: string, title: string): Promise<ChatSummary | null> {
    return this.serialize(async () => {
      if (!isValidChatId(chatId)) return null;
      const record = normalizeRecord(chatId, await this.readJson(chatKey(chatId)));
      if (!record) return null;

      const next = clampText(title.trim(), MAX_TITLE_CHARS) || DEFAULT_CHAT_TITLE;
      record.title = next;
      record.updatedAt = Date.now();
      await this.writeJson(chatKey(chatId), record);

      const index = await this.readIndex();
      const prev = index.find((s) => s.id === chatId);
      const summary = SessionStore.touchSummary(record, prev);
      await this.writeIndex([summary, ...index.filter((s) => s.id !== chatId)]);
      return summary;
    });
  }

  remove(chatId: string): Promise<void> {
    return this.serialize(async () => {
      if (!isValidChatId(chatId)) return;
      await this.db.del(chatKey(chatId));
      const index = await this.readIndex();
      await this.writeIndex(index.filter((s) => s.id !== chatId));
    });
  }

  append(chatId: string, messages: StoredMessage[]): Promise<void> {
    return this.serialize(async () => {
      if (!isValidChatId(chatId) || messages.length === 0) return;
      const record = normalizeRecord(chatId, await this.readJson(chatKey(chatId)));
      if (!record) return;

      record.messages.push(...messages.map((m) => normalizeMessage(m)).filter((m): m is StoredMessage => !!m));
      record.updatedAt = Date.now();
      // 首条用户消息决定会话标题，之后不再自动改
      if (record.title === DEFAULT_CHAT_TITLE) {
        const firstUser = record.messages.find((m) => m.role === 'user' && m.content.trim());
        if (firstUser) record.title = deriveTitle(firstUser.content);
      }
      await this.writeJson(chatKey(chatId), record);

      const index = await this.readIndex();
      const prev = index.find((s) => s.id === chatId);
      await this.writeIndex([
        SessionStore.touchSummary(record, prev),
        ...index.filter((s) => s.id !== chatId),
      ]);
    });
  }

  patchMessage(chatId: string, messageId: string, patch: Partial<StoredMessage>): Promise<void> {
    return this.serialize(async () => {
      if (!isValidChatId(chatId)) return;
      const record = normalizeRecord(chatId, await this.readJson(chatKey(chatId)));
      if (!record) return;

      const idx = record.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      const merged = normalizeMessage({ ...record.messages[idx], ...patch, id: messageId });
      if (!merged) return;
      record.messages[idx] = merged;
      record.updatedAt = Date.now();
      await this.writeJson(chatKey(chatId), record);

      const index = await this.readIndex();
      const prev = index.find((s) => s.id === chatId);
      await this.writeIndex([
        SessionStore.touchSummary(record, prev),
        ...index.filter((s) => s.id !== chatId),
      ]);
    });
  }

  markInterrupted(): Promise<number> {
    return this.serialize(async () => {
      const index = await this.readIndex();
      let touched = 0;
      for (const summary of index) {
        const record = normalizeRecord(summary.id, await this.readJson(chatKey(summary.id)));
        if (!record) continue;
        let changed = false;
        for (const msg of record.messages) {
          if (msg.status !== 'streaming') continue;
          msg.status = 'interrupted';
          msg.stopped = true;
          changed = true;
        }
        if (!changed) continue;
        record.updatedAt = Date.now();
        await this.writeJson(chatKey(summary.id), record);
        touched += 1;
      }
      return touched;
    });
  }
}
