// QA: start/close AR several times and check the canvas never grows (camera zoom bug).
import { createRequire } from 'module'; const { chromium, devices } = createRequire(import.meta.url)('playwright');
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=/tmp/claude-0/s/fakecam.y4m', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'accelerometer', 'gyroscope', 'magnetometer'] });
const p = await ctx.newPage();
await p.addInitScript(() => { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (c) => { const v = c && c.video; if (v && typeof v === 'object') { delete v.facingMode; delete v.deviceId; } return g(c); }; });
await p.goto('http://localhost:4173/');
await p.waitForFunction(() => document.getElementById('load-text').textContent.startsWith('준비'), null, { timeout: 180000 });
const size = () => p.evaluate(() => { const c = document.getElementById('camerafeed'), r = c.getBoundingClientRect(); return `${c.width}x${c.height} px, shown ${Math.round(r.width)}x${Math.round(r.height)}, style ${c.style.width}/${c.style.height}`; });
for (let i = 1; i <= 4; i++) {
  await p.click('#start');
  await p.waitForFunction(() => ['SCANNING', 'STABILIZING', 'ERROR'].includes(document.getElementById('app').dataset.state), null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  console.log(`run ${i}: ${await p.evaluate(() => document.getElementById('app').dataset.state)} canvas ${await size()}`);
  await p.click('#close'); await p.waitForTimeout(800);
}
await b.close();
