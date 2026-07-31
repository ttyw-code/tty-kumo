import { ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { WebContents } from 'electron';
import { IPC, type AgentStreamEvent, type SendAgentMessage } from '@/common/ipc';

interface Run {
  wc: WebContents;
  chatId: string;
  timer?: NodeJS.Timeout;
  startedAt: number;
}

const runs = new Map<string, Run>();

function send(wc: WebContents, evt: AgentStreamEvent): void {
  if (!wc.isDestroyed()) wc.send(IPC.stream, evt);
}

function clearRun(runId: string): void {
  const run = runs.get(runId);
  if (!run) return;
  if (run.timer) clearInterval(run.timer);
  runs.delete(runId);
}

function startMockReply(runId: string, run: Run, content: string): void {
  const reply = `（mock）你说了：「${content}」。这是逐字到达的流式回复，用于验证阶段 0 的流式管道。`;

  let i = 0;
  const timer = setInterval(() => {
    if (i >= reply.length) {
      clearRun(runId);
      send(run.wc, { runId, chatId: run.chatId, kind: 'done' });
      return;
    }
    send(run.wc, { runId, chatId: run.chatId, kind: 'delta', text: reply[i] });
    i += 1;
  }, 20);
  run.timer = timer;
}

export function registerAgentIpc(): void {
  ipcMain.handle(IPC.send, (event: IpcMainInvokeEvent, payload: SendAgentMessage) => {
    if (!payload || typeof payload.content !== 'string' || typeof payload.chatId !== 'string') {
      throw new Error('参数不合法：需要 { content, chatId }');
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('无法找到发送窗口');

    const runId = crypto.randomUUID();
    const run: Run = { wc: event.sender, chatId: payload.chatId, startedAt: Date.now() };
    runs.set(runId, run);
    event.sender.once('destroyed', () => clearRun(runId));

    // 契约：send resolve 前不产生任何流事件
    setImmediate(() => startMockReply(runId, run, payload.content));
    return runId;
  });

  ipcMain.handle(IPC.abort, (event, runId: string) => {
    const run = runs.get(runId);
    if (!run || run.wc !== event.sender) return;
    clearRun(runId);
    send(run.wc, { runId, chatId: run.chatId, kind: 'aborted' });
  });
}
