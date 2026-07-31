import type { AgentStreamEvent, SendAgentMessage } from '@/common/ipc';

declare module '*.css';

export {};

declare global {
  interface Window {
    appBridge?: {
      quit: () => void;
      minimize: () => void;
      close: () => void;
    };
    agentBridge?: {
      send: (payload: SendAgentMessage) => Promise<string>;
      abort: (runId: string) => Promise<void>;
      onStream: (callback: (evt: AgentStreamEvent) => void) => () => void;
    };
  }
}
