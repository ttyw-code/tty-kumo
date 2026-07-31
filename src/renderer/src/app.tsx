import React, { useEffect, useState } from 'react';
import { useStore } from '@/renderer/src/store';
import Sidebar from '@/renderer/src/components/sidebar/index';
import Header from '@/renderer/src/components/header/index';
import Message from '@/renderer/src/components/message/index';
import ChatInput from '@/renderer/src/components/chatInput/index';
import ConfigModal from '@/renderer/src/components/configModal/index';

const App: React.FC = () => {
  const expanded = useStore((store) => store.expanded);
  const config = useStore((store) => store.config);
  const streaming = useStore((store) =>
    store.activeChatId ? store.streamingByChat[store.activeChatId] : undefined,
  );
  const [configOpen, setConfigOpen] = useState(false);

  function clickExit() {
    if (window.appBridge?.close) {
      window.appBridge.close();
    } else {
      console.warn('appBridge not available, close skipped');
    }
  }

  useEffect(() => {
    if (!window.agentBridge) return;
    const dispose = window.agentBridge.onStream((evt) => {
      useStore.getState().handleStreamEvent(evt);
    });
    return dispose;
  }, []);

  useEffect(() => {
    if (useStore.getState().activeChatId === null) {
      useStore.getState().newChat();
    }
    void useStore.getState().loadConfig();
  }, []);

  // 首次打开未配置 → 弹配置引导（mock 模式无需配置，跳过）
  useEffect(() => {
    if (config && !config.mock && (!config.baseUrl || !config.hasKey)) {
      setConfigOpen(true);
    }
  }, [config]);

  const sendMessage = (content: string) => {
    void useStore.getState().sendMessage(content);
  };

  return (
    <div className=" h-full w-full overflow-hidden flex justify-start gap-1 bg-background p-2">
      <Sidebar expanded={expanded} />
      <div className="h-full flex-1 flex flex-col overflow-hidden">
        <Header onExit={clickExit} onOpenConfig={() => setConfigOpen(true)} />
        <Message />
        <ChatInput onSend={sendMessage} disabled={!!streaming} />
      </div>
      <ConfigModal open={configOpen} onOpenChange={setConfigOpen} />
    </div>
  );
};

export default App;
