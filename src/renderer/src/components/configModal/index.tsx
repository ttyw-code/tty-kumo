import React, { useEffect, useState } from 'react';
import { Modal, Button, useOverlayState } from '@heroui/react';
import { useStore } from '@/renderer/src/store';

interface ConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ConfigModal: React.FC<ConfigModalProps> = ({ open, onOpenChange }) => {
  const config = useStore((s) => s.config);
  const saveConfig = useStore((s) => s.saveConfig);
  const state = useOverlayState({ isOpen: open, onOpenChange });

  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && config) {
      setBaseUrl(config.baseUrl);
      setModel(config.model);
      setError(null);
    }
  }, [open, config]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveConfig({ baseUrl, model, apiKey });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full rounded-lg bg-content2 text-foreground text-sm px-3 py-2 outline-none focus:ring-2 focus:ring-primary';

  return (
    <Modal.Root state={state}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog className="bg-background text-foreground rounded-xl">
            <Modal.Header>LLM 设置</Modal.Header>
            <Modal.Body>
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Base URL
                  <input
                    className={inputCls}
                    placeholder="https://api.openai.com/v1"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                  <span>OpenAI 兼容接口地址（http/https）</span>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Model
                  <input
                    className={inputCls}
                    placeholder="gpt-4o"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  API Key
                  <input
                    className={inputCls}
                    type="password"
                    placeholder={config?.hasKey ? '已保存（留空保持不变）' : 'sk-...'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <span>仅保存在本机，经系统安全存储加密</span>
                </label>
                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => onOpenChange(false)}>
                取消
              </Button>
              <Button variant="primary" isDisabled={saving} onPress={handleSave}>
                {saving ? '保存中…' : '保存'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
};

export default ConfigModal;
