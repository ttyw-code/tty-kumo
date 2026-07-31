import { create } from 'zustand';
import { Theme, initialTheme, applyTheme } from './theme-context';
import type { AgentErrorCode, AgentStreamEvent } from '@/common/ipc';

interface Chat {
  id: string;
  title: string;
  lastMessage: string;
  updatedAt: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  stopped?: boolean;
  error?: { code: AgentErrorCode; message: string };
}

interface StreamingState {
  runId: string | null;
  assistantId: string;
}

interface Store {
  theme: Theme;
  toggleTheme: () => void;

  expanded: boolean;
  toggleExpanded: () => void;

  chats: Chat[];
  activeChatId: string | null;
  setActiveChat: (id: string) => void;
  newChat: () => void;
  deleteChat: (id: string) => void;

  messagesByChat: Record<string, Message[]>;
  streamingByChat: Record<string, StreamingState>;
  sendMessage: (content: string) => Promise<void>;
  handleStreamEvent: (evt: AgentStreamEvent) => void;
  stopStreaming: () => void;
}

let chatSeq = 0;

function createChat(title: string): Chat {
  chatSeq += 1;
  return {
    id: `chat-${chatSeq}-${Date.now()}`,
    title,
    lastMessage: '',
    updatedAt: Date.now(),
  };
}

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function finalizeMessage(
  messagesByChat: Record<string, Message[]>,
  streamingByChat: Record<string, StreamingState>,
  chatId: string,
  assistantId: string,
  patch: Partial<Message>,
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

  chats: [],
  activeChatId: null,
  setActiveChat: (id) => set({ activeChatId: id }),
  newChat: () => {
    const chat = createChat('新会话');
    set((state) => ({
      chats: [chat, ...state.chats],
      activeChatId: chat.id,
    }));
  },
  deleteChat: (id) => {
    const st = get().streamingByChat[id];
    if (st?.runId) void window.agentBridge!.abort(st.runId);
    set((state) => {
      const chats = state.chats.filter((c) => c.id !== id);
      const activeChatId =
        state.activeChatId === id ? (chats[0]?.id ?? null) : state.activeChatId;
      const messagesByChat = { ...state.messagesByChat };
      delete messagesByChat[id];
      const streamingByChat = { ...state.streamingByChat };
      delete streamingByChat[id];
      return { chats, activeChatId, messagesByChat, streamingByChat };
    });
  },

  messagesByChat: {},
  streamingByChat: {},
  sendMessage: async (content) => {
    const { activeChatId } = get();
    if (!activeChatId) return;
    if (get().streamingByChat[activeChatId]) return;

    const userMsg: Message = { id: nextId(), role: 'user', content };
    const assistantMsg: Message = { id: nextId(), role: 'assistant', content: '' };
    set((state) => ({
      messagesByChat: {
        ...state.messagesByChat,
        [activeChatId]: [
          ...(state.messagesByChat[activeChatId] ?? []),
          userMsg,
          assistantMsg,
        ],
      },
      streamingByChat: {
        ...state.streamingByChat,
        [activeChatId]: { runId: null, assistantId: assistantMsg.id },
      },
      chats: state.chats.map((c) =>
        c.id === activeChatId
          ? {
              ...c,
              title: c.title === '新会话' ? content.slice(0, 20) : c.title,
              lastMessage: content,
              updatedAt: Date.now(),
            }
          : c,
      ),
    }));

    try {
      const runId = await window.agentBridge!.send({ content, chatId: activeChatId });
      set((state) => ({
        streamingByChat: {
          ...state.streamingByChat,
          [activeChatId]: {
            ...state.streamingByChat[activeChatId],
            runId,
          },
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((state) =>
        finalizeMessage(
          state.messagesByChat,
          state.streamingByChat,
          activeChatId,
          assistantMsg.id,
          { error: { code: 'unknown', message } },
        ),
      );
    }
  },
  handleStreamEvent: (evt) => {
    const st = get().streamingByChat[evt.chatId];
    if (!st) return;
    if (st.runId !== null && st.runId !== evt.runId) return;

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

    const patch: Partial<Message> =
      evt.kind === 'aborted'
        ? { stopped: true }
        : evt.kind === 'error'
          ? { error: { code: evt.code ?? 'unknown', message: evt.message ?? '未知错误' } }
          : {};
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
