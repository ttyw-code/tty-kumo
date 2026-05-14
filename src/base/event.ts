import { DisposableStore, IDisposable } from './lifecycle';

type Listener<T> = (e: T) => void;

export class Emitter<T> {
  private readonly _options?: EmiiterOptions | undefined;

  private listeners: Set<Listener<T>> = new Set();

  private _event?: Event<T>;

  get event(): Event<T> {
    this._event ??= (
      listener: (e: T) => unknown,
      thisArgs?: any,
      disposables?: IDisposable[] | DisposableStore,
    ) => {
      if (thisArgs) {
        listener = listener.bind(thisArgs);
      }
      this.listeners.add(listener as Listener<T>);
      const result = {
        dispose: () => {
          this.listeners.delete(listener as Listener<T>);
        },
      };
      if (disposables instanceof DisposableStore) {
        disposables.add(result);
      } else if (Array.isArray(disposables)) {
        disposables.push(result);
      }
      return result;
    };
    return this._event;
  }

  fire(e: T) {
    for (const l of Array.from(this.listeners)) {
      try {
        l(e);
      } catch (err) {
        // swallow
      }
    }
  }

  dispose() {
    this.listeners.clear();
  }

  constructor(options?: EmiiterOptions) {
    this._options = options;
  }
}

export interface Event<T> {
  (
    listener: (e: T) => unknown,
    thisArgs?: any,
    disposables?: IDisposable[] | DisposableStore,
  ): IDisposable;
}

export interface EmiiterOptions {
  onWillAddFirstListener?: () => void;
  onDidRemoveLastListener?: () => void;
}

export interface NodeEventEmitter {
  on(event: string | symbol, listener: Function): unknown;
  removeListener(event: string | symbol, listener: Function): unknown;
}

/**
 * Creates an {@link Event} from a node event emitter.
 */
export function fromNodeEventEmitter<T>(
  emitter: NodeEventEmitter,
  eventName: string,
  map: (...args: any[]) => T = (id) => id,
): Event<T> {
  const fn = (...args: any[]) => result.fire(map(...args));
  const onFirstListenerAdd = () => emitter.on(eventName, fn);
  const onLastListenerRemove = () => emitter.removeListener(eventName, fn);
  const result = new Emitter<T>({
    onWillAddFirstListener: onFirstListenerAdd,
    onDidRemoveLastListener: onLastListenerRemove,
  });

  return result.event;
}

export interface DOMEventEmitter {
  addEventListener(event: string | symbol, listener: Function): void;
  removeEventListener(event: string | symbol, listener: Function): void;
}

/**
 * Creates an {@link Event} from a DOM event emitter.
 */
export function fromDOMEventEmitter<T>(
  emitter: DOMEventEmitter,
  eventName: string,
  map: (...args: any[]) => T = (id) => id,
): Event<T> {
  const fn = (...args: any[]) => result.fire(map(...args));
  const onFirstListenerAdd = () => emitter.addEventListener(eventName, fn);
  const onLastListenerRemove = () => emitter.removeEventListener(eventName, fn);
  const result = new Emitter<T>({
    onWillAddFirstListener: onFirstListenerAdd,
    onDidRemoveLastListener: onLastListenerRemove,
  });

  return result.event;
}

export default Emitter;
