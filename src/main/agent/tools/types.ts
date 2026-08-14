// Tool 契约边界：阶段 1 只立接口，阶段 3 填充实现
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolExecuteContext {
  runId: string;
  chatId: string;
  signal: AbortSignal;
}

export interface Tool {
  definition: ToolDefinition;
  execute(args: unknown, ctx: ToolExecuteContext): Promise<string>;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  list(): ToolDefinition[];
  has(name: string): boolean;
  execute(name: string, args: unknown, ctx: ToolExecuteContext): Promise<string>;
}
