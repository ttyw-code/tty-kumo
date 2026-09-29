import { clipboard } from 'electron';
import type { Tool } from './types';

export const clipboardGetTool: Tool = {
  definition: {
    name: 'clipboard_read',
    description: '读取剪贴板当前文本内容',
    inputSchema: {},
    risk: 'confirm',
    confirmHint: '剪贴板里可能含密码等私人内容，读取后会进入对话上下文',
  },
  async execute() {
    return clipboard.readText() || '(剪贴板为空)';
  },
};

export const clipboardSetTool: Tool = {
  definition: {
    name: 'clipboard_write',
    description: '将文本写入剪贴板',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    risk: 'confirm',
    confirmHint: '会覆盖你当前剪贴板里的内容',
  },
  async execute(args: unknown) {
    const text = String((args as { text?: unknown }).text ?? '');
    clipboard.writeText(text);
    return '已写入剪贴板';
  },
};
