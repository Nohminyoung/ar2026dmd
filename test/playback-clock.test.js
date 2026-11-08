import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackClock } from '../src/playback-clock.js';

test('advances only while running, clamps big deltas, ends exactly once', () => {
  const c = new PlaybackClock(1.0, { maxDelta: 0.1 });
  c.tick(0); c.tick(500); assert.equal(c.elapsed, 0);         // not started
  c.start(); c.tick(1000); c.tick(1050); assert.ok(Math.abs(c.elapsed - 0.05) < 1e-9);
  c.pause(); c.tick(60000); c.start(); c.tick(61000); c.tick(61010); // no jump after pause
  assert.ok(Math.abs(c.elapsed - 0.06) < 1e-9);
  c.tick(70000); assert.ok(Math.abs(c.elapsed - 0.16) < 1e-9);    // huge delta clamped to 0.1
  let ends = 0; for (let t = 70000; t < 90000; t += 50) if (c.tick(t)) ends++;
  assert.equal(ends, 1); assert.equal(c.elapsed, 1.0);
  c.reset(); assert.equal(c.elapsed, 0); assert.equal(c.ended, false);
});
