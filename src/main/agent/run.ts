import type { WebContents } from 'electron';
import { CancellationTokenSource } from '@/base/cancellation';
import { IPC, type AgentConfig, type AgentStreamEvent } from '@/common/ipc';
import type { ChatProvider, ChatRequest, LLMMessage, LLMError } from './llm/provider';

export type RunStatus = 'running' | 'done' | 'aborted' | 'error';

export interface Run {
  runId: string;
  chatId: string;
  wc: WebContents;
  status: RunStatus;
  cts: CancellationTokenSource;
  startedAt: number;
  finishedAt?: number;
}

const runs = new Map<string, Run>();
const runByChat = new Map<string, string>();

const MAX_RETRIES = 2;

function send(wc: WebContents, evt: AgentStreamEvent): void {
  if (!wc.isDestroyed()) wc.send(IPC.stream, evt);
}

function finishRun(run: Run, status: RunStatus): void {
  run.status = status;
  run.finishedAt = Date.now();
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

async function pump(run: Run, provider: ChatProvider, req: ChatRequest): Promise<void> {
  let yieldedAny = false;

  for (let attempt = 0; ; attempt++) {
    if (run.cts.token.isCancellationRequested) {
      finishRun(run, 'aborted');
      send(run.wc, { runId: run.runId, chatId: run.chatId, kind: 'aborted' });
      return;
    }

    try {
      for await (const delta of provider.chat(req)) {
        if (run.cts.token.isCancellationRequested) {
          finishRun(run, 'aborted');
          send(run.wc, { runId: run.runId, chatId: run.chatId, kind: 'aborted' });
          return;
        }
        if (delta.text) {
          yieldedAny = true;
          send(run.wc, { runId: run.runId, chatId: run.chatId, kind: 'delta', text: delta.text });
        }
        if (delta.finishReason) {
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
      finishRun(run, 'done');
      send(run.wc, { runId: run.runId, chatId: run.chatId, kind: 'done' });
      return;
    } catch (err) {
      if (run.cts.token.isCancellationRequested) {
        finishRun(run, 'aborted');
        send(run.wc, { runId: run.runId, chatId: run.chatId, kind: 'aborted' });
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

export function countActiveRuns(): number {
  return runs.size;
}

export function abortRun(runId: string): void {
  runs.get(runId)?.cts.cancel();
}

export function abortAllRuns(): void {
  for (const runId of [...runs.keys()]) abortRun(runId);
}

export function createRun(opts: {
  runId: string;
  chatId: string;
  wc: WebContents;
}): Run {
  const run: Run = {
    ...opts,
    status: 'running',
    cts: new CancellationTokenSource(),
    startedAt: Date.now(),
  };
  runs.set(run.runId, run);
  runByChat.set(run.chatId, run.runId);
  return run;
}

export function startRun(opts: {
  run: Run;
  provider: ChatProvider;
  config: AgentConfig;
  apiKey: string;
  messages: LLMMessage[];
}): void {
  const { run, provider, config, apiKey, messages } = opts;
  const req: ChatRequest = {
    messages,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey,
    signal: tokenToSignal(run.cts),
  };
  setImmediate(() => {
    void pump(run, provider, req);
  });
}

export function cleanupRun(runId: string): void {
  const run = runs.get(runId);
  if (!run) return;
  if (run.status === 'running') run.cts.cancel();
  runs.delete(runId);
  runByChat.delete(run.chatId);
}
