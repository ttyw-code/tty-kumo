import React from 'react';
import { ImagePlus, PackageSearch, PanelLeftClose, PanelLeftOpen, SquarePlus } from 'lucide-react';
import { Avatar, Button } from "@heroui/react";

const App: React.FC = () => {

  const [expanded, setExpanded] = React.useState(true);
  function clickExit() {
    if (window.appBridge?.close) {
      window.appBridge.close();
    } else {
      console.warn('appBridge not available, close skipped');
    }
  }
  return (
    <div className="drag-region  h-full w-full  overflow-hidden flex  justify-start gap-1 bg-default-50 p-2">
      <nav className={`h-full ${expanded ? 'w-50' : 'w-0'} overflow-hidden transition-all duration-300`}>
        <div className="flex flex-col gap-1 p-4 border-b whitespace-nowrap w-50">
          <div className="flex items-center gap-2 mb-6">
            <Avatar>
              <Avatar.Fallback className='bg-lime-200'>B</Avatar.Fallback>
            </Avatar>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-bold ">Bob</span>
              <span className="text-xs text-gray-500">bob@example.com</span>
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
      <div className="h-full flex-1 overflow-hidden ">
        <div className="flex items-center gap-2 p-2">
          <button onClick={() => setExpanded(!expanded)} className="p-2 hover:bg-gray-300 hover:rounded-full hover:cursor-pointer">
            {expanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-bold ">Pro AI components showcase</span>
            <span className="text-xs text-gray-500">Updated Just now</span>
          </div>
        </div>

      </div>
    </div>
  );
};

export default App;
