import { ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { IPC, type SendAgentMessage } from '@/common/ipc';
import type { AgentConfigStore } from './config';
import type { ChatProvider, LLMMessage } from './llm/provider';
import type { ToolRegistry } from './tools/types';
import { abortRun, cleanupRun, createRun, isChatRunning, startRun } from './run';
import { generateUuid } from '@/base/static/uuid';

export function registerAgentIpc(deps: {
  configStore: AgentConfigStore;
  createProvider: () => ChatProvider;
  tools: ToolRegistry;
}): void {
  const provider = deps.createProvider();
  const needsConfig = provider.requiresConfig !== false;

  ipcMain.handle(IPC.send, async (event: IpcMainInvokeEvent, payload: SendAgentMessage) => {
    if (
      !payload ||
      typeof payload.content !== 'string' ||
      typeof payload.chatId !== 'string' ||
      !Array.isArray(payload.history)
    ) {
      throw new Error('参数不合法：需要 { content, chatId, history }');
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('无法找到发送窗口');
    if (isChatRunning(payload.chatId)) {
      throw new Error('该会话已有进行中的回复，请等待完成或停止后再发送');
    }

    const runId = generateUuid();
    const run = createRun({ runId, chatId: payload.chatId, wc: event.sender });
    event.sender.once('destroyed', () => cleanupRun(runId));

    const config = await deps.configStore.get();
    const messages: LLMMessage[] = [
      ...payload.history.map((m) => ({
        role: m.role,
        content: m.content,
        toolCallId: m.toolCallId,
        toolCalls: m.toolCalls,
      })),
      { role: 'user', content: payload.content },
    ];

    if (needsConfig && (!config.hasKey || !config.baseUrl || !config.model)) {
      setImmediate(() => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.stream, {
            runId,
            chatId: run.chatId,
            kind: 'error',
            code: 'no_config',
            message: '未配置 LLM 服务，请先在设置中填写 baseUrl / model / API key',
          });
        }
        cleanupRun(runId);
      });
      return runId;
    }

    const apiKey = needsConfig ? await deps.configStore.getDecryptedKey() : '';
    startRun({ run, provider, registry: deps.tools, config, apiKey: apiKey ?? '', messages });
    return runId;
  });

  ipcMain.handle(IPC.abort, (event, runId: string) => {
    abortRun(runId);
  });

  ipcMain.handle(IPC.configGet, async () => ({
    ...(await deps.configStore.get()),
    mock: !needsConfig,
  }));

  ipcMain.handle(IPC.configSet, (_event, cfg: { baseUrl: string; model: string; apiKey: string }) => {
    return deps.configStore.set(cfg);
  });
}
