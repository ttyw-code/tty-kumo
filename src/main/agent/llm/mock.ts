import os from 'os';
import path from 'path';
import { ChatProvider, ChatRequest, LLMDelta } from './provider';

/**
 * 验收工具护栏用的示例文件：落在用户主目录内，属于沙箱允许范围。
 * 这样「写文件」请求会走到确认弹窗，而不是被沙箱硬拦截。
 */
const DEMO_FILE = path.join(os.homedir(), 'tty-kumo-guard-demo.txt');

interface MockToolCall {
  name: string;
  arguments: string;
}

/**
 * 按用户消息挑一个工具来演示。
 *
 * 三种路径都能不配 API key 就验到：
 * - now        → safe，静默执行
 * - write_file → confirm，弹窗等待放行
 * - run_command（黑名单）→ 硬拦截，不弹窗直接回绝
 */
function planToolCall(content: string): MockToolCall | null {
  if (/时间|日期|now|几点/i.test(content)) {
    return { name: 'now', arguments: '{}' };
  }
  if (/写文件|write.?file/i.test(content)) {
    return {
      name: 'write_file',
      arguments: JSON.stringify({
        path: DEMO_FILE,
        content: `tty-kumo 护栏验收 ${new Date().toISOString()}\n`,
      }),
    };
  }
  if (/删|rm\s+-rf|sudo|格式化/i.test(content)) {
    return {
      name: 'run_command',
      arguments: JSON.stringify({ command: 'rm -rf /tmp/tty-kumo-demo' }),
    };
  }
  if (/跑命令|执行命令|run.?command|echo/i.test(content)) {
    return {
      name: 'run_command',
      arguments: JSON.stringify({ command: 'echo tty-kumo-guard-demo' }),
    };
  }
  return null;
}

async function* stream(req: ChatRequest, reply: string): AsyncGenerator<LLMDelta> {
  for (let i = 0; i < reply.length; i++) {
    if (req.signal.aborted) return;
    yield { text: reply[i] };
    await new Promise((r) => setTimeout(r, 20));
  }
  if (req.signal.aborted) return;
  yield { finishReason: 'stop' };
}

export class MockProvider implements ChatProvider {
  requiresConfig = false;

  async *chat(req: ChatRequest): AsyncGenerator<LLMDelta> {
    const last = [...req.messages].reverse().find((m) => m.role === 'user');
    const content = last?.content ?? '';

    const toolResult = [...req.messages].reverse().find((m) => m.role === 'tool');
    if (toolResult) {
      yield* stream(req, `（mock）工具返回：${toolResult.content || '（空）'}`);
      return;
    }

    const plan = planToolCall(content);
    if (plan) {
      yield {
        finishReason: 'tool_calls',
        toolCalls: [{ id: `mock-${plan.name}`, name: plan.name, arguments: plan.arguments }],
      };
      return;
    }

    yield* stream(
      req,
      `（mock）你说了：「${content}」。这是逐字到达的流式回复，用于验证阶段 1 的流式管道。`,
    );
  }
}
