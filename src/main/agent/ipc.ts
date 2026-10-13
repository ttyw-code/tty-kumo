import { ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import {
  asIPCResult,
  IPC,
  IPCChannelError,
  type RendererRequestReply,
  type SendAgentMessage,
  type StartRunResult,
} from '@/common/ipc';
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
import { RendererRequester } from './renderer-request';
import type { ISessionStore } from './session';
import { toLLMMessages } from './history';
import { generateUuid } from '@/base/static/uuid';

export interface AgentIpcHandle {
  /** 工具确认网关：窗口销毁 / 进程退出时 dispose */
  gateway: ToolConfirmGateway;
  /**
   * 反向请求器。之所以要交出去，是因为它必须跟着窗口生命周期走 ——
   * 页面重载要挂起与续传，窗口销毁要立即结算（见 renderer-request.ts）
   */
  requester: RendererRequester;
}

export function registerAgentIpc(deps: {
  configStore: AgentConfigStore;
  createProvider: () => ChatProvider;
  tools: ToolRegistry;
  sessions: ISessionStore;
}): AgentIpcHandle {
  const provider = deps.createProvider();
  const needsConfig = provider.requiresConfig !== false;
  // 反向请求器：主进程 → 渲染端。工具确认是它的第一个使用者
  const requester = new RendererRequester();
  const gateway = new ToolConfirmGateway(requester);

  /**
   * 发起一轮对话。校验失败一律抛 `IPCChannelError` 带明确 code ——
   * 这些 code 会经信封原样到达渲染端，供它区分「该提示用户」还是「该重试」。
   */
  const handleSend = async (
    event: IpcMainInvokeEvent,
    payload: SendAgentMessage,
  ): Promise<StartRunResult> => {
    if (
      !payload ||
      typeof payload.content !== 'string' ||
      typeof payload.chatId !== 'string'
    ) {
      throw new IPCChannelError('invalid_payload', '参数不合法：需要 { content, chatId }');
    }
    const content = payload.content.trim();
    if (!content) throw new IPCChannelError('empty_content', '消息内容不能为空');
    if (!isValidChatId(payload.chatId)) {
      throw new IPCChannelError('invalid_chat_id', `chatId 格式不合法：${payload.chatId}`);
    }

    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new IPCChannelError('no_window', '无法找到发送窗口');

    const { chatId } = payload;
    if (isChatRunning(chatId)) {
      throw new IPCChannelError('chat_busy', '该会话已有进行中的回复，请等待完成或停止后再发送');
    }

    // 真相源在主进程：历史从仓储读取，渲染端传来的内容不可信、也不再需要
    const record = await deps.sessions.load(chatId);
    if (!record) throw new IPCChannelError('chat_not_found', '会话不存在或已被删除');

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
  };

  ipcMain.handle(IPC.send, (event: IpcMainInvokeEvent, payload: SendAgentMessage) =>
    asIPCResult(() => handleSend(event, payload)),
  );

  ipcMain.handle(IPC.abort, (_event, runId: string) =>
    asIPCResult(() => {
      if (typeof runId !== 'string' || !runId) {
        throw new IPCChannelError('invalid_payload', 'runId 不合法');
      }
      abortRun(runId);
      // 中止答复中途杀掉 run，确认请求不能悬着
      gateway.cancelRun(runId);
    }),
  );

  // 反向请求的答复入口（渲染端 → 主进程）
  ipcMain.on(IPC.requestReply, (_event, payload: RendererRequestReply) => {
    requester.reply(payload);
  });

  // 以下通道统一走 IPCResult 信封：失败返回 {ok:false, error} 而不是抛异常，
  // 这样 code 才能活着跨过 IPC 边界（见 docs/specs/ipc-channel.md）
  const requireChatId = (chatId: unknown): string => {
    if (!isValidChatId(chatId)) {
      throw new IPCChannelError('invalid_chat_id', `chatId 格式不合法：${String(chatId)}`);
    }
    return chatId;
  };

  ipcMain.handle(IPC.chatList, () => asIPCResult(() => deps.sessions.list()));

  ipcMain.handle(IPC.chatLoad, (_event, chatId: string) =>
    asIPCResult(() => deps.sessions.load(requireChatId(chatId))),
  );

  ipcMain.handle(IPC.chatCreate, (_event, title?: string) =>
    asIPCResult(() => deps.sessions.create(typeof title === 'string' ? title : undefined)),
  );

  // 通道参数统一是**单个**可结构化克隆的值（channel 契约只接受一个 arg），
  // 因此多参数命令要打包成对象
  ipcMain.handle(IPC.chatRename, (_event, payload: { chatId: string; title: string }) =>
    asIPCResult(() => {
      if (!payload || typeof payload.title !== 'string') {
        throw new IPCChannelError('invalid_payload', '参数不合法：需要 { chatId, title }');
      }
      requireChatId(payload.chatId);
      return deps.sessions.rename(payload.chatId, payload.title);
    }),
  );

  ipcMain.handle(IPC.chatDelete, (_event, chatId: string) =>
    asIPCResult(async () => {
      requireChatId(chatId);
      // 先掐掉进行中的 run，否则它的收尾逻辑会继续往被删的会话里写
      abortRunsByChat(chatId);
      await deps.sessions.remove(chatId);
    }),
  );

  ipcMain.handle(IPC.runsList, () => asIPCResult(() => listActiveRuns()));

  ipcMain.handle(IPC.configGet, () =>
    asIPCResult(async () => ({
      ...(await deps.configStore.get()),
      mock: !needsConfig,
    })),
  );

  ipcMain.handle(
    IPC.configSet,
    (_event, cfg: { baseUrl: string; model: string; apiKey: string }) =>
      asIPCResult(() => {
        if (
          !cfg ||
          typeof cfg.baseUrl !== 'string' ||
          typeof cfg.model !== 'string' ||
          typeof cfg.apiKey !== 'string'
        ) {
          throw new IPCChannelError(
            'invalid_payload',
            '参数不合法：需要 { baseUrl, model, apiKey }',
          );
        }
        return deps.configStore.set(cfg);
      }),
  );

  return { gateway, requester };
}
