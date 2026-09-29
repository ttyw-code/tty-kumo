import React, { useEffect, useState } from 'react';
import { useStore } from '@/renderer/src/store';
import Sidebar from '@/renderer/src/components/sidebar/index';
import Header from '@/renderer/src/components/header/index';
import Message from '@/renderer/src/components/message/index';
import ChatInput from '@/renderer/src/components/chatInput/index';
import ConfigModal from '@/renderer/src/components/configModal/index';
import ToolConfirmModal from '@/renderer/src/components/toolConfirm/index';

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
    void useStore.getState().loadConfig();
    // 会话的真相源在主进程：先拉列表（顺带接回进行中的 run），
    // 确实一条都没有时才建新会话
    void useStore
      .getState()
      .loadChats()
      .then(() => {
        if (useStore.getState().chats.length === 0) {
          void useStore.getState().newChat();
        }
      });
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
      <ToolConfirmModal />
    </div>
  );
};

export default App;
