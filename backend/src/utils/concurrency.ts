export type Releaser = () => void;

export class Semaphore {
  private available: number;
  private readonly waiters: Array<(release: Releaser) => void> = [];

  constructor(concurrency: number) {
    this.available = Math.max(1, Math.floor(concurrency));
  }

  async acquire(): Promise<Releaser> {
    if (this.available > 0) {
      this.available -= 1;
      return () => this.release();
    }
    return new Promise<Releaser>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next(() => this.release());
    } else {
      this.available += 1;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  reject!: (reason?: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

export class CancellationToken {
  private cancelledFlag = false;
  private listeners: Array<() => void> = [];

  get cancelled(): boolean {
    return this.cancelledFlag;
  }

  onCancel(listener: () => void): void {
    if (this.cancelledFlag) listener();
    else this.listeners.push(listener);
  }

  cancel(): void {
    if (this.cancelledFlag) return;
    this.cancelledFlag = true;
    for (const l of this.listeners.splice(0)) l();
  }

  throwIfCancelled(): void {
    if (this.cancelledFlag) throw new Error("Operation cancelled");
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
