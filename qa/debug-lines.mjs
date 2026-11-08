import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 360, height: 640 } });
p.on('console', (m) => { if (m.type() !== 'debug') console.log('console', m.type(), m.text().slice(0, 400)); });
await p.goto('http://localhost:5173/preview.html?t=7.133&w=360&h=640');
await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const r = await p.evaluate(() => {
  const pl = window.__player, d = pl.lineTex.image.data, out = [];
  let vis = 0;
  for (let n = 0; n < pl.m.lines.count; n++) { const o = n * 16; if (d[o + 15] > d[o + 11]) vis++; if (n < 3 || n === 100) out.push(Array.from(d.slice(o, o + 16)).map((x) => +x.toFixed(4))); }
  const A = pl.data.anim.lines; const f = 214;
  return { vis, out, raw: [0, 1, 2].map((c) => A.get(f, 100, 12 + c)), visFlag: pl.data.anim.linesVisible.data[f * A.N + 100], res: pl.lineUniforms.resolution.value.toArray(), lineVisible: pl.lineMesh.visible };
});
console.log(JSON.stringify(r));
await b.close();
