import test from 'node:test';
import assert from 'node:assert/strict';
import { AnchorPolicy } from '../src/anchor-policy.js';

const det = (o = {}) => ({ name: 'poster-target', position: { x: 0, y: 0, z: -1, ...o.p }, rotation: { x: 0, y: 0, z: 0, w: 1, ...o.q }, scale: 1, scaledWidth: 0.75, ...o.d });

test('does not latch while world tracking is not NORMAL or INITIALIZING', () => {
  const a = new AnchorPolicy('poster-target');
  for (let t = 0; t <= 1000; t += 100) assert.equal(a.observe(det(), t).state, 'waiting-tracking');
  a.setTracking('NORMAL', 'INITIALIZING');
  for (let t = 1100; t <= 2000; t += 100) assert.notEqual(a.observe(det(), t).state, 'latched');
});

test('latches exactly once after a stable window, then ignores image events', () => {
  const a = new AnchorPolicy('poster-target'); a.setTracking('NORMAL', 'UNSPECIFIED');
  const states = []; for (let t = 0; t <= 1000; t += 100) states.push(a.observe(det(), t).state);
  assert.equal(states.filter((s) => s === 'latched').length, 1);
  assert.equal(states.indexOf('latched'), 7); // 0..700 ms -> 8 samples, span 700 >= 650
  const pose = a.pose;
  assert.equal(a.observe(det({ p: { x: 5 } }), 1200).state, 'ignored');
  a.lost('poster-target');
  assert.deepEqual(a.pose, pose); assert.equal(a.latched, true);
  assert.equal(pose.width, 0.75);
});

test('unstable or gappy observations restart the window; wrong target ignored', () => {
  const a = new AnchorPolicy('poster-target'); a.setTracking('NORMAL', 'UNSPECIFIED');
  let t = 0;
  for (; t < 600; t += 100) a.observe(det({ p: { x: (t / 100) * 0.05 } }), t); // moves 5 cm per sample > 3% of 0.75 width
  assert.equal(a.latched, false);
  assert.equal(a.observe(det(), 2000).state, 'stabilizing');      // gap > 250 ms resets
  assert.equal(a.observe({ ...det(), name: 'other' }, 2100).state, 'ignored');
  assert.equal(a.observe({ ...det(), scale: NaN }, 2100).state, 'ignored');
});

test('lost before latch discards samples; unlatch keeps tracking state', () => {
  const a = new AnchorPolicy('poster-target'); a.setTracking('NORMAL', 'UNSPECIFIED');
  for (let t = 0; t <= 500; t += 100) a.observe(det(), t);
  a.lost('poster-target'); assert.equal(a.samples.length, 0);
  for (let t = 600; t <= 1300; t += 100) a.observe(det(), t);
  assert.equal(a.latched, true);
  a.unlatch(); assert.equal(a.latched, false); assert.equal(a.trackingReady(), true);
});
