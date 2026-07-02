import React from 'react';
import {
  SquareX,
  ImagePlus,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  SquarePlus,
  Sun,
  Moon,
} from 'lucide-react';
import { Avatar, Button } from '@heroui/react';
import { useTheme } from '@/renderer/src/components/theme/theme-context';

const App: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const [expanded, setExpanded] = React.useState(true);
  function clickExit() {
    if (window.appBridge?.close) {
      window.appBridge.close();
    } else {
      console.warn('appBridge not available, close skipped');
    }
  }
  return (
    <div className="drag-region h-full w-full overflow-hidden flex justify-start gap-1 bg-background p-2">
      <nav
        className={`h-full ${expanded ? 'w-50 border-r border-separator' : 'w-0'} overflow-hidden transition-all duration-300`}
      >
        <div className="flex flex-col gap-1 p-4 border-b border-separator whitespace-nowrap w-50">
          <div className="flex items-center gap-2 mb-6">
            <Avatar>
              <Avatar.Fallback className="bg-lime-400">B</Avatar.Fallback>
            </Avatar>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-bold ">Bob</span>
              <span className="text-xs text-muted">bob@example.com</span>
            </div>
          </div>
          <Button className="w-full justify-start" variant="outline">
            <SquarePlus />
            New Chat
          </Button>
          <Button className="w-full justify-start" variant="outline">
            <ImagePlus />
            Library
          </Button>
          <Button className="w-full justify-start" variant="outline">
            <PackageSearch />
            Explore
          </Button>
        </div>
      </nav>
      <div className="h-full flex-1 overflow-hidden">
        <div className="flex items-center gap-2 p-2 border-b border-separator">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 hover:bg-default-soft hover:rounded-full hover:cursor-pointer"
          >
            {expanded ? (
              <PanelLeftClose size={18} />
            ) : (
              <PanelLeftOpen size={18} />
            )}
          </button>
          <div className="flex-1 flex flex-col gap-1 ">
            <span className="text-sm font-bold ">
              Pro AI components showcase
            </span>
            <span className="text-xs text-muted">Updated Just now</span>
          </div>
          <button
            onClick={toggleTheme}
            className="p-1 hover:bg-default-soft hover:rounded-full hover:cursor-pointer"
          >
            {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button
            onClick={clickExit}
            className="ml-auto p-1 hover:bg-default-soft hover:rounded-full hover:cursor-pointer"
          >
            <SquareX size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
