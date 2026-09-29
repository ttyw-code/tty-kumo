import type { Tool, ToolDefinition, ToolExecuteContext, ToolRegistry } from './types';
import { truncateOutput } from './guard';

/** 用户拒绝后喂回模型的话：让模型收敛，而不是换个参数重试同一操作 */
export const TOOL_DENIED_MESSAGE =
  '用户拒绝执行该操作。请向用户说明你原本想做什么、是否可以改用风险更低的方案，或直接请用户手动完成；不要反复请求同一个高风险操作。';

export const TOOL_ABORTED_MESSAGE = '该 run 已被中止，工具未执行。';

export class DefaultToolRegistry implements ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`工具已存在：${tool.definition.name}`);
    }
    this.tools.set(tool.definition.name, tool);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(name: string, args: unknown, ctx: ToolExecuteContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`未知工具：${name}`);

    // 1) 硬拦截：黑名单类策略，不给确认机会
    const blockReason = tool.validate?.(args) ?? null;
    if (blockReason) return `已阻止执行：${blockReason}`;

    if (ctx.signal.aborted) return TOOL_ABORTED_MESSAGE;

    // 2) 危险操作：先拿到用户放行
    if (tool.definition.risk === 'confirm') {
      let allowed = false;
      try {
        allowed = await ctx.confirm(tool.definition.confirmHint);
      } catch {
        allowed = false;
      }
      if (!allowed) return TOOL_DENIED_MESSAGE;
      if (ctx.signal.aborted) return TOOL_ABORTED_MESSAGE;
    }

    // 3) 执行并压住输出长度，避免一次工具结果撑爆上下文
    const result = await tool.execute(args, ctx);
    return truncateOutput(result);
  }
}
