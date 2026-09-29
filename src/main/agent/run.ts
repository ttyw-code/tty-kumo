import type { WebContents } from 'electron';
import { CancellationTokenSource } from '@/base/cancellation';
import { IPC, type ActiveRun, type AgentConfig, type AgentStreamEvent } from '@/common/ipc';
import type { ChatProvider, ChatRequest, LLMMessage, LLMError } from './llm/provider';
import { toOpenAITool } from './llm/provider';
import type { ToolRegistry } from './tools/types';
import type { ToolConfirmGateway } from './confirm';
import type { ISessionStore, MessageStatus, StoredMessage, ToolCallRecord } from './session';

export type RunStatus = 'running' | 'done' | 'aborted' | 'error';

export interface Run {
  runId: string;
  chatId: string;
  wc: WebContents;
  status: RunStatus;
  cts: CancellationTokenSource;
  /** 工具确认网关：危险工具执行前在此挂起等待用户答复 */
  gateway: ToolConfirmGateway;
  startedAt: number;
  finishedAt?: number;
  /** 本轮 assistant 消息在仓储里的 id；发起时已写入 streaming 占位 */
  assistantId?: string;
  /** 会话仓储；缺失时本轮不落盘（测试场景） */
  sessions?: ISessionStore;
  /**
   * 流式结果的累积缓冲。终态时一次性写入——lowdb 每次 put 都是整文件重写，
   * 逐 delta 落盘会把磁盘和队列打爆。
   */
  collected: { text: string; toolCalls: ToolCallRecord[] };
}

const runs = new Map<string, Run>();
const runByChat = new Map<string, string>();

const MAX_RETRIES = 2;
const MAX_TOOL_ROUNDS = 8;

const STATUS_TO_MESSAGE: Record<RunStatus, MessageStatus> = {
  running: 'streaming',
  done: 'done',
  aborted: 'aborted',
  error: 'error',
};

/**
 * 把本轮结果写成终态。
 * 落盘失败只影响历史留存，绝不能影响已经产生/将要发出的流事件——所以吞掉异常。
 */
async function persistRun(
  run: Run,
  status: RunStatus,
  patch: Partial<StoredMessage> = {},
): Promise<void> {
  if (!run.sessions || !run.assistantId) return;
  const calls = run.collected.toolCalls;
  try {
    await run.sessions.patchMessage(run.chatId, run.assistantId, {
      content: run.collected.text,
      status: STATUS_TO_MESSAGE[status],
      ...(calls.length > 0 ? { toolCalls: calls } : {}),
      ...patch,
    });
  } catch {
    // 数据库不可用时静默降级：用户已经看到回复，不该再弹一个存储错误
  }
}

function send(wc: WebContents, evt: AgentStreamEvent): void {
  if (!wc.isDestroyed()) wc.send(IPC.stream, evt);
}

function finishRun(run: Run, status: RunStatus): void {
  run.status = status;
  run.finishedAt = Date.now();
  // 收尾时兜底清理该 run 上未决的确认请求，避免句柄泄漏
  run.gateway.cancelRun(run.runId);
  runs.delete(run.runId);
  runByChat.delete(run.chatId);
}

