import React from 'react';
// import { Button } from '@heroui/react';
// import BasePage from './basic-page';
import { X } from 'lucide-react';

const App: React.FC = () => {
  function clickExit() {
    if (window.appBridge?.close) {
      window.appBridge.close();
    } else {
      console.warn('appBridge not available, close skipped');
    }
  }
  return (
    <div className="drag-region flex h-full w-full flex-col overflow-hidden">
      <div className="sticky top-0 z-50 flex h-6 w-full items-center justify-end">
        <X onClick={clickExit} className="cursor-pointer" color="red" />
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-hidden rounded-2xl border border-default-200 bg-content1 shadow-sm"></div>
      </div>
    </div>
  );
};

export default App;
