import React, { useState, useCallback } from 'react';
import { TextArea } from '@heroui/react';
import { Send } from 'lucide-react';

interface ChatInputProps {
  onSend?: (content: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  placeholder = '问问Wayne',
  disabled = false,
}) => {
  const [content, setContent] = useState('');

  const handleSend = useCallback(() => {
    const trimmed = content.trim();
    if (!trimmed || disabled) return;
    onSend?.(trimmed);
    setContent('');
  }, [content, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex items-center gap-2 p-4 ">
      <TextArea
        placeholder={placeholder}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        fullWidth
        rows={3}
        className="resize-none place-content-center"
      />
      <button
        onClick={handleSend}
        disabled={!content.trim() || disabled}
        className="p-2.5 rounded-xl bg-primary text-white hover:opacity-80 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Send size={18} />
      </button>
    </div>
  );
};

export default ChatInput;
