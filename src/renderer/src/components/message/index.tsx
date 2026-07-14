import React from 'react';
import { useStore } from '@/renderer/src/store';

const Message: React.FC = () => {
  const chats = useStore((s) => s.chats);
  const activeChatId = useStore((s) => s.activeChatId);
  const activeChat = chats.find((c) => c.id === activeChatId);

  return (
    <div className="flex-1 flex items-center justify-center overflow-y-auto">
      {activeChat ? (
        <p className="text-muted text-sm">{activeChat.title}</p>
      ) : (
        <p className="text-muted text-sm">问问 Wayne 任何问题</p>
      )}
    </div>
  );
};

export default Message;
