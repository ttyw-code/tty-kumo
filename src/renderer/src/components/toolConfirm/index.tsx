import React, { useEffect, useState } from 'react';
import { Modal, Button, useOverlayState } from '@heroui/react';
import { ShieldAlert } from 'lucide-react';
import { useStore } from '@/renderer/src/store';

function formatArgs(raw: string | undefined): string {
  if (!raw) return '{}';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

const ToolConfirmModal: React.FC = () => {
  const queue = useStore((s) => s.confirmQueue);
  const resolveConfirm = useStore((s) => s.resolveConfirm);
  const current = queue[0];
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    setRemember(false);
  }, [current?.confirmId]);

  const state = useOverlayState({ isOpen: !!current, onOpenChange: () => {} });

  const decide = (decision: 'allow' | 'deny') => {
    if (!current?.confirmId) return;
    resolveConfirm(current.confirmId, decision, decision === 'allow' && remember);
  };

  return (
    <Modal.Root state={state}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog className="bg-background text-foreground rounded-xl">
            <Modal.Header>需要你确认</Modal.Header>
            <Modal.Body>
              {current && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-content2">
                    <ShieldAlert size={16} className="mt-0.5 shrink-0 text-danger" />
                    <span className="text-sm">
                      {current.confirmHint ?? '该操作会对你的电脑产生改动，执行前请确认。'}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">工具</span>
                    <code className="text-sm font-mono break-all">{current.toolName}</code>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted">参数</span>
                    <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-content2 rounded-lg p-2 max-h-48 overflow-y-auto">
                      {formatArgs(current.toolArgs)}
                    </pre>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                    />
                    本次会话内不再询问「{current.toolName}」
                  </label>

                  {queue.length > 1 && (
                    <span className="text-xs text-muted">
                      还有 {queue.length - 1} 个操作排队等待确认
                    </span>
                  )}
                </div>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => decide('deny')}>
                拒绝
              </Button>
              <Button variant="primary" onPress={() => decide('allow')}>
                允许执行
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
};

export default ToolConfirmModal;
