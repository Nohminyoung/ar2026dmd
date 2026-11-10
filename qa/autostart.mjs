// Loader -> automatic camera start (fake camera, Android-like Chromium: no motion permission API).
import { createRequire } from 'module'; const { chromium, devices } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://localhost:4173';
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'accelerometer', 'gyroscope', 'magnetometer'] });
const p = await ctx.newPage();
await p.addInitScript(() => { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (c) => { const v = c && c.video; if (v && typeof v === 'object') { delete v.facingMode; delete v.deviceId; } return g(c); }; });
const log = []; p.on('pageerror', (e) => log.push('pageerror: ' + e)); p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(m.text().slice(0, 200)); });
const t0 = Date.now(); await p.goto(base + '/');
await p.waitForTimeout(2500); await p.screenshot({ path: 'qa/auto-1-loading.png' });
const seen = [];
while (Date.now() - t0 < 240000) {
  const st = await p.evaluate(() => [document.getElementById('app').dataset.state, document.documentElement.className, document.querySelector('[data-loading-percent]')?.textContent, document.getElementById('status').textContent, !document.getElementById('intro').hidden]);
  const k = JSON.stringify(st); if (seen.at(-1) !== k) { seen.push(k); console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', k); }
  if (st[0] === 'SCANNING' || st[0] === 'ERROR') break;
  await p.waitForTimeout(400);
}
await p.waitForTimeout(1500); await p.screenshot({ path: 'qa/auto-2-camera.png' });
console.log(log.slice(0, 10).join('\n')); await b.close();
