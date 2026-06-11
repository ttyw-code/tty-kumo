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
    <div className="drag-region  h-full w-full  overflow-hidden grid grid-cols-1">
      {/* <div className="sticky top-0 flex h-6 w-full items-center justify-end">
        <span className="no-drag" role="button" onClick={clickExit}>
          <X className="text-sm z-5 hover:cursor-pointer hover:text-red-500 hover:p-1 rounded" />
        </span>
      </div> */}
      <nav className='sticky left-0  w-50 border-r border-radius border-default-200'></nav>
      <div className=" overflow-hidden rounded-2xl border border-shadow-sm"></div>
    </div>
  );
};

export default App;
