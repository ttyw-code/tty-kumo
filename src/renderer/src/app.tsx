import React from 'react';
import { useStore } from '@/renderer/src/store';
import Sidebar from '@/renderer/src/components/sidebar/index';
import Header from '@/renderer/src/components/header/index';

const App: React.FC = () => {
  const expanded = useStore((store) => store.expanded);

  function clickExit() {
    if (window.appBridge?.close) {
      window.appBridge.close();
    } else {
      console.warn('appBridge not available, close skipped');
    }
  }

  return (
    <div className="drag-region h-full w-full overflow-hidden flex justify-start gap-1 bg-background p-2">
      <Sidebar expanded={expanded} />
      <div className="h-full flex-1 overflow-hidden">
        <Header onExit={clickExit} />
      </div>
    </div>
  );
};

export default App;
