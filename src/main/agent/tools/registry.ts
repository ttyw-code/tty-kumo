import type { Tool, ToolDefinition, ToolExecuteContext, ToolRegistry } from './types';

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

  execute(name: string, args: unknown, ctx: ToolExecuteContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`未知工具：${name}`);
    return tool.execute(args, ctx);
  }
}
