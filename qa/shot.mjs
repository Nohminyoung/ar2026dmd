import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
const [base, out, ...times] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 360, height: 640 } });
const logs = []; p.on('console', (m) => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', (e) => logs.push('pageerror: ' + e));
for (const t of times) {
  const t0 = Date.now();
  await p.goto(`${base}/preview.html?t=${t}&w=360&h=640`);
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 300000 }).catch((e) => logs.push('timeout ' + e));
  await p.screenshot({ path: `${out}/web_${t}.png` });
  console.log('shot', t, Date.now() - t0, 'ms');
}
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 20).join('\n'));
await b.close();
