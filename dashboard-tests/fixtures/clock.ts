import { expect, type Page } from '@playwright/test';

/** "Now" in every test: Wednesday 7 October 2026, 10:00 in Taipei. The fixture runs happened before it. */
export const FIXED_NOW = new Date('2026-10-07T02:00:00.000Z');

/** The console polls a followed run every 5 s when it has a token (console.js). */
export const POLL_INTERVAL_MS = 5_000;

/** Timeout of the checks made between two clock steps (see FakeClock.advanceUntil). */
export const BETWEEN_TICKS = { timeout: 500 };

/**
 * The page's clock (Date, setTimeout, setInterval, ...), paused at FIXED_NOW.
 *
 * Time only moves when a test advances it: the console's polling (every few
 * seconds while a run is followed) runs instantly and in a known order, and
 * texts that depend on "now" (token expiry, elapsed time) are deterministic.
 */
export class FakeClock {
  private elapsedMs = 0;

  constructor(private readonly page: Page) {}

  async install(): Promise<void> {
    // pauseAt() only moves forward: start a minute early, then stop exactly at FIXED_NOW.
    await this.page.clock.install({ time: FIXED_NOW.getTime() - 60_000 });
    await this.page.clock.pauseAt(FIXED_NOW);
  }

  /** The page's current time (the same in every page of the test, also after a reload). */
  now(): Date {
    return new Date(FIXED_NOW.getTime() + this.elapsedMs);
  }

  /** Moves time forward and fires the timers that become due. */
  async advance(ms: number): Promise<void> {
    await this.page.clock.runFor(ms);
    this.elapsedMs += ms;
  }

  /**
   * Advances time in steps until `assertion` passes. Between two steps the page
   * gets real time to finish its requests and re-render, so this also works
   * when the timer to fire is only scheduled once a response arrives (dispatch,
   * cancel, retries). The assertion should use a short timeout (BETWEEN_TICKS).
   *
   * Use it while the mocked server state stays the same: an extra step then
   * only repeats a poll that returns the same answer.
   */
  async advanceUntil(assertion: () => Promise<unknown>, { step = 1_000, timeout = 20_000 } = {}): Promise<void> {
    await expect(async () => {
      await this.advance(step);
      await assertion();
    }).toPass({ timeout, intervals: [0] });
  }
}
