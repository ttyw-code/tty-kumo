import React from 'react';
import {
  SquareX,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
} from 'lucide-react';
import { useStore } from '@/renderer/src/store';

interface HeaderProps {
  onExit: () => void;
}

const Header: React.FC<HeaderProps> = ({ onExit }) => {
  const expanded = useStore((s) => s.expanded);
  const toggleExpanded = useStore((s) => s.toggleExpanded);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  return (
    <div className="drag-region flex items-center gap-2 p-2 border-b border-separator">
      <button
        onClick={toggleExpanded}
        className="p-1 hover:bg-default-soft hover:rounded-full hover:cursor-pointer"
      >
        {expanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
      </button>
      <div className="flex-1 flex flex-col gap-1">
        <span className="text-sm font-bold">Pro AI components showcase</span>
        <span className="text-xs text-muted">Updated Just now</span>
      </div>
      <button
        onClick={toggleTheme}
        className="p-1 hover:bg-default-soft hover:rounded-full hover:cursor-pointer"
      >
        {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
      </button>
      <button
        onClick={onExit}
        className="ml-auto p-1 hover:bg-default-soft hover:rounded-full hover:cursor-pointer"
      >
        <SquareX size={18} />
      </button>
    </div>
  );
};

export default Header;
