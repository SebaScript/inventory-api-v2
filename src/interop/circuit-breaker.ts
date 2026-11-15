export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Stops calling a dependency that keeps failing. Closed: every call goes out.
 * After `threshold` failures in a row it opens: no call goes out for `openMs`,
 * and the caller degrades at once instead of waiting out a timeout each time.
 * Then it lets one trial call through (half-open): a success closes it, a
 * failure opens it again. One per replica, in memory.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt?: number;
  private trialOut = false;

  constructor(
    private readonly threshold: number,
    private readonly openMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): CircuitState {
    if (this.openedAt === undefined) return 'closed';
    return this.now() - this.openedAt < this.openMs ? 'open' : 'half-open';
  }

  /** Whether a call may go out now. Half-open lets exactly one through. */
  allow(): boolean {
    const state = this.state;
    if (state === 'closed') return true;
    if (state === 'open' || this.trialOut) return false;
    this.trialOut = true;
    return true;
  }

  succeeded(): void {
    this.failures = 0;
    this.openedAt = undefined;
    this.trialOut = false;
  }

  /** True when this failure is the one that opened the circuit. */
  failed(): boolean {
    const wasClosed = this.openedAt === undefined;
    this.failures += 1;
    this.trialOut = false;
    if (!wasClosed || this.failures >= this.threshold) {
      this.openedAt = this.now();
      return wasClosed;
    }
    return false;
  }
}
