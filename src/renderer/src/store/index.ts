import { create } from 'zustand';
import { Theme, initialTheme, applyTheme } from './theme-context';


interface Store {
  theme: Theme;
  toggleTheme: () => void;

  expanded: boolean;
  toggleExpanded: () => void;
}

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
}));
