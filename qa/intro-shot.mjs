import { createRequire } from 'module'; const { chromium, devices } = createRequire(import.meta.url)('playwright');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [name, dev] of [['iphone14', devices['iPhone 14']], ['galaxyS9', devices['Galaxy S9+']], ['iphoneSE', devices['iPhone SE']]]) {
  const ctx = await b.newContext({ ...dev }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://localhost:4173/'); await p.waitForTimeout(2500);
  await p.evaluate(() => document.fonts.ready);
  const font = await p.evaluate(() => getComputedStyle(document.querySelector('.title')).fontFamily + ' | loaded:' + [...document.fonts].filter((f) => f.status === 'loaded').length);
  await p.screenshot({ path: `qa/intro-${name}.png` });
  console.log(name, dev.viewport.width + 'x' + dev.viewport.height, font, errs.join(';'));
  await ctx.close();
}
await b.close();
