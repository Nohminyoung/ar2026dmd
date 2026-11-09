// Pure state machine for the visitor flow (no DOM, no engine) so it can be unit-tested.
//  IDLE -> STARTING -> SCANNING -> STABILIZING -> PLAYING -> ENDED
//  PLAYING -> HOLDING (expanded, waits for a tap) -> PLAYING (return part)
//  PLAYING <-> TRACKING_PAUSED ; marker lost before latch -> SCANNING
//  RESET from any camera state -> SCANNING ; REPLAY from ENDED -> PLAYING (same anchor) ; CLOSE -> IDLE
export const S = Object.freeze({
  IDLE: 'IDLE', STARTING: 'STARTING', SCANNING: 'SCANNING', STABILIZING: 'STABILIZING',
  PLAYING: 'PLAYING', HOLDING: 'HOLDING', TRACKING_PAUSED: 'TRACKING_PAUSED', ENDED: 'ENDED', ERROR: 'ERROR',
});
const CAMERA = new Set([S.SCANNING, S.STABILIZING, S.PLAYING, S.HOLDING, S.TRACKING_PAUSED, S.ENDED]);

const T = {
  [S.IDLE]: { START: S.STARTING },
  [S.STARTING]: { CAMERA_READY: S.SCANNING, FAIL: S.ERROR, CLOSE: S.IDLE },
  [S.SCANNING]: { TARGET_SEEN: S.STABILIZING, RESET: S.SCANNING, CLOSE: S.IDLE, FAIL: S.ERROR },
  [S.STABILIZING]: { LATCHED: S.PLAYING, TARGET_LOST: S.SCANNING, RESET: S.SCANNING, CLOSE: S.IDLE, FAIL: S.ERROR },
  [S.PLAYING]: { TRACKING_LIMITED: S.TRACKING_PAUSED, HOLD: S.HOLDING, END: S.ENDED, RESET: S.SCANNING, CLOSE: S.IDLE, FAIL: S.ERROR },
  [S.HOLDING]: { TAP: S.PLAYING, RESET: S.SCANNING, CLOSE: S.IDLE, FAIL: S.ERROR },
  [S.TRACKING_PAUSED]: { TRACKING_NORMAL: S.PLAYING, RESET: S.SCANNING, CLOSE: S.IDLE, FAIL: S.ERROR },
  [S.ENDED]: { REPLAY: S.PLAYING, RESET: S.SCANNING, CLOSE: S.IDLE, FAIL: S.ERROR },
  [S.ERROR]: { START: S.STARTING, CLOSE: S.IDLE },
};

export class SessionState {
  constructor(onChange) { this.state = S.IDLE; this.onChange = onChange; }
  isCamera() { return CAMERA.has(this.state); }
  can(ev) { return !!T[this.state]?.[ev]; }
  send(ev, info) {
    const next = T[this.state]?.[ev];
    if (!next) return false;
    const prev = this.state; this.state = next;
    if (this.onChange) this.onChange(next, prev, ev, info);
    return true;
  }
}
