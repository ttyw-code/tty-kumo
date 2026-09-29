import { exec } from 'child_process';
import { promisify } from 'util';
import type { Tool } from './types';
import { clampTimeout, inspectCommand, shellWorkingDirectory } from './guard';

const execAsync = promisify(exec);
const MAX_SHELL_BUFFER = 4 * 1024 * 1024;

export const shellTool: Tool = {
  definition: {
    name: 'run_command',
    description: '执行 shell 命令并返回 stdout/stderr，command 为命令字符串',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeoutMs: { type: 'number', description: '超时毫秒，默认 30000，上限 120000' },
      },
      required: ['command'],
    },
    risk: 'confirm',
    confirmHint: '将在你的电脑上执行一条 shell 命令',
  },
  validate: (args) => {
    const check = inspectCommand((args as { command?: unknown } | undefined)?.command);
    return check.ok ? null : (check.reason ?? '命令未通过安全检查');
  },
  async execute(args: unknown, ctx) {
    const { command, timeoutMs } = args as { command?: unknown; timeoutMs?: unknown };
    const check = inspectCommand(command);
    if (!check.ok) throw new Error(check.reason);

    const { stdout, stderr } = await execAsync(String(command), {
      timeout: clampTimeout(timeoutMs),
      windowsHide: true,
      signal: ctx.signal,
      cwd: shellWorkingDirectory(),
      maxBuffer: MAX_SHELL_BUFFER,
    });
    const out = [stdout, stderr].filter(Boolean).join('\n');
    return out || '(无输出)';
  },
};
