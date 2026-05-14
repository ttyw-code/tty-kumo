export function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function timeoutWithValue<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export function timeoutWithError(ms: number, error: Error): Promise<void> {
  return new Promise((_, reject) => setTimeout(() => reject(error), ms));
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  delay: number,
): T {
  let lastCall = 0;
  return function (...args: Parameters<T>) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      return func(...args);
    }
  } as T;
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number,
): T {
  let timeoutId: NodeJS.Timeout | null = null;
  return function (...args: Parameters<T>) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func(...args);
    }, delay);
  } as T;
}

export function createCancelablePromise<T>(
  factory: (token: {
    isCancellationRequested: boolean;
    onCancellationRequested: (cb: () => void) => { dispose: () => void };
  }) => Promise<T>,
) {
  let cancelled = false;
  const listeners: (() => void)[] = [];
  const token = {
    get isCancellationRequested() {
      return cancelled;
    },
    onCancellationRequested(cb: () => void) {
      listeners.push(cb);
      return {
        dispose: () => {
          const i = listeners.indexOf(cb);
          if (i >= 0) listeners.splice(i, 1);
        },
      };
    },
  };

  const p = factory(token).finally(() => {
    /* noop */
  });
  return Object.assign(p, {
    cancel() {
      if (!cancelled) {
        cancelled = true;
        listeners.slice().forEach((l) => l());
      }
    },
  });
}

export function simpleCancelablePromise<T>(
  promise: Promise<T>,
): Promise<T> & { cancel(): void } {
  let cancel: () => void;
  const wrappedPromise = new Promise<T>((resolve, reject) => {
    cancel = () => reject(new Error('Promise was cancelled'));
    promise.then(resolve, reject);
  }) as Promise<T> & { cancel(): void };

  wrappedPromise.cancel = cancel!;
  return wrappedPromise;
}

export async function sampleExampleUsage(): Promise<void> {
  const job = createCancelablePromise<number>(async (token) => {
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => resolve(42), 1000);
      token.onCancellationRequested(() => {
        clearTimeout(timer);
        reject(new Error('Cancelled by token'));
      });
    });
  });

  setTimeout(() => {
    job.cancel();
  }, 200);

  try {
    const value = await job;
    console.log('Promise resolved:', value);
  } catch (error) {
    console.log('Promise cancelled:', (error as Error).message);
  }
}
