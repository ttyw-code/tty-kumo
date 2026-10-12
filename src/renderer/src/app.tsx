import React, { useEffect, useState } from 'react';
import { IPC, TOOL_CONFIRM_ASK, TOOL_CONFIRM_CHANNEL, type ToolConfirmAsk } from '@/common/ipc';
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
    // 窗口控制也走统一通道，不再保留 appBridge 这个额外命名空间
    void window.ipcChannel?.call(IPC.appWindowClose);
  }

  useEffect(() => {
    if (!window.agentBridge) return;
    const dispose = window.agentBridge.onStream((evt) => {
      useStore.getState().handleStreamEvent(evt);
    });
    return dispose;
  }, []);

  // 反向请求：渲染端把「问用户要不要放行」这项能力注册给主进程，
  // 主进程在危险工具执行前调用它，答复就是弹窗里那一下点击
  useEffect(() => {
    if (!window.ipcChannel) return;
    const registration = window.ipcChannel.register(TOOL_CONFIRM_CHANNEL, (command, arg) => {
      if (command !== TOOL_CONFIRM_ASK) {
        throw new Error(`未知命令：${command}`);
      }
      return useStore.getState().askToolConfirm(arg as ToolConfirmAsk);
    });
    return () => {
      registration?.dispose();
    };
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
