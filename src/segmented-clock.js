// Content timeline made of segments, each with its own playback speed.
// A segment can end in a hold: time stops there until continue() (the visitor's tap).
// All times are content seconds of the exported animation (frame f -> (f - 1) / fps).
export class SegmentedClock {
  /**
   * @param {{fromFrame:number,toFrame:number,speed:number,holdAtEnd?:boolean}[]} segments
   * @param {number} fps
   * @param {number} duration  content duration (last sample held until here)
   */
  constructor(segments, fps, duration, { maxDelta = 0.1 } = {}) {
    if (!segments?.length) segments = [{ fromFrame: 1, toFrame: Math.round(duration * fps), speed: 1 }];
    this.segs = segments.map((s, i) => ({
      start: (s.fromFrame - 1) / fps,
      end: i === segments.length - 1 ? duration : (s.toFrame - 1) / fps,
      speed: s.speed > 0 ? s.speed : 1,
      hold: !!s.holdAtEnd,
    }));
    this.maxDelta = maxDelta;
    this.reset();
  }
  get segment() { return this.segs[this.index]; }
  start() { this.running = true; this.last = null; }
  pause() { this.running = false; this.last = null; }
  reset() { this.index = 0; this.elapsed = this.segs[0].start; this.holding = false; this.ended = false; this.running = false; this.last = null; }
  /** Leave a hold and play the next segment. Returns false if not holding. */
  continue() {
    if (!this.holding) return false;
    this.holding = false; this.index++; this.elapsed = this.segment.start; this.last = null;
    return true;
  }
  /** Advance by wall time. Returns 'hold' or 'end' exactly once when reached, otherwise null. */
  tick(nowMs) {
    if (!this.running || this.holding || this.ended) { this.last = nowMs; return null; }
    if (this.last !== null) {
      const dt = Math.min(Math.max((nowMs - this.last) / 1000, 0), this.maxDelta);
      this.elapsed = Math.min(this.segment.end, this.elapsed + dt * this.segment.speed);
    }
    this.last = nowMs;
    if (this.elapsed >= this.segment.end - 1e-9) {
      if (this.index === this.segs.length - 1) { this.ended = true; this.running = false; return 'end'; }
      if (this.segment.hold) { this.holding = true; return 'hold'; }
      this.index++; this.elapsed = this.segment.start;                 // seamless switch
    }
    return null;
  }
}
