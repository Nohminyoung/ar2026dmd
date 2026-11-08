// One elapsed-time source for every part of the artwork. Time only advances while running.
export class PlaybackClock {
  constructor(duration, { maxDelta = 0.1 } = {}) {
    this.duration = duration; this.maxDelta = maxDelta;
    this.elapsed = 0; this.running = false; this.last = null; this.ended = false;
  }
  start() { this.running = true; this.last = null; }
  pause() { this.running = false; this.last = null; }
  reset() { this.elapsed = 0; this.ended = false; this.last = null; }
  // call once per animation frame with performance.now(); returns true exactly once when the end is reached
  tick(nowMs) {
    if (!this.running || this.ended) { this.last = nowMs; return false; }
    if (this.last !== null) {
      const dt = Math.min(Math.max((nowMs - this.last) / 1000, 0), this.maxDelta);
      this.elapsed = Math.min(this.duration, this.elapsed + dt);
    }
    this.last = nowMs;
    if (this.elapsed >= this.duration) { this.ended = true; this.running = false; return true; }
    return false;
  }
}
