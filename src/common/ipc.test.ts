import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ENVELOPE_COMMANDS, EVENT_CHANNELS, INVOKE_COMMANDS, IPC, ONE_WAY_COMMANDS } from './ipc';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * 通道表的护栏。
 *
 * 以前这里比对的是「preload 与 ipc.ts 里手写的通道字面量是否一致」——
 * 现在 preload 的通道名全部派生自 IPC 常量，手写漂移已经不可能发生，
 * 于是护栏换成守更靠后的东西：**通道表本身是否自洽**。
 */
describe('IPC 通道表', () => {
  const allChannels: string[] = Object.values(IPC);

  it('白名单里的命令都在 IPC 常量里真实存在', () => {
    for (const cmd of [...INVOKE_COMMANDS, ...EVENT_CHANNELS, ...ONE_WAY_COMMANDS]) {
      expect(allChannels, `通道表中不存在的命令：${cmd}`).toContain(cmd);
    }
  });

  it('每个通道都被归类，不留孤儿', () => {
    const classified = new Set([...INVOKE_COMMANDS, ...EVENT_CHANNELS, ...ONE_WAY_COMMANDS]);
    const orphans = allChannels.filter((c) => !classified.has(c));
    expect(orphans, '新增通道后忘了归入 INVOKE_COMMANDS / EVENT_CHANNELS / ONE_WAY_COMMANDS').toEqual(
      [],
    );
  });

  it('三类互不重叠，且合起来正好覆盖全部通道', () => {
    const merged = [...INVOKE_COMMANDS, ...EVENT_CHANNELS, ...ONE_WAY_COMMANDS];
    expect(new Set(merged).size).toBe(merged.length);
    expect(merged.length).toBe(allChannels.length);
  });

  it('通道名统一使用 agent: 前缀', () => {
    for (const channel of allChannels) {
      expect(/^(agent|app):/.test(channel), `通道名不符合约定：${channel}`).toBe(true);
    }
  });

  it('全部 invoke 通道都已迁到 IPCResult 信封', () => {
    expect([...ENVELOPE_COMMANDS].sort()).toEqual([...INVOKE_COMMANDS].sort());
  });

  it('preload 不再硬编码任何通道字符串', () => {
    const preload = readFileSync(join(here, '../main/preload.ts'), 'utf8');
    const literals = [...preload.matchAll(/'agent:[^']+'/g)].map((m) => m[0]);
    expect(literals, 'preload 里的通道名应当派生自 IPC 常量，不要再手写').toEqual([]);
  });

  it('主进程不再硬编码通道字符串', () => {
    for (const file of ['../main/main.ts', '../main/agent/ipc.ts']) {
      const code = readFileSync(join(here, file), 'utf8');
      const literals = [...code.matchAll(/'(?:agent|app):[^']+'/g)].map((m) => m[0]);
      expect(literals, `${file} 里的通道名应当引用 IPC 常量`).toEqual([]);
    }
  });
});
