// 전시 모드 (?kiosk=1): play -> hold (nobody taps) -> returns by itself -> end -> back to the poster search -> plays again.
import { createRequire } from 'module'; const { chromium, devices } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://localhost:4173';
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=/tmp/claude-0/s/fakecam.y4m', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'accelerometer', 'gyroscope', 'magnetometer'] });
const p = await ctx.newPage();
await p.addInitScript(() => { for (const C of [window.DeviceMotionEvent, window.DeviceOrientationEvent]) C.requestPermission = () => (performance.now() - (window.__g ?? -1e9) < 1000) ? Promise.resolve('granted') : Promise.reject(new Error('NotAllowedError: requires a user gesture'));
  for (const t of ['touchend', 'click']) window.addEventListener(t, () => { window.__g = performance.now(); }, true); });
await p.addInitScript(() => { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (c) => { const v = c && c.video; if (v && typeof v === 'object') { delete v.facingMode; delete v.deviceId; } return g(c); }; });
const log = []; p.on('pageerror', (e) => log.push('pageerror: ' + e)); p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(m.text().slice(0, 200)); });
// slow software GPU: image events arrive far apart, so loosen only the sampling gap for this test
await p.route('**/config.json', async (r) => { const res = await r.fetch(); const c = await res.json(); c.anchor.maxSampleGapMs = 3000; c.anchor.minViewDistanceInPosterWidths = 0; c.kiosk.holdTimeoutMs = 3000; c.kiosk.restartAfterMs = 2000; c.playback.segments[0].speed = 6; c.playback.segments[1].speed = 3; r.fulfill({ response: res, json: c }); });
const t0 = Date.now(); await p.goto(base + '/?kiosk=1');
await p.waitForTimeout(2500); await p.screenshot({ path: 'qa/auto-1-loading.png' });
const seen = [];
while (Date.now() - t0 < 330000) {
  const st = await p.evaluate(() => [document.documentElement.classList.contains('kiosk') && getComputedStyle(document.getElementById('close')).visibility, !document.getElementById('end').hidden, document.getElementById('app').dataset.state, document.documentElement.className, document.querySelector('[data-loading-percent]')?.textContent, document.getElementById('status').textContent, !document.getElementById('intro').hidden]);
  const k = JSON.stringify(st); if (seen.at(-1) !== k) { seen.push(k); console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', k); }
  if (false) { globalThis.tapped = 1; await p.waitForTimeout(1800); await p.screenshot({ path: 'qa/auto-ios-panel.png' }); await p.mouse.click(200, 300); }
  if (st[2] === 'ERROR') break;
  if (st[2] === 'PLAYING' && seen.filter((x) => x.includes('"ENDED"')).length) break;
  await p.waitForTimeout(400);
}
await p.waitForTimeout(1500); await p.screenshot({ path: 'qa/kiosk.png', timeout: 120000 }).catch(() => {});
console.log(log.slice(0, 10).join('\n')); await b.close();
