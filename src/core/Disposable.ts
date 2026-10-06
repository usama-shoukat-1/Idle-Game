/**
 * A collection of teardown callbacks with idempotent disposal.
 *
 * Every long-lived foundation system is built on timers, event subscriptions and
 * DOM listeners. Those must be released when a scene shuts down or the game is
 * destroyed, otherwise Phaser scenes leak across restarts. Systems register their
 * teardown here and a single `dispose()` guarantees it runs exactly once.
 */
export class DisposableBag {
  private readonly callbacks: Array<() => void> = [];
  private disposed = false;

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Register a teardown callback. Returns the callback for convenience. */
  add(callback: () => void): () => void {
    if (this.disposed) {
      callback();
      return callback;
    }
    this.callbacks.push(callback);
    return callback;
  }

  /**
   * Register a teardown callback, but only while this bag is alive.
   * Handy pattern: `bag.add(child.dispose)`.
   */
  addDisposable(disposable: { dispose: () => void }): void {
    this.add(() => disposable.dispose());
  }

  /** Run every teardown callback in reverse registration order. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (let i = this.callbacks.length - 1; i >= 0; i -= 1) {
      const callback = this.callbacks[i];
      if (!callback) continue;
      try {
        callback();
      } catch (error) {
        // Never let one failing teardown block the rest of the chain.
        console.error('[DisposableBag] teardown callback failed', error);
      }
    }
    this.callbacks.length = 0;
  }
}
