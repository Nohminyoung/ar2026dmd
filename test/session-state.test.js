import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionState, S } from '../src/session-state.js';

test('happy path and end -> replay keeps flow', () => {
  const s = new SessionState();
  for (const e of ['START', 'CAMERA_READY', 'TARGET_SEEN', 'LATCHED', 'END']) assert.ok(s.send(e), e);
  assert.equal(s.state, S.ENDED);
  assert.ok(s.send('REPLAY')); assert.equal(s.state, S.PLAYING);
});

test('double start is rejected; reset reachable from every camera state', () => {
  const s = new SessionState(); s.send('START');
  assert.equal(s.send('START'), false);
  s.send('CAMERA_READY');
  for (const path of [[], ['TARGET_SEEN'], ['TARGET_SEEN', 'LATCHED'], ['TARGET_SEEN', 'LATCHED', 'TRACKING_LIMITED'], ['TARGET_SEEN', 'LATCHED', 'END']]) {
    for (const e of path) s.send(e);
    assert.ok(s.isCamera()); assert.ok(s.send('RESET')); assert.equal(s.state, S.SCANNING);
  }
});

test('tracking pause and resume; marker loss before latch returns to scanning', () => {
  const s = new SessionState(); ['START', 'CAMERA_READY', 'TARGET_SEEN'].forEach((e) => s.send(e));
  assert.ok(s.send('TARGET_LOST')); assert.equal(s.state, S.SCANNING);
  ['TARGET_SEEN', 'LATCHED', 'TRACKING_LIMITED'].forEach((e) => s.send(e));
  assert.equal(s.state, S.TRACKING_PAUSED);
  assert.equal(s.send('END'), false);           // cannot end while paused
  assert.ok(s.send('TRACKING_NORMAL')); assert.equal(s.state, S.PLAYING);
  assert.equal(s.send('TARGET_LOST'), false);   // marker loss after latch changes nothing
});

test('two-part flow: hold after expanding, tap plays the return, then end', () => {
  const s = new SessionState(); ['START', 'CAMERA_READY', 'TARGET_SEEN', 'LATCHED'].forEach((e) => s.send(e));
  assert.ok(s.send('HOLD')); assert.equal(s.state, S.HOLDING); assert.ok(s.isCamera());
  assert.equal(s.send('END'), false); assert.equal(s.send('TRACKING_LIMITED'), false);
  assert.ok(s.send('TAP')); assert.equal(s.state, S.PLAYING);
  assert.ok(s.send('END')); assert.ok(s.send('REPLAY'));
  s.send('HOLD'); assert.ok(s.send('RESET')); assert.equal(s.state, S.SCANNING);
});
