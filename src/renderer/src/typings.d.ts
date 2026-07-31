import type { AgentBridge } from '@/main/preload';

declare module '*.css';

export {};

declare global {
  interface Window {
    appBridge?: {
      quit: () => void;
      minimize: () => void;
      close: () => void;
    };
    agentBridge?: AgentBridge;
  }
}
