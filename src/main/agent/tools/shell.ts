import { exec } from 'child_process';
import { promisify } from 'util';
import type { Tool } from './types';

const execAsync = promisify(exec);

export const shellTool: Tool = {
  definition: {
    name: 'run_command',
    description: '执行 shell 命令并返回 stdout/stderr，command 为命令字符串',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeoutMs: { type: 'number', description: '超时毫秒，默认 30000' },
      },
      required: ['command'],
    },
  },
  async execute(args: unknown, ctx) {
    const { command, timeoutMs } = args as { command?: unknown; timeoutMs?: unknown };
    if (!command) throw new Error('缺少 command 参数');
    const { stdout, stderr } = await execAsync(String(command), {
      timeout: Number(timeoutMs ?? 30000),
      windowsHide: true,
      signal: ctx.signal,
    });
    const out = [stdout, stderr].filter(Boolean).join('\n');
    return out || '(无输出)';
  },
};
