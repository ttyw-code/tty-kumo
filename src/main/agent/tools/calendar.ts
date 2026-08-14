import { Notification } from 'electron';
import { generateUuid } from '@/base/static/uuid';
import type { IDBPersister } from '@/main/database/types';
import type { Tool } from './types';

const SCHEDULE_KEY = 'agent_schedules';

interface ScheduleItem {
  id: string;
  title: string;
  when: string; // ISO 8601
}

const timers = new Map<string, NodeJS.Timeout>();

async function readSchedules(db: IDBPersister): Promise<ScheduleItem[]> {
  const raw = await db.get(SCHEDULE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeSchedules(db: IDBPersister, schedules: ScheduleItem[]): Promise<void> {
  await db.put(SCHEDULE_KEY, JSON.stringify(schedules));
}

function scheduleTimers(db: IDBPersister, schedules: ScheduleItem[]): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  const now = Date.now();
  for (const item of schedules) {
    const due = new Date(item.when).getTime();
    const delay = due - now;
    // ponytail: 已过期的日程直接跳过，不做补发
    if (delay <= 0) continue;
    const timer = setTimeout(async () => {
      new Notification({ title: '日程提醒', body: item.title }).show();
      await removeSchedule(db, item.id);
    }, delay);
    timers.set(item.id, timer);
  }
}

async function removeSchedule(db: IDBPersister, id: string): Promise<void> {
  const schedules = (await readSchedules(db)).filter((s) => s.id !== id);
  await writeSchedules(db, schedules);
  scheduleTimers(db, schedules);
}

export function createCalendarTools(db: IDBPersister): Tool[] {
  void readSchedules(db).then((schedules) => scheduleTimers(db, schedules));

  return [
    {
      definition: {
        name: 'schedule_add',
        description: '添加一个日程提醒，到时间弹出系统通知。when 为 ISO 8601 时间（如 2026-08-14T15:30:00）',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            when: { type: 'string' },
          },
          required: ['title', 'when'],
        },
      },
      async execute(args: unknown) {
        const { title, when } = args as { title?: unknown; when?: unknown };
        if (!title || !when) throw new Error('缺少 title 或 when 参数');
        const whenDate = new Date(String(when));
        if (Number.isNaN(whenDate.getTime())) throw new Error(`无法解析时间：${when}`);
        const item: ScheduleItem = { id: generateUuid(), title: String(title), when: whenDate.toISOString() };
        const schedules = await readSchedules(db);
        schedules.push(item);
        await writeSchedules(db, schedules);
        scheduleTimers(db, schedules);
        return `已添加日程 ${item.title}，提醒时间 ${item.when}（id: ${item.id}）`;
      },
    },
    {
      definition: {
        name: 'schedule_list',
        description: '列出所有日程提醒',
        inputSchema: {},
      },
      async execute() {
        const schedules = await readSchedules(db);
        if (schedules.length === 0) return '(无日程)';
        return schedules
          .map((s) => `- ${s.title} @ ${s.when}（id: ${s.id}）`)
          .join('\n');
      },
    },
    {
      definition: {
        name: 'schedule_remove',
        description: '删除一个日程提醒，id 为 schedule_add 返回的 id',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      async execute(args: unknown) {
        const id = String((args as { id?: unknown }).id ?? '');
        if (!id) throw new Error('缺少 id 参数');
        const before = (await readSchedules(db)).length;
        await removeSchedule(db, id);
        const removed = before - (await readSchedules(db)).length;
        return removed > 0 ? `已删除日程 ${id}` : `未找到日程 ${id}`;
      },
    },
  ];
}
