import React from 'react';
import { Button } from '@heroui/react';
import { Square } from 'lucide-react';
import { useStore } from '@/renderer/src/store';

const Message: React.FC = () => {
  const activeChatId = useStore((s) => s.activeChatId);
  const messages = useStore((s) => (s.activeChatId ? s.messagesByChat[s.activeChatId] : undefined));
  const streaming = useStore((s) =>
    s.activeChatId ? s.streamingByChat[s.activeChatId] : undefined,
  );
  const stopStreaming = useStore((s) => s.stopStreaming);

  const list = messages ?? [];
  const streamingId = streaming?.assistantId;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {list.length === 0 && !streaming ? (
        <div className="h-full flex items-center justify-center">
          <p className="text-muted text-sm">问问 Wayne 任何问题</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 max-w-3xl mx-auto">
          {list.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-xl px-3 py-2 whitespace-pre-wrap break-words text-sm ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-content2 text-foreground'
                }`}
              >
                {msg.content ||
                  (msg.role === 'assistant' && !msg.error && !msg.stopped ? '\u200b' : '')}
                {msg.id === streamingId && (
                  <span className="inline-block w-2 h-4 ml-0.5 align-text-bottom bg-foreground/60 animate-pulse" />
                )}
                {msg.stopped && (
                  <span className="block text-xs text-muted mt-1">（已停止）</span>
                )}
                {msg.error && (
                  <div className="text-xs text-danger mt-1">错误：{msg.error.message}</div>
                )}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="flex flex-col gap-1 mt-1">
                    {msg.toolCalls.map((tc) => (
                      <div
                        key={tc.id}
                        className="text-xs text-muted bg-content1 rounded-md px-2 py-1"
                      >
                        调用工具 {tc.name}({tc.args || '{}'})
                        {tc.result !== undefined ? (
                          <div className="mt-0.5 truncate">结果: {tc.result}</div>
                        ) : (
                          <span className="inline-block w-1.5 h-1.5 ml-1 rounded-full bg-primary animate-pulse" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {streaming && (
            <div className="flex justify-center">
              <Button size="sm" variant="secondary" onPress={stopStreaming}>
                <Square size={14} /> 停止生成
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Message;
