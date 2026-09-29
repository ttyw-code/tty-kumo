import fs from 'fs/promises';
import path from 'path';
import type { Tool } from './types';
import { MAX_READ_BYTES, checkPath } from './guard';

type PathArgs = { path?: unknown };

/** validate 与 execute 两侧共用：读路径走 read 域，写路径走 write 域 */
function pathIssue(args: unknown, mode: 'read' | 'write'): string | null {
  const check = checkPath((args as PathArgs | undefined)?.path, mode);
  return check.ok ? null : check.reason;
}

function requirePath(args: unknown, mode: 'read' | 'write'): string {
  const check = checkPath((args as PathArgs | undefined)?.path, mode);
  if (!check.ok) throw new Error(check.reason);
  return check.abs;
}

export const readFileTool: Tool = {
  definition: {
    name: 'read_file',
    description: '读取文本文件内容，path 为绝对路径',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    risk: 'safe',
  },
  validate: (args) => pathIssue(args, 'read'),
  async execute(args: unknown) {
    const abs = requirePath(args, 'read');
    const stat = await fs.stat(abs);
    if (stat.isDirectory()) throw new Error('目标是一个目录，请用 list_dir 读取');
    if (stat.size > MAX_READ_BYTES) {
      throw new Error(`文件过大（${stat.size} 字节），超过 ${MAX_READ_BYTES} 字节上限`);
    }
    return await fs.readFile(abs, 'utf-8');
  },
};

export const writeFileTool: Tool = {
  definition: {
    name: 'write_file',
    description: '覆盖写入文本文件，自动创建父目录，path 为绝对路径',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
    risk: 'confirm',
    confirmHint: '将覆盖或新建你电脑上的一个文件，同名文件内容会丢失',
  },
  validate: (args) => pathIssue(args, 'write'),
  async execute(args: unknown) {
    const abs = requirePath(args, 'write');
    const { content } = args as { content?: unknown };
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, String(content ?? ''), 'utf-8');
    return '已写入';
  },
};

export const listDirTool: Tool = {
  definition: {
    name: 'list_dir',
    description: '列出目录下的文件和子目录名称，path 为绝对路径',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    risk: 'safe',
  },
  validate: (args) => pathIssue(args, 'read'),
  async execute(args: unknown) {
    const abs = requirePath(args, 'read');
    const entries = await fs.readdir(abs, { withFileTypes: true });
    if (entries.length === 0) return '(空目录)';
    return entries.map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n');
  },
};
