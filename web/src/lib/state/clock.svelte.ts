/**
 * Simulation clock. In `live` mode it tracks the wall clock; otherwise it advances at
 * `rate` × real time (0 = paused). The globe calls `tick()` once per frame and everything
 * — Earth rotation, sun position, later the satellites — is derived from `simTime`.
 */

export const RATES = [1, 10, 60, 600, 3600] as const;

class SimClock {
  live = $state(true);
  rate = $state(1);
  simTime = $state(Date.now());

  #lastReal = performance.now();

  /** Advance by real elapsed time and return the current simulation time (Unix ms). */
  tick(realNow = performance.now()): number {
    const dt = realNow - this.#lastReal;
    this.#lastReal = realNow;
    if (this.live) {
      this.simTime = Date.now();
    } else if (this.rate !== 0) {
      this.simTime += dt * this.rate;
    }
    return this.simTime;
  }

  get paused(): boolean {
    return !this.live && this.rate === 0;
  }

  goLive(): void {
    this.live = true;
    this.rate = 1;
  }

  pause(): void {
    this.live = false;
    this.rate = 0;
  }

  play(rate: number = 1): void {
    this.live = false;
    this.rate = rate;
  }

  togglePause(): void {
    if (this.paused) this.play(1);
    else this.pause();
  }

  /** Jump to a moment; leaves live mode and holds there until played. */
  setTime(ms: number): void {
    if (!Number.isFinite(ms)) return;
    this.live = false;
    this.rate = 0;
    this.simTime = ms;
  }
}

export const clock = new SimClock();
