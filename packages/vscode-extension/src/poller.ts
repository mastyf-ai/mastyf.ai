/** Runs the poll on an interval only while the window has focus; a settings change never starts it in the background. */

export interface Timers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

const realTimers: Timers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

export class Poller {
  private timer: unknown = undefined;
  private focused = false;
  private disposed = false;

  constructor(
    private readonly poll: () => unknown,
    private readonly intervalSeconds: () => number,
    private readonly timers: Timers = realTimers,
  ) {}

  setFocused(focused: boolean): void {
    this.focused = focused;
    if (focused) this.start();
    else this.stop();
  }

  /** The interval may have changed: restart, but only in a focused window. */
  settingsChanged(): void {
    if (this.focused) this.start();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  private start(): void {
    this.stop();
    if (this.disposed) return;
    void this.poll();
    this.timer = this.timers.setInterval(() => void this.poll(), this.intervalSeconds() * 1000);
  }

  private stop(): void {
    if (this.timer !== undefined) this.timers.clearInterval(this.timer);
    this.timer = undefined;
  }
}
