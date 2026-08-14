import * as cheerio from 'cheerio';
import type { Tool } from './types';

const UA = 'Mozilla/5.0 (compatible; tty-kumo/1.0)';

export const webSearchTool: Tool = {
  definition: {
    name: 'web_search',
    description: '搜索网页，返回标题、链接和摘要。q 为搜索关键词，limit 控制返回条数（默认 5，最多 10）',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['q'],
    },
  },
  async execute(args: unknown, ctx) {
    const { q, limit } = args as { q?: unknown; limit?: unknown };
    const query = String(q ?? '').trim();
    if (!query) throw new Error('缺少 q 参数');

    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctx.signal });
    if (!res.ok) throw new Error(`搜索请求失败：HTTP ${res.status}`);

    const $ = cheerio.load(await res.text());
    const results: string[] = [];
    $('.result').each((_, el) => {
      const $a = $(el).find('.result__a');
      const title = $a.text().trim();
      const link = $a.attr('href') ?? '';
      const snippet = $(el).find('.result__snippet').text().trim();
      const real = new URL(link, url).searchParams.get('uddg') ?? link;
      if (title) results.push(`- ${title}\n  ${real}\n  ${snippet}`);
    });

    if (results.length === 0) return '(未找到结果)';
    const max = Math.min(Number(limit ?? 5) || 5, 10);
    return results.slice(0, max).join('\n\n');
  },
};
