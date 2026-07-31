import React, { useState } from 'react';
import { EllipsisVertical, Share2, Pencil, Pin, Trash2 } from 'lucide-react';
import { useStore } from '@/renderer/src/store';
import ContextMenu from '@/renderer/src/components/contextMenu';

interface MenuState {
  chatId: string;
  x: number;
  y: number;
}

const ChatList: React.FC = () => {
  const chats = useStore((s) => s.chats);
  const activeChatId = useStore((s) => s.activeChatId);
  const setActiveChat = useStore((s) => s.setActiveChat);
  const deleteChat = useStore((s) => s.deleteChat);
  const [menu, setMenu] = useState<MenuState | null>(null);

  return (
    <div className="flex-1 overflow-y-auto w-50 p-2">
      {chats.length > 0 && (
        <div className="text-xs text-muted px-2 py-1.5">Chats</div>
      )}
      <div className="flex flex-col gap-0.5">
        {chats.map((chat) => (
          <div
            key={chat.id}
            data-active={chat.id === activeChatId}
            onClick={() => setActiveChat(chat.id)}
            className="chat-item flex items-center shrink-0 gap-1 px-2 py-1.5 rounded-lg transition-colors"
          >
            <span className="flex-1 truncate text-sm whitespace-nowrap">
              {chat.title}
            </span>
            <div className="chat-ellipsis shrink-0 p-1 opacity-0 rounded-md transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = (e.target as HTMLElement)
                    .closest('button')!
                    .getBoundingClientRect();
                  setMenu(
                    menu?.chatId === chat.id
                      ? null
                      : { chatId: chat.id, x: rect.left, y: rect.top },
                  );
                }}
                className="outline-none cursor-pointer"
              >
                <EllipsisVertical size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {menu && (
        <ContextMenu
          position={{ x: menu.x, y: menu.y }}
          onClose={() => {
            setMenu(null);
          }}
          items={[
            {
              icon: <Share2 className="size-4 text-muted" />,
              label: '分享',
              onClick: () => {},
            },
            {
              icon: <Pencil className="size-4 text-muted" />,
              label: '重命名',
              onClick: () => {},
            },
            {
              icon: <Pin className="size-4 text-muted" />,
              label: '置顶',
              onClick: () => {},
            },
            {
              icon: <Trash2 className="size-4 text-danger" />,
              label: '删除',
              danger: true,
              onClick: () => {
                deleteChat(menu.chatId);
              },
            },
          ]}
        />
      )}
    </div>
  );
};

export default ChatList;
