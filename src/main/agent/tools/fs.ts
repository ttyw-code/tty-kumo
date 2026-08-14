import fs from 'fs/promises';
import path from 'path';
import type { Tool } from './types';

const MAX_READ_BYTES = 256 * 1024;

export const readFileTool: Tool = {
  definition: {
    name: 'read_file',
    description: '读取文本文件内容，path 为绝对路径',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  async execute(args: unknown) {
    const p = String((args as { path?: unknown }).path ?? '');
    if (!p) throw new Error('缺少 path 参数');
    const stat = await fs.stat(p);
    if (stat.size > MAX_READ_BYTES) {
      throw new Error(`文件过大（${stat.size} 字节），超过 ${MAX_READ_BYTES} 字节上限`);
    }
    return await fs.readFile(p, 'utf-8');
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
  },
  async execute(args: unknown) {
    const { path: p, content } = args as { path?: unknown; content?: unknown };
    if (!p) throw new Error('缺少 path 参数');
    await fs.mkdir(path.dirname(String(p)), { recursive: true });
    await fs.writeFile(String(p), String(content ?? ''), 'utf-8');
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
  },
  async execute(args: unknown) {
    const p = String((args as { path?: unknown }).path ?? '.');
    const entries = await fs.readdir(p, { withFileTypes: true });
    if (entries.length === 0) return '(空目录)';
    return entries.map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n');
  },
};
