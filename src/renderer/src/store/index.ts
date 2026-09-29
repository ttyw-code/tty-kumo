import { create } from 'zustand';
import { Theme, initialTheme, applyTheme } from './theme-context';
import type { AgentConfig, AgentStreamEvent } from '@/common/ipc';
import { DEFAULT_CHAT_TITLE, type ChatRecord, type ChatSummary, type StoredMessage } from '@/common/session';
import { generateUuid } from '@/base/static/uuid';

/**
 * 渲染端状态。会话与消息的**真相源在主进程**（SessionStore + lowdb），
 * 这里保存的是投影：启动时拉取，流式期间做乐观更新，事件到达后同步。
 * 因此刷新窗口不会丢数据，重载后还能接回进行中的 run。
 */

interface StreamingState {
  runId: string | null;
  assistantId: string;
}

interface Store {
  theme: Theme;
  toggleTheme: () => void;

  expanded: boolean;
  toggleExpanded: () => void;

  config: AgentConfig | null;
  loadConfig: () => Promise<void>;
  saveConfig: (cfg: { baseUrl: string; model: string; apiKey: string }) => Promise<void>;

  chats: ChatSummary[];
  activeChatId: string | null;
  /** 启动时调用：拉会话列表，并接回仍在进行的 run */
  loadChats: () => Promise<void>;
  selectChat: (id: string) => Promise<void>;
  newChat: () => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;

  messagesByChat: Record<string, StoredMessage[]>;
  streamingByChat: Record<string, StreamingState>;
  sendMessage: (content: string) => Promise<void>;
  handleStreamEvent: (evt: AgentStreamEvent) => void;
  stopStreaming: () => void;

  /** 等待用户答复的工具确认请求（按到达顺序展示） */
  confirmQueue: AgentStreamEvent[];
  resolveConfirm: (confirmId: string, decision: 'allow' | 'deny', remember: boolean) => void;
}

function nextId(): string {
  return generateUuid();
}

