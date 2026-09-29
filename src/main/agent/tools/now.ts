import type { Tool } from './types';

export const nowTool: Tool = {
  definition: {
    name: 'now',
    description: '获取当前日期和时间（ISO 8601 格式）',
    inputSchema: {},
    risk: 'safe',
  },
  async execute() {
    return new Date().toISOString();
  },
};