function backoffMs(attempt: number): number {
  return 500 * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tokenToSignal(cts: CancellationTokenSource): AbortSignal {
  const controller = new AbortController();
  cts.token.onCancellationRequested(() => controller.abort());
  return controller.signal;
}

function parseToolArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function pump(
  run: Run,
  provider: ChatProvider,
  registry: ToolRegistry,
  req: ChatRequest,
): Promise<void> {
  let yieldedAny = false;
  let toolRounds = 0;

  const abort = async () => {
    await persistRun(run, 'aborted', { stopped: true });
    finishRun(run, 'aborted');
    send(run.wc, { runId: run.runId, chatId: run.chatId, kind: 'aborted' });
  };

  loop: for (let attempt = 0; ; attempt++) {
    if (run.cts.token.isCancellationRequested) {
      await abort();
      return;
    }

    try {
      for await (const delta of provider.chat(req)) {
        if (run.cts.token.isCancellationRequested) {
          await abort();
          return;
        }
        if (delta.text) {
          yieldedAny = true;
          run.collected.text += delta.text;
          send(run.wc, { runId: run.runId, chatId: run.chatId, kind: 'delta', text: delta.text });
        }
        if (delta.finishReason) {
          const toolCalls = delta.toolCalls ?? [];
          if (delta.finishReason === 'tool_calls' && toolCalls.length > 0) {
            if (toolRounds >= MAX_TOOL_ROUNDS) {
              const limitMessage = `工具调用轮次超过上限（${MAX_TOOL_ROUNDS}）`;
              await persistRun(run, 'error', {
                error: { code: 'unknown', message: limitMessage },
              });
              finishRun(run, 'error');
              send(run.wc, {
                runId: run.runId,
                chatId: run.chatId,
                kind: 'error',
                code: 'unknown',
                message: limitMessage,
              });
              return;
            }
            toolRounds += 1;

            const signal = tokenToSignal(run.cts);
            req.messages.push({
              role: 'assistant',
              content: '',
              toolCalls,
            });
            for (const tc of toolCalls) {
              if (run.cts.token.isCancellationRequested) {
                await abort();
                return;
              }
              send(run.wc, {
                runId: run.runId,
                chatId: run.chatId,
                kind: 'tool',
                toolCallId: tc.id,
                toolName: tc.name,
                toolArgs: tc.arguments,
              });
              let result: string;
              try {
                result = await registry.execute(tc.name, parseToolArgs(tc.arguments), {
                  runId: run.runId,
                  chatId: run.chatId,
                  signal,
                  confirm: (hint?: string) =>
                    run.gateway.request({
                      runId: run.runId,
                      chatId: run.chatId,
                      wc: run.wc,
                      toolCallId: tc.id,
                      toolName: tc.name,
                      toolArgs: tc.arguments,
                      hint,
                    }),
                });
              } catch (err) {
                result = `工具执行失败：${err instanceof Error ? err.message : String(err)}`;
              }
              req.messages.push({ role: 'tool', toolCallId: tc.id, content: result });
              // 结果随消息一起落盘，UI 才能复现「工具卡片 + 返回值」
              run.collected.toolCalls.push({
                id: tc.id,
                name: tc.name,
                args: tc.arguments,
                result,
              });
              send(run.wc, {
                runId: run.runId,
                chatId: run.chatId,
                kind: 'tool',
                toolCallId: tc.id,
                toolName: tc.name,
                toolArgs: tc.arguments,
                toolResult: result,
              });
            }
            continue loop;
          }

          await persistRun(run, 'done', delta.usage ? { usage: delta.usage } : {});
          finishRun(run, 'done');
          send(run.wc, {
            runId: run.runId,
            chatId: run.chatId,
            kind: 'done',
            finishReason: delta.finishReason,
            usage: delta.usage,
          });
          return;
        }
      }
      // 流自然结束（无 finishReason）：视为完成
      await persistRun(run, 'done');
      finishRun(run, 'done');
      send(run.wc, { runId: run.runId, chatId: run.chatId, kind: 'done' });
      return;
    } catch (err) {
      if (run.cts.token.isCancellationRequested) {
        await abort();
        return;
      }
      const code =
        err instanceof Error && 'code' in err && typeof (err as LLMError).code === 'string'
          ? (err as LLMError).code
          : 'unknown';
      const retryable = (err as LLMError).retryable ?? false;
      const message = err instanceof Error ? err.message : String(err);

      if (retryable && attempt < MAX_RETRIES && !yieldedAny) {
        await sleep(backoffMs(attempt));
        continue;
      }

      await persistRun(run, 'error', {
        error: { code, message },
      });
      finishRun(run, 'error');
      send(run.wc, {
        runId: run.runId,
        chatId: run.chatId,
        kind: 'error',
        code: code as AgentStreamEvent['code'],
        message,
      });
      return;
    }
  }
}

export function isChatRunning(chatId: string): boolean {
  return runByChat.has(chatId);
}

/** 进行中的 run 快照。渲染端重载窗口后靠它把流式状态接回来。 */
export function listActiveRuns(): ActiveRun[] {
  return [...runs.values()].map((run) => ({
    runId: run.runId,
    chatId: run.chatId,
    assistantId: run.assistantId,
    startedAt: run.startedAt,
  }));
}

export function countActiveRuns(): number {
  return runs.size;
}

export function abortRun(runId: string): void {
  runs.get(runId)?.cts.cancel();
}

/** 删除会话前调用：该会话进行中的 run 必须先停，否则收尾还会往已删记录里写 */
export function abortRunsByChat(chatId: string): void {
  const runId = runByChat.get(chatId);
  if (runId) runs.get(runId)?.cts.cancel();
}

export function abortAllRuns(): void {
  for (const runId of [...runs.keys()]) abortRun(runId);
}

export function createRun(opts: {
  runId: string;
  chatId: string;
  wc: WebContents;
  gateway: ToolConfirmGateway;
  /** 已落库的 assistant 占位消息 id，终态时 patch 它 */
  assistantId?: string;
  sessions?: ISessionStore;
}): Run {
  const run: Run = {
    ...opts,
    status: 'running',
    cts: new CancellationTokenSource(),
    startedAt: Date.now(),
    collected: { text: '', toolCalls: [] },
  };
  runs.set(run.runId, run);
  runByChat.set(run.chatId, run.runId);
  return run;
}

export function startRun(opts: {
  run: Run;
  provider: ChatProvider;
  registry: ToolRegistry;
  config: AgentConfig;
  apiKey: string;
  messages: LLMMessage[];
}): void {
  const { run, provider, registry, config, apiKey, messages } = opts;
  const req: ChatRequest = {
    messages,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey,
    signal: tokenToSignal(run.cts),
    tools: registry.list().map(toOpenAITool),
  };
  setImmediate(() => {
    void pump(run, provider, registry, req);
  });
}

export function cleanupRun(runId: string): void {
  const run = runs.get(runId);
  if (!run) return;
  if (run.status === 'running') run.cts.cancel();
  run.gateway.cancelRun(runId);
  runs.delete(runId);
  runByChat.delete(run.chatId);
}
