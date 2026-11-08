import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto('http://localhost:5173/preview.html?t=7.133&w=360&h=640&poster=0');
await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
console.log(await p.evaluate(() => { const g = window.__player.lineMesh.geometry; return JSON.stringify({ t: Array.from(g.attributes.lineT.array.slice(0, 8)), s: Array.from(g.attributes.lineSide.array.slice(0, 4)), names: Object.keys(g.attributes), idx: Array.from(g.index.array.slice(0, 12)) }); }));
await b.close();