function toSummary(record: ChatRecord): ChatSummary {
  return {
    id: record.id,
    title: record.title,
    lastMessage: '',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** 乐观更新侧栏：新会话的首条用户消息顺带定标题，与主进程的规则保持一致 */
function touchChat(chats: ChatSummary[], chatId: string, preview: string): ChatSummary[] {
  const now = Date.now();
  const flat = preview.replace(/\s+/g, ' ').trim();
  return chats
    .map((c) =>
      c.id === chatId
        ? {
            ...c,
            title: c.title === DEFAULT_CHAT_TITLE && flat ? flat.slice(0, 20) : c.title,
            lastMessage: flat.slice(0, 80),
            updatedAt: now,
          }
        : c,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function upsertToolCall(
  calls: NonNullable<StoredMessage['toolCalls']>,
  evt: AgentStreamEvent,
): NonNullable<StoredMessage['toolCalls']> {
  const idx = calls.findIndex((c) => c.id === evt.toolCallId);
  const entry = {
    id: evt.toolCallId!,
    name: evt.toolName!,
    args: evt.toolArgs ?? '',
    result: evt.toolResult,
  };
  if (idx === -1) return [...calls, entry];
  const next = [...calls];
  next[idx] = { ...next[idx], result: evt.toolResult };
  return next;
}

function finalizeMessage(
  messagesByChat: Record<string, StoredMessage[]>,
  streamingByChat: Record<string, StreamingState>,
  chatId: string,
  assistantId: string,
  patch: Partial<StoredMessage>,
): Pick<Store, 'messagesByChat' | 'streamingByChat'> {
  const msgs = messagesByChat[chatId] ?? [];
  const nextStreaming = { ...streamingByChat };
  delete nextStreaming[chatId];
  return {
    messagesByChat: {
      ...messagesByChat,
      [chatId]: msgs.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)),
    },
    streamingByChat: nextStreaming,
  };
}

export const useStore = create<Store>((set, get) => ({
  theme: initialTheme,
  expanded: true,
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return { theme: next };
    }),
  toggleExpanded: () => set((state) => ({ expanded: !state.expanded })),

  config: null,
  loadConfig: async () => {
    try {
      const config = await window.agentBridge!.configGet();
      set({ config });
    } catch {
      // 主进程不可用时保持未配置状态
    }
  },
  saveConfig: async (cfg) => {
    const config = await window.agentBridge!.configSet(cfg);
    set({ config });
  },

  chats: [],
  activeChatId: null,
  loadChats: async () => {
    const bridge = window.agentBridge;
    if (!bridge) return;
    try {
      const [chats, runs] = await Promise.all([bridge.chatList(), bridge.runsList()]);

      // 窗口重载后主进程的 run 还在跑，把流式状态接回来，否则事件会因为
      // 「找不到 streaming 状态」被全部丢弃
      const streamingByChat: Record<string, StreamingState> = {};
      for (const run of runs) {
        if (run.assistantId) {
          streamingByChat[run.chatId] = { runId: run.runId, assistantId: run.assistantId };
        }
      }

      set((state) => ({ chats, streamingByChat: { ...state.streamingByChat, ...streamingByChat } }));

      const target = get().activeChatId ?? chats[0]?.id ?? null;
      if (target) await get().selectChat(target);
    } catch {
      // 主进程不可用时保持空列表
    }
  },

  selectChat: async (id) => {
    set({ activeChatId: id });
    if (get().messagesByChat[id]) return;
    try {
      const record = await window.agentBridge?.chatLoad(id);
      if (!record) return;
      set((state) => ({
        messagesByChat: { ...state.messagesByChat, [id]: record.messages },
      }));
    } catch {
      // 读取失败时保持未加载，UI 显示空会话
    }
  },

  newChat: async () => {
    const bridge = window.agentBridge;
    if (!bridge) return;
    try {
      const record = await bridge.chatCreate();
      set((state) => ({
        chats: [toSummary(record), ...state.chats],
        activeChatId: record.id,
        messagesByChat: { ...state.messagesByChat, [record.id]: [] },
      }));
    } catch {
      // 创建失败就不切会话，避免指向一个不存在的 id
    }
  },

  deleteChat: async (id) => {
    const bridge = window.agentBridge;
    const streaming = get().streamingByChat[id];
    try {
      if (streaming?.runId) await bridge?.abort(streaming.runId);
      await bridge?.chatDelete(id);
    } catch {
      // 主进程侧删除失败也要清掉本地投影，否则留下一个点不开的会话
    }

    set((state) => {
      const chats = state.chats.filter((c) => c.id !== id);
      const activeChatId = state.activeChatId === id ? (chats[0]?.id ?? null) : state.activeChatId;
      const messagesByChat = { ...state.messagesByChat };
      delete messagesByChat[id];
      const streamingByChat = { ...state.streamingByChat };
      delete streamingByChat[id];
      return {
        chats,
        activeChatId,
        messagesByChat,
        streamingByChat,
        // 会话已删除，挂着没答复的确认请求一并丢弃
        confirmQueue: state.confirmQueue.filter((e) => e.chatId !== id),
      };
    });

    // 删掉当前会话后落到下一个会话，把它的消息补上
    const nextActive = get().activeChatId;
    if (nextActive && !get().messagesByChat[nextActive]) {
      await get().selectChat(nextActive);
    }
  },

  renameChat: async (id, title) => {
    try {
      const summary = await window.agentBridge?.chatRename(id, title);
      if (!summary) return;
      set((state) => ({ chats: state.chats.map((c) => (c.id === id ? summary : c)) }));
    } catch {
      // 重命名失败时保持原样
    }
  },

  messagesByChat: {},
  streamingByChat: {},
  confirmQueue: [],
  resolveConfirm: (confirmId, decision, remember) => {
    set((state) => ({
      confirmQueue: state.confirmQueue.filter((e) => e.confirmId !== confirmId),
    }));
    // 拒绝时不记住「不再询问」：否则一次误点会静默放行后续同类操作
    const effectiveRemember = decision === 'allow' && remember;
    window.agentBridge?.confirmTool({ confirmId, decision, remember: effectiveRemember });
  },

  sendMessage: async (content) => {
    const bridge = window.agentBridge;
    const { activeChatId } = get();
    if (!bridge || !activeChatId) return;
    if (get().streamingByChat[activeChatId]) return;
    const text = content.trim();
    if (!text) return;

    const chatId = activeChatId;
    const userMessage: StoredMessage = {
      id: nextId(),
      role: 'user',
      content: text,
      createdAt: Date.now(),
    };

    // 乐观插入：不等主进程往返，先把消息显示出来
    set((state) => ({
      messagesByChat: {
        ...state.messagesByChat,
        [chatId]: [...(state.messagesByChat[chatId] ?? []), userMessage],
      },
      chats: touchChat(state.chats, chatId, text),
    }));

    try {
      // 历史由主进程自己从仓储读取，渲染端不再上送
      const { runId, assistantId } = await bridge.send({
        content: text,
        chatId,
        messageId: userMessage.id,
      });

      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: [
            ...(state.messagesByChat[chatId] ?? []),
            {
              id: assistantId,
              role: 'assistant',
              content: '',
              createdAt: Date.now(),
              status: 'streaming',
            },
          ],
        },
        streamingByChat: { ...state.streamingByChat, [chatId]: { runId, assistantId } },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: [
            ...(state.messagesByChat[chatId] ?? []),
            {
              id: nextId(),
              role: 'assistant',
              content: '',
              createdAt: Date.now(),
              status: 'error',
              error: { code: 'unknown', message },
            },
          ],
        },
      }));
    }
  },

  handleStreamEvent: (evt) => {
    const st = get().streamingByChat[evt.chatId];
    if (!st) return;
    if (st.runId !== null && st.runId !== evt.runId) return;

    if (evt.kind === 'tool_confirm') {
      if (!evt.confirmId) return;
      set((state) => ({ confirmQueue: [...state.confirmQueue, evt] }));
      return;
    }

    if (evt.kind === 'delta') {
      if (!evt.text) return;
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [evt.chatId]: (state.messagesByChat[evt.chatId] ?? []).map((m) =>
            m.id === st.assistantId ? { ...m, content: m.content + evt.text } : m,
          ),
        },
      }));
      return;
    }

    if (evt.kind === 'tool') {
      if (!evt.toolCallId || !evt.toolName) return;
      set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [evt.chatId]: (state.messagesByChat[evt.chatId] ?? []).map((m) =>
            m.id === st.assistantId
              ? {
                  ...m,
                  toolCalls: upsertToolCall(m.toolCalls ?? [], evt),
                }
              : m,
          ),
        },
      }));
      return;
    }

    const patch: Partial<StoredMessage> =
      evt.kind === 'aborted'
        ? { status: 'aborted', stopped: true }
        : evt.kind === 'error'
          ? {
              status: 'error',
              error: { code: evt.code ?? 'unknown', message: evt.message ?? '未知错误' },
            }
          : { status: 'done', ...(evt.usage ? { usage: evt.usage } : {}) };

    set((state) =>
      finalizeMessage(state.messagesByChat, state.streamingByChat, evt.chatId, st.assistantId, patch),
    );
  },

  stopStreaming: () => {
    const { activeChatId, streamingByChat } = get();
    if (!activeChatId) return;
    const st = streamingByChat[activeChatId];
    if (st?.runId) void window.agentBridge!.abort(st.runId);
  },
}));
