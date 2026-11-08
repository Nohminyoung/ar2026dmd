// Synthetic smoke test: phone-sized Chromium, fake camera showing the poster. NOT a substitute for real devices.
import { createRequire } from 'module'; const { chromium, devices } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://localhost:4173';
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=/tmp/claude-0/s/fakecam.y4m', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'accelerometer', 'gyroscope', 'magnetometer'] });
const p = await ctx.newPage();
// test only: the fake capture device has no facing mode, so drop 'exact' facing constraints
await p.addInitScript(() => { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (c) => { const v = c && c.video; if (v && typeof v === 'object') { delete v.facingMode; delete v.deviceId; } return g(c); }; });
const log = []; p.on('console', (m) => log.push(`${m.type()}: ${m.text().slice(0, 300)}`)); p.on('pageerror', (e) => log.push('pageerror: ' + e));
const failed = []; p.on('requestfailed', (r) => failed.push(r.url())); p.on('response', (r) => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });
await p.goto(base + '/?qa=1');
await p.waitForTimeout(1500); await p.screenshot({ path: 'qa/smoke-1-intro.png' });
await p.waitForFunction(() => document.getElementById('load-text').textContent.startsWith('준비'), null, { timeout: 180000 }).catch(() => log.push('assets not ready in time'));
await p.screenshot({ path: 'qa/smoke-2-ready.png' });
console.log('load text:', await p.textContent('#load-text'));
await p.click('#start');
const seen = new Set(); const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  const st = await p.evaluate(() => [document.getElementById('app').dataset.state, document.getElementById('status').textContent, document.getElementById('error-text').textContent]);
  const key = st.join(' | '); if (!seen.has(key)) { seen.add(key); console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', key); }
  if (st[0] === 'ERROR' || st[0] === 'PLAYING') break;
  if (Date.now() - t0 > 25000 && await p.evaluate(() => !!window.__qa?.lastImage)) break;
  await p.waitForTimeout(500);
}
await p.screenshot({ path: 'qa/smoke-3-camera.png', timeout: 180000 }).catch((e) => console.log('screenshot skipped', String(e).slice(0, 80)));
console.log('failed requests:', failed.slice(0, 10));
console.log('qa:', JSON.stringify(await p.evaluate(() => ({ last: window.__qa?.lastImage, tracking: window.__qa?.tracking?.slice(-5) }))).slice(0, 900));
console.log(log.filter((l) => !l.startsWith('debug')).slice(0, 25).join('\n'));
await b.close();
