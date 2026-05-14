import { createDecorator } from '@/platform/instantiation/common/instantiation/instantiation';
import {
  InMemoryProtocol,
  ChannelServer,
  ChannelClient,
} from '../common/simple-ipc';

export async function icpMain() {
  // const p1 = new InMemoryProtocol();
  // const p2 = new InMemoryProtocol();
  // p1.connect(p2);
  // const server = new ChannelServer(p1);
  // server.registerChannel('math', {
  //     add: async ({ a, b }: { a:number, b:number }) => a + b,
  // });
  // const client = new ChannelClient(p2);
  // const ch = client.getChannel('math');
}

export const IIpcMainService =
  createDecorator<IIpcMainService>('ipcMainService');

export interface IIpcMainService {
  icpMain(): Promise<void>;
}

export class IpcMainService implements IIpcMainService {
  async icpMain(): Promise<void> {
    // Implementation of icpMain
  }
}
