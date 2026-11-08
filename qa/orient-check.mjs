// QA: draw candidate poster outlines on the live marker pose to see which content orientation overlays the print.
import { createRequire } from 'module'; const { chromium, devices } = createRequire(import.meta.url)('playwright');
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=/tmp/claude-0/s/fakecam.y4m', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['camera', 'accelerometer', 'gyroscope', 'magnetometer'] });
const p = await ctx.newPage();
await p.addInitScript(() => { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (c) => { const v = c && c.video; if (v && typeof v === 'object') { delete v.facingMode; delete v.deviceId; } return g(c); }; });
await p.goto('http://localhost:4173/?qa=1');
await p.waitForFunction(() => document.getElementById('load-text').textContent.startsWith('준비'), null, { timeout: 180000 });

await p.click('#start');
await p.waitForFunction(() => !!window.__qa.lastImage, null, { timeout: 60000 });
const info = await p.evaluate(() => {
  const T = window.THREE, rt = window.__qa.runtime;
  const mk = (color, rot) => {
    const g = new T.BufferGeometry().setFromPoints([[-0.5, -0.75], [0.5, -0.75], [0.5, 0.75], [-0.5, 0.75]].map(([x, y]) => new T.Vector3(x, y, 0)));
    const loop = new T.LineLoop(g, new T.LineBasicMaterial({ color, depthTest: false }));
    const up = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(0, 0, 0), new T.Vector3(0, 0.75, 0)]), new T.LineBasicMaterial({ color, depthTest: false }));
    const grp = new T.Group(); grp.add(loop, up); grp.rotation.set(...rot); grp.renderOrder = 10; return grp;
  };
  // A: content as-is (poster in local XY).  B: rotate -90 about X (poster in local XZ, top toward -Z)
  rt.contentAlignment.add(mk(0xff2050, [0, 0, 0]));
  return { cam: rt.camera.position.toArray().concat(rt.camera.quaternion.toArray()), img: window.__qa.lastImage.d, anchor: rt.worldAnchor.position.toArray().concat(rt.worldAnchor.scale.x) };
});
console.log(JSON.stringify(info));
await p.waitForTimeout(3000);
await p.screenshot({ path: 'qa/orient-check-artwork.png', timeout: 120000 });
await b.close();
