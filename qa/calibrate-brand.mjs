// Match logo/subtitle proportions to the design PDF by measuring rendered ink.
import { createRequire } from 'module'; const { chromium, devices } = createRequire(import.meta.url)('playwright');
import fs from 'fs';
const require = createRequire(import.meta.url); const { PNG } = require('pngjs');
const T = { w: 2502 / 2705, gap: 84 / 2705, h: 201 / 2705, cx: (390 + 2891) / 2 / 2705 - (276 + 2980) / 2 / 2705 + 0 };
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'], deviceScaleFactor: 4 }); const p = await ctx.newPage();
await p.goto('http://localhost:4173/'); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1500);
const measure = async () => {
  const buf = await (await p.$('.brand')).screenshot(); const img = PNG.sync.read(buf); const { width: W, height: H, data } = img;
  const rowInk = (y, x) => { const i = (y * W + x) * 4; return Math.max(data[i], data[i + 1], data[i + 2]) > 110; };
  const rows = []; for (let y = 0; y < H; y++) { let any = false; for (let x = 0; x < W; x++) if (rowInk(y, x)) { any = true; break; } rows.push(any); }
  const bands = []; let s = -1, gapRun = 0;
  for (let y = 0; y < H; y++) { if (rows[y]) { if (s < 0) s = y; gapRun = 0; } else if (s >= 0) { gapRun++; if (gapRun > 6) { bands.push([s, y - gapRun]); s = -1; } } }
  if (s >= 0) bands.push([s, H - 1]);
  const box = ([y0, y1]) => { let x0 = W, x1 = 0; for (let y = y0; y <= y1; y++) for (let x = 0; x < W; x++) if (rowInk(y, x)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); } return { y0, y1, x0, x1 }; };
  const L = box(bands[0]), S = box(bands[bands.length - 1]); const lw = L.x1 - L.x0 + 1;
  return { w: (S.x1 - S.x0 + 1) / lw, gap: (S.y0 - L.y1 - 1) / lw, h: (S.y1 - S.y0 + 1) / lw, cx: ((S.x0 + S.x1) / 2 - (L.x0 + L.x1) / 2) / lw, bands: bands.length };
};
let size = 8.7, gap = 1.5;
for (let it = 0; it < 6; it++) {
  await p.evaluate(([s, g]) => { const e = document.querySelector('.brand'); e.style.setProperty('--sub-size', s + 'cqw'); e.style.setProperty('--sub-gap', g + 'cqw'); }, [size, gap]);
  await p.waitForTimeout(150);
  const m = await measure();
  console.log(`it${it} size ${size.toFixed(3)} gap ${gap.toFixed(3)} -> w ${m.w.toFixed(4)} (t ${T.w.toFixed(4)}) gap ${m.gap.toFixed(4)} (t ${T.gap.toFixed(4)}) h ${m.h.toFixed(4)} (t ${T.h.toFixed(4)}) cx ${m.cx.toFixed(4)} bands ${m.bands}`);
  size *= T.w / m.w; gap += (T.gap - m.gap) * 100;
}
fs.writeFileSync('qa/brand-calibration.json', JSON.stringify({ size: +size.toFixed(3), gap: +gap.toFixed(3), target: T }, null, 1));
await b.close();
