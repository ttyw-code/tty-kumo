import { describe, it, expect, beforeEach } from 'vitest';
import { SessionStore } from './session';
import type { IDBPersister } from '@/main/database/types';
import { DEFAULT_CHAT_TITLE, SESSION_SCHEMA_VERSION, type StoredMessage } from '@/common/session';

/** 内存版 persister：接口行为与 worker 版一致（异步、只存字符串） */
function createFakeDb(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  const db: IDBPersister = {
    init: async () => undefined,
    get: async (key) => data.get(key) ?? null,
    put: async (key, value) => {
      data.set(key, value);
    },
    del: async (key) => {
      data.delete(key);
    },
    close: async () => undefined,
  };
  return { db, data };
}

function message(id: string, content: string, role: 'user' | 'assistant' = 'user'): StoredMessage {
  return { id, role, content, createdAt: Date.now() };
}

let store: SessionStore;
let data: Map<string, string>;

beforeEach(() => {
  const fake = createFakeDb();
  data = fake.data;
  store = new SessionStore(fake.db);
});

describe('SessionStore 基本读写', () => {
  it('ensureSchema 写入版本号', async () => {
    await store.ensureSchema();
    expect(data.get('schema:version')).toBe(SESSION_SCHEMA_VERSION);
  });

  it('新建的会话能在列表与详情里读到', async () => {
    const record = await store.create('我的会话');

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(record.id);
    expect(list[0].title).toBe('我的会话');

    const loaded = await store.load(record.id);
    expect(loaded?.messages).toEqual([]);
  });

  it('append 后列表摘要与详情同步更新', async () => {
    const record = await store.create();

    await store.append(record.id, [message('m1', '帮我写个脚本')]);

    const [summary] = await store.list();
    expect(summary.lastMessage).toBe('帮我写个脚本');
    expect((await store.load(record.id))?.messages).toHaveLength(1);
  });

  it('首条用户消息自动定标题，之后不再改', async () => {
    const record = await store.create();
    await store.append(record.id, [message('m1', '这是第一条消息')]);

    expect((await store.list())[0].title).toBe('这是第一条消息');

    await store.append(record.id, [message('m2', '第二条消息不该改标题')]);
    expect((await store.list())[0].title).toBe('这是第一条消息');
  });

  it('显式命名过的会话不会被首条消息覆盖', async () => {
    const record = await store.create('自定义标题');
    await store.append(record.id, [message('m1', '别覆盖我')]);

    expect((await store.list())[0].title).toBe('自定义标题');
  });

  it('patchMessage 合并字段而不是整体替换', async () => {
    const record = await store.create();
    await store.append(record.id, [
      { id: 'a1', role: 'assistant', content: '部分内容', createdAt: 1, status: 'streaming' },
    ]);

    await store.patchMessage(record.id, 'a1', {
      content: '最终内容',
      status: 'done',
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    const [msg] = (await store.load(record.id))!.messages;
    expect(msg.content).toBe('最终内容');
    expect(msg.status).toBe('done');
    expect(msg.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(msg.createdAt).toBe(1);
  });

  it('rename 更新标题并保持索引只有一条', async () => {
    const record = await store.create('旧标题');
    const summary = await store.rename(record.id, '新标题');

    expect(summary?.title).toBe('新标题');
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('新标题');
    expect((await store.load(record.id))?.title).toBe('新标题');
  });

  it('remove 同时清掉记录与索引', async () => {
    const record = await store.create();
    await store.append(record.id, [message('m1', 'hi')]);

    await store.remove(record.id);

    expect(await store.load(record.id)).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it('列表按更新时间倒序', async () => {
    const first = await store.create('第一个');
    const second = await store.create('第二个');
    await store.append(first.id, [message('m1', '后又更新')]);

    const list = await store.list();
    expect(list[0].id).toBe(first.id);
    expect(list[1].id).toBe(second.id);
  });
});

describe('SessionStore 并发与边界', () => {
  it('并发 append 不丢消息（索引与记录都是 RMW，必须串行）', async () => {
    const record = await store.create();

    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        store.append(record.id, [message(`m${i}`, `第 ${i} 条`)]),
      ),
    );

    const loaded = await store.load(record.id);
    expect(loaded?.messages).toHaveLength(12);
  });

  it('并发 create 不会把列表写丢', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => store.create(`会话 ${i}`)));

    expect(await store.list()).toHaveLength(8);
  });

  it('非法 chatId 一律拒绝，不产生副作用', async () => {
    const record = await store.create();

    // 含冒号的 id 可能拼出 `chat:index` 覆盖索引，必须挡住
    await store.append('index', [message('m1', '注入')]);
    await store.append('a:b', [message('m1', '注入')]);
    await store.append('', [message('m1', '注入')]);

    expect(await store.load('index')).toBeNull();
    expect(await store.load('a:b')).toBeNull();
    expect((await store.load(record.id))?.messages).toEqual([]);
    expect(data.get('chat:index')).not.toContain('注入');
  });

  it('对不存在的会话 append 不会凭空创建', async () => {
    await store.append('not-exist', [message('m1', 'hi')]);
    expect(await store.list()).toEqual([]);
  });

  it('损坏的 JSON 不让列表整体失败', async () => {
    const fake = createFakeDb({
      'chat:index': '{ 这不是合法 JSON',
    });
    const broken = new SessionStore(fake.db);

    expect(await broken.list()).toEqual([]);
  });

  it('索引里混入脏数据时逐条丢弃', async () => {
    const record = await store.create('正常会话');
    const index = JSON.parse(data.get('chat:index')!);
    index.push({ id: 123, title: '没有 id' }, { title: '缺字段' }, null);
    data.set('chat:index', JSON.stringify(index));

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(record.id);
  });

  it('markInterrupted 把残留的 streaming 标成中断', async () => {
    const record = await store.create();
    await store.append(record.id, [
      { id: 'a1', role: 'assistant', content: '答到一半', createdAt: 1, status: 'streaming' },
      { id: 'a2', role: 'assistant', content: '已完成', createdAt: 2, status: 'done' },
    ]);

    const touched = await store.markInterrupted();

    expect(touched).toBe(1);
    const messages = (await store.load(record.id))!.messages;
    expect(messages[0].status).toBe('interrupted');
    expect(messages[0].stopped).toBe(true);
    expect(messages[1].status).toBe('done');
  });

  it('新建空会话用的就是默认标题', async () => {
    const record = await store.create();
    expect(record.title).toBe(DEFAULT_CHAT_TITLE);
  });
});
