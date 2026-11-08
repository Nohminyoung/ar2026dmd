import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
const mode = process.argv[2];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 360, height: 640 } });
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.text().slice(0, 300)); });
await p.goto('http://localhost:5173/preview.html?t=7.133&w=360&h=640&poster=0');
await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await p.evaluate((mode) => {
  const pl = window.__player; pl.bodyGroup.visible = false; const mat = pl.lineMesh.material;
  if (mode === 'attr') mat.vertexShader = mat.vertexShader.replace('gl_Position = clip;', 'gl_Position = vec4(lineT*1.8-0.9, lineSide*0.004 + lineId/200.0 - 0.5, 0.0, 1.0); vAlpha = 1.0; vColor = vec3(1.0);');
  if (mode === 'pos') mat.vertexShader = mat.vertexShader.replace('gl_Position = clip;', 'gl_Position = vec4(p.xy*0.8 + vec2(lineSide*0.004, 0.0), 0.0, 1.0); vAlpha = 1.0; vColor = vec3(1.0);');
  mat.needsUpdate = true; window.__render();
}, mode);
await p.screenshot({ path: `qa/compare/debug_${mode}.png` });
await b.close();
