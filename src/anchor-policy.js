// Decides once, from stable image-target observations while world tracking is NORMAL,
// where the artwork is anchored. After latching, image events never move or restart anything.

const deg = (q1, q2) => {
  const d = Math.abs(q1.x * q2.x + q1.y * q2.y + q1.z * q2.z + q1.w * q2.w);
  return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
};
const finite = (...v) => v.every((x) => typeof x === 'number' && Number.isFinite(x));

export function validPose(d, targetName) {
  if (!d || d.name !== targetName) return false;
  const p = d.position, r = d.rotation;
  return !!p && !!r && finite(p.x, p.y, p.z, r.x, r.y, r.z, r.w, d.scale, d.scaledWidth) && d.scale > 0 && d.scaledWidth > 0;
}

export class AnchorPolicy {
  constructor(targetName, opts = {}) {
    this.targetName = targetName;
    this.o = {
      stableWindowMs: 650, minSamples: 3, maxSampleGapMs: 250,
      maxWidthChange: 0.05, maxPositionChangeOfWidth: 0.03, maxRotationChangeDeg: 10, ...opts,
    };
    this.reset();
  }

  reset() { this.unlatch(); this.tracking = { status: null, reason: null }; }
  // forget the placement but keep the current world-tracking state (used by "위치 다시 맞추기")
  unlatch() { this.samples = []; this.latched = false; this.pose = null; }

  setTracking(status, reason) { this.tracking = { status, reason }; }
  trackingReady() { return this.tracking.status === 'NORMAL' && this.tracking.reason !== 'INITIALIZING'; }

  lost(name) { if (!this.latched && (!name || name === this.targetName)) this.samples = []; }

  /** Feed an imagefound / imageupdated detail. Returns
   *  {state:'ignored'|'waiting-tracking'|'stabilizing'|'latched', pose?} ; 'latched' is returned exactly once. */
  observe(d, nowMs) {
    if (this.latched) return { state: 'ignored' };
    if (!validPose(d, this.targetName)) return { state: 'ignored' };
    const s = {
      t: nowMs,
      p: { x: d.position.x, y: d.position.y, z: d.position.z },
      q: { x: d.rotation.x, y: d.rotation.y, z: d.rotation.z, w: d.rotation.w },
      width: d.scale * d.scaledWidth,
    };
    const last = this.samples[this.samples.length - 1];
    if (last && s.t - last.t > this.o.maxSampleGapMs) this.samples = [];
    this.samples.push(s);
    if (!this.trackingReady()) { this.samples = [s]; return { state: 'waiting-tracking' }; }
    // keep the samples that are consistent with the newest one; drop older inconsistent ones
    const ref = s;
    const ok = (x) => Math.abs(x.width - ref.width) <= this.o.maxWidthChange * ref.width
      && Math.hypot(x.p.x - ref.p.x, x.p.y - ref.p.y, x.p.z - ref.p.z) <= this.o.maxPositionChangeOfWidth * ref.width
      && deg(x.q, ref.q) <= this.o.maxRotationChangeDeg;
    let i = this.samples.length - 1;
    while (i > 0 && ok(this.samples[i - 1])) i--;
    this.samples = this.samples.slice(i);
    const span = s.t - this.samples[0].t;
    if (this.samples.length >= this.o.minSamples && span >= this.o.stableWindowMs) {
      this.latched = true;
      this.pose = { position: s.p, quaternion: s.q, width: s.width, at: nowMs };
      return { state: 'latched', pose: this.pose };
    }
    return { state: 'stabilizing', progress: Math.min(1, span / this.o.stableWindowMs) };
  }
}
