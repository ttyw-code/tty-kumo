import type { IDBPersister } from '@/main/database/types';
import type { Tool } from './types';

export function createDbTools(db: IDBPersister): Tool[] {
  return [
    {
      definition: {
        name: 'db_get',
        description: '读取数据库中一个 key 的值（字符串）',
        inputSchema: {
          type: 'object',
          properties: { key: { type: 'string' } },
          required: ['key'],
        },
      },
      async execute(args: unknown) {
        const key = String((args as { key?: unknown }).key ?? '');
        if (!key) throw new Error('缺少 key 参数');
        const value = await db.get(key);
        return value ?? '(无此 key)';
      },
    },
    {
      definition: {
        name: 'db_put',
        description: '向数据库写入一个 key 的值（字符串）',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            value: { type: 'string' },
          },
          required: ['key', 'value'],
        },
      },
      async execute(args: unknown) {
        const { key, value } = args as { key?: unknown; value?: unknown };
        if (!key) throw new Error('缺少 key 参数');
        await db.put(String(key), String(value ?? ''));
        return '已写入';
      },
    },
    {
      definition: {
        name: 'db_del',
        description: '删除数据库中一个 key',
        inputSchema: {
          type: 'object',
          properties: { key: { type: 'string' } },
          required: ['key'],
        },
      },
      async execute(args: unknown) {
        const key = String((args as { key?: unknown }).key ?? '');
        if (!key) throw new Error('缺少 key 参数');
        await db.del(key);
        return '已删除';
      },
    },
  ];
}
