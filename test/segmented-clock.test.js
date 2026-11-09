import test from 'node:test';
import assert from 'node:assert/strict';
import { SegmentedClock } from '../src/segmented-clock.js';

const SEGS = [{ fromFrame: 1, toFrame: 301, speed: 1.5, holdAtEnd: true }, { fromFrame: 301, toFrame: 390, speed: 0.7 }];
const run = (c, from, ms, step = 50) => { let ev = null; for (let t = from; t <= from + ms; t += step) { const e = c.tick(t); if (e) ev = e; } return ev; };

test('fast first part stops at the hold and waits for a tap', () => {
  const c = new SegmentedClock(SEGS, 30, 13); c.start();
  // part 1 is 10 s of content at 1.5x -> about 6.67 s of wall time
  assert.equal(run(c, 0, 6500), null);
  assert.equal(run(c, 6550, 400), 'hold');
  assert.equal(c.elapsed, 10); assert.equal(c.holding, true);
  assert.equal(run(c, 7000, 20000), null);             // nothing moves while holding
  assert.equal(c.elapsed, 10);
});

test('tap plays the slow second part to the end exactly once', () => {
  const c = new SegmentedClock(SEGS, 30, 13); c.start();
  run(c, 0, 7000);
  assert.ok(c.continue()); assert.equal(c.continue(), false);
  // part 2 is 3 s of content at 0.7x -> about 4.29 s
  assert.equal(run(c, 10000, 4200), null);
  assert.equal(run(c, 14250, 200), 'end');
  assert.equal(c.elapsed, 13); assert.equal(run(c, 15000, 3000), null);
  c.reset(); assert.equal(c.elapsed, 0); assert.equal(c.index, 0); assert.equal(c.ended, false);
});

test('pause gives no time jump; single segment fallback behaves like a plain clock', () => {
  const c = new SegmentedClock(SEGS, 30, 13); c.start(); c.tick(0); c.tick(100);
  const e = c.elapsed; c.pause(); c.tick(60000); c.start(); c.tick(61000); c.tick(61100);
  assert.ok(Math.abs(c.elapsed - (e + 0.1 * 1.5)) < 1e-9);
  const p = new SegmentedClock(null, 30, 1); p.start();
  assert.equal(run(p, 0, 1100), 'end'); assert.equal(p.elapsed, 1);
});
