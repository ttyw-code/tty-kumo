// Tool 契约边界：阶段 1 只立接口，阶段 3 填充实现，阶段「护栏」补安全层

/**
 * 工具危险等级。分级标准（详见 docs/specs/tool-safety-guard.md）：
 * - `safe`：只读，不对用户可见资源产生副作用。仍受路径沙箱限制。
 * - `confirm`：会改动用户可见资源（文件系统 / 进程 / 剪贴板 / 日程等），
 *   执行前必须经用户确认。
 */
export type ToolRisk = 'safe' | 'confirm';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: ToolRisk;
  /** confirm 级工具在弹窗里展示的一句话后果说明 */
  confirmHint?: string;
}

export interface ToolExecuteContext {
  runId: string;
  chatId: string;
  signal: AbortSignal;
  /**
   * 请求用户放行。仅 confirm 级工具需要调用，hint 为弹窗上展示的后果说明。
   * 用户拒绝 / 等待超时 / run 被中止，都返回 false。
   */
  confirm(hint?: string): Promise<boolean>;
}

export interface Tool {
  definition: ToolDefinition;
  /**
   * 硬拦截校验：返回原因字符串即阻止执行（不弹确认框，也不给模型重试空间）。
   * 用于黑名单类策略，如 shell 危险命令、越界路径。
   */
  validate?(args: unknown): string | null;
  execute(args: unknown, ctx: ToolExecuteContext): Promise<string>;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  list(): ToolDefinition[];
  has(name: string): boolean;
  execute(name: string, args: unknown, ctx: ToolExecuteContext): Promise<string>;
}
