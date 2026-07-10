import { VSBuffer } from '@/base/vsbuffer';
import { Emitter } from '@/base/event';

export interface IMessagePassingProtocol {
  send(buffer: VSBuffer): void;
  onMessage: (listener: (b: VSBuffer) => void) => { dispose(): void; };
}

export class InMemoryProtocol implements IMessagePassingProtocol {
  private other: InMemoryProtocol | null = null;
  private onMessageEmitter = new Emitter<VSBuffer>();

  connect(other: InMemoryProtocol) { this.other = other; other.other = this; }

  send(buffer: VSBuffer) {
    // deliver asynchronously
    setTimeout(() => this.other?.onMessageEmitter.fire(buffer), 0);
  }

  onMessage(listener: (b: VSBuffer) => void) { const fn = this.onMessageEmitter.event(listener); return { dispose: () => fn.dispose() }; }
}

// Minimal ChannelServer/Client demo
export interface IChannel {
  call<T>(command: string, arg?: any): Promise<T>;
}

export class ChannelServer {
  private channels = new Map<string, any>();
  constructor(private protocol: IMessagePassingProtocol) {
    this.protocol.onMessage((b) => this.onMessage(b));
  }

  registerChannel(name: string, impl: any) { this.channels.set(name, impl); }

  private async onMessage(buffer: VSBuffer) {
    const text = buffer.toString();
    const req = JSON.parse(text);
    const ch = this.channels.get(req.channel);
    if (!ch) return;
    const res = await ch[req.command](req.arg);
    const out = VSBuffer.fromString(JSON.stringify({ id: req.id, data: res }));
    this.protocol.send(out);
  }
}

export class ChannelClient {
  private nextId = 1;
  private pending = new Map<number, (v: any) => void>();
  constructor(private protocol: IMessagePassingProtocol) {
    this.protocol.onMessage((b) => this.onMessage(b));
  }

  getChannel(name: string): IChannel {
    return {
      call: <T>(command: string, arg?: any) => {
        const id = this.nextId++;
        const req = VSBuffer.fromString(JSON.stringify({ id, channel: name, command, arg }));
        const p = new Promise<T>(resolve => this.pending.set(id, resolve));
        this.protocol.send(req);
        return p;
      }
    };
  }

  private onMessage(buffer: VSBuffer) {
    const r = JSON.parse(buffer.toString());
    const cb = this.pending.get(r.id);
    if (cb) { cb(r.data); this.pending.delete(r.id); }
  }
}
