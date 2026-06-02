import { IDisposable } from '../../base/lifecycle';

/**
 * 发布订阅模式
 */
export class PubSub {

  private readonly subscribers: Map<string, Set<(data: any) => void>> = new Map();

  /**
   * 订阅一个主题
   * @param topic 主题名称
   * @param callback 回调函数
   * @returns IDisposable 用于取消订阅
   */
  public subscribe<T = any>(topic: string, callback: (data: T) => void): IDisposable {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, new Set());
    }

    const callbacks = this.subscribers.get(topic)!;
    callbacks.add(callback);

    return {
      dispose: () => {
        const callbacks = this.subscribers.get(topic);
        if (callbacks) {
          callbacks.delete(callback);
          if (callbacks.size === 0) {
            this.subscribers.delete(topic);
          }
        }
      }
    };
  }

  /**     * 订阅一次主题，触发后自动取消订阅
   * @param topic 主题名称
   * @param callback 回调函数
   */
  public once<T = any>(topic: string, callback: (data: T) => void): IDisposable {
    const disposable = this.subscribe<T>(topic, (data) => {
      disposable.dispose();
      callback(data);
    });
    return disposable;
  }

  /**     * 向指定主题发布消息
   * @param topic 主题名称
   * @param data 数据
   */
  public publish<T = any>(topic: string, data: T): void {
    const callbacks = this.subscribers.get(topic);
    if (callbacks) {
      // 使用 Array.from 复制一份，防止回调中取消订阅导致遍历问题
      for (const callback of Array.from(callbacks)) {
        try {
          callback(data);
        } catch (e) {
          console.error(`Error in subscriber for topic ${topic}`, e);
        }
      }
    }
  }

  /**
   * 清空所有订阅
   */
  public dispose(): void {
    this.subscribers.clear();
  }
}



const enum ObserverEventType {
  Add = 'add',
  Remove = 'remove',
  Update = 'update'
}

const sub = new PubSub();
export function onObserverEvent<T>(type: ObserverEventType, callback: (data: T) => void): IDisposable {
  return sub.subscribe<T>(type, callback);
}

const Observer = onObserverEvent<unknown>(ObserverEventType.Add, (data) => {
  console.log('Observer Add:', data);
});