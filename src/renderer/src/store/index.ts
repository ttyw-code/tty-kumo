import { create } from 'zustand';
import { Theme, initialTheme, applyTheme } from './theme-context';

interface Chat {
  id: string;
  title: string;
  lastMessage: string;
  updatedAt: number;
}

interface Store {
  theme: Theme;
  toggleTheme: () => void;

  expanded: boolean;
  toggleExpanded: () => void;

  chats: Chat[];
  activeChatId: string | null;
  setActiveChat: (id: string) => void;
}

const mockChats: Chat[] = [
  { id: '11111', title: '关于项目架构的讨论', lastMessage: '我们来看看这个方案', updatedAt: Date.now() - 1000 * 60 * 5 },
  { id: '22222', title: '前端性能优化方案', lastMessage: 'LCP 优化建议', updatedAt: Date.now() - 1000 * 60 * 30 },
  { id: '33333', title: '数据库设计评审', lastMessage: '这个索引需要调整', updatedAt: Date.now() - 1000 * 60 * 60 * 2 },
  { id: '44444', title: '部署流程自动化', lastMessage: 'CI/CD pipeline 配置完成', updatedAt: Date.now() - 1000 * 60 * 60 * 24 },
  { id: '55555', title: '用户体验改进计划', lastMessage: '新的交互方案', updatedAt: Date.now() - 1000 * 60 * 60 * 48 },
];

export const useStore = create<Store>((set) => ({
  theme: initialTheme,
  expanded: true,
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return { theme: next };
    }),
  toggleExpanded: () => set((state) => ({ expanded: !state.expanded })),
  chats: mockChats,
  activeChatId: null,
  setActiveChat: (id) => set({ activeChatId: id }),
}));
