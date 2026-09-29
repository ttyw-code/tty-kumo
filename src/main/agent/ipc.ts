import { ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { IPC, type SendAgentMessage, type StartRunResult, type ToolConfirmReply } from '@/common/ipc';
import { isValidChatId, isValidEntityId, type StoredMessage } from '@/common/session';
import type { AgentConfigStore } from './config';
import type { ChatProvider } from './llm/provider';
import type { ToolRegistry } from './tools/types';
import {
  abortRunsByChat,
  abortRun,
  cleanupRun,
  createRun,
  isChatRunning,
  listActiveRuns,
  startRun,
} from './run';
import { ToolConfirmGateway } from './confirm';
import type { ISessionStore } from './session';
import { toLLMMessages } from './history';
import { generateUuid } from '@/base/static/uuid';

export function registerAgentIpc(deps: {
  configStore: AgentConfigStore;
  createProvider: () => ChatProvider;
  tools: ToolRegistry;
  sessions: ISessionStore;
}): ToolConfirmGateway {
  const provider = deps.createProvider();
  const needsConfig = provider.requiresConfig !== false;
  const gateway = new ToolConfirmGateway();

  ipcMain.handle(IPC.send, async (event: IpcMainInvokeEvent, payload: SendAgentMessage): Promise<StartRunResult> => {
    if (
      !payload ||
      typeof payload.content !== 'string' ||
      typeof payload.chatId !== 'string'
    ) {
      throw new Error('参数不合法：需要 { content, chatId }');
    }
    const content = payload.content.trim();
    if (!content) throw new Error('消息内容不能为空');
    if (!isValidChatId(payload.chatId)) throw new Error('参数不合法：chatId 格式错误');

    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('无法找到发送窗口');

    const { chatId } = payload;
    if (isChatRunning(chatId)) {
      throw new Error('该会话已有进行中的回复，请等待完成或停止后再发送');
    }

    // 真相源在主进程：历史从仓储读取，渲染端传来的内容不可信、也不再需要
    const record = await deps.sessions.load(chatId);
    if (!record) throw new Error('会话不存在或已被删除');

    const runId = generateUuid();
    const assistantId = generateUuid();
    const startedAt = Date.now();
    const userMessage: StoredMessage = {
      // 沿用渲染端乐观插入时的 id，两端不出现同一消息两个 id
      id: isValidEntityId(payload.messageId) ? payload.messageId : generateUuid(),
      role: 'user',
      content,
      createdAt: startedAt,
    };
    // 先写 assistant 占位（streaming）：进程中途崩溃也能看出「答到哪了」，
    // 启动时 markInterrupted 会把残留的 streaming 标成 interrupted
    await deps.sessions.append(chatId, [
      userMessage,
      { id: assistantId, role: 'assistant', content: '', createdAt: startedAt, status: 'streaming' },
    ]);

    const run = createRun({
      runId,
      chatId,
      wc: event.sender,
      gateway,
      assistantId,
      sessions: deps.sessions,
    });
    event.sender.once('destroyed', () => cleanupRun(runId));

    const config = await deps.configStore.get();

    if (needsConfig && (!config.hasKey || !config.baseUrl || !config.model)) {
      const message = '未配置 LLM 服务，请先在设置中填写 baseUrl / model / API key';
      await deps.sessions
        .patchMessage(chatId, assistantId, {
          status: 'error',
          error: { code: 'no_config', message },
        })
        .catch(() => undefined);
      setImmediate(() => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC.stream, {
            runId,
            chatId,
            kind: 'error',
            code: 'no_config',
            message,
          });
        }
        cleanupRun(runId);
      });
      return { runId, assistantId };
    }

    // record 是本轮开始前的快照，不含刚追加的占位消息，正好作为历史上下文
    const messages = [...toLLMMessages(record.messages), { role: 'user' as const, content }];

    const apiKey = needsConfig ? await deps.configStore.getDecryptedKey() : '';
    startRun({ run, provider, registry: deps.tools, config, apiKey: apiKey ?? '', messages });
    return { runId, assistantId };
  });

  ipcMain.handle(IPC.abort, (_event, runId: string) => {
    abortRun(runId);
    // 中止答复中途杀掉 run，确认请求不能悬着
    gateway.cancelRun(runId);
  });

  ipcMain.on(IPC.toolConfirmReply, (_event, reply: ToolConfirmReply) => {
    gateway.reply(reply);
  });

  ipcMain.handle(IPC.chatList, () => deps.sessions.list());

  ipcMain.handle(IPC.chatLoad, (_event, chatId: string) => {
    if (!isValidChatId(chatId)) return null;
    return deps.sessions.load(chatId);
  });

  ipcMain.handle(IPC.chatCreate, (_event, title?: string) =>
    deps.sessions.create(typeof title === 'string' ? title : undefined),
  );

  ipcMain.handle(IPC.chatRename, (_event, chatId: string, title: string) => {
    if (!isValidChatId(chatId) || typeof title !== 'string') return null;
    return deps.sessions.rename(chatId, title);
  });

  ipcMain.handle(IPC.chatDelete, async (_event, chatId: string) => {
    if (!isValidChatId(chatId)) return;
    // 先掐掉进行中的 run，否则它的收尾逻辑会继续往被删的会话里写
    abortRunsByChat(chatId);
    await deps.sessions.remove(chatId);
  });

  ipcMain.handle(IPC.runsList, () => listActiveRuns());

  ipcMain.handle(IPC.configGet, async () => ({
    ...(await deps.configStore.get()),
    mock: !needsConfig,
  }));

  ipcMain.handle(IPC.configSet, (_event, cfg: { baseUrl: string; model: string; apiKey: string }) => {
    return deps.configStore.set(cfg);
  });

  return gateway;
}
