import React from 'react';
import { useStore } from '@/renderer/src/store';
import Sidebar from '@/renderer/src/components/sidebar/index';
import Header from '@/renderer/src/components/header/index';
import Message from '@/renderer/src/components/message/index';
import ChatInput from '@/renderer/src/components/chatInput/index';

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
    <div className=" h-full w-full overflow-hidden flex justify-start gap-1 bg-background p-2">
      <Sidebar expanded={expanded} />
      <div className="h-full flex-1 flex flex-col overflow-hidden">
        <Header onExit={clickExit} />
        <Message />
        <ChatInput />
      </div>
    </div>
  );
};

export default App;
