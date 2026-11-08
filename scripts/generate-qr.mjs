// Make the visitor QR (PNG + SVG) for a confirmed production URL and verify it decodes back to the same URL.
// node scripts/generate-qr.mjs https://ar.dmd2026.com/ [--draft]
import fs from 'node:fs';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const url = process.argv[2]; const draft = process.argv.includes('--draft');
if (!url || !/^https:\/\/[^/]+\.[^/]+/.test(url)) { console.error('usage: generate-qr.mjs https://<production-domain>/ [--draft]'); process.exit(1); }
if (/localhost|127\.0\.0\.1|192\.168\.|\.vercel\.app\/?$/.test(url) && !draft) console.warn('warning: this does not look like the final production domain');
const out = draft ? 'qa/qr-draft' : 'delivery'; fs.mkdirSync(out, { recursive: true });
const opts = { errorCorrectionLevel: 'M', margin: 4, color: { dark: '#000000', light: '#ffffff' } };
const png = await QRCode.toBuffer(url, { ...opts, type: 'png', width: 1200 });
const svg = await QRCode.toString(url, { ...opts, type: 'svg' });
fs.writeFileSync(`${out}/ar-qr.png`, png); fs.writeFileSync(`${out}/ar-qr.svg`, svg);
// verify by decoding the PNG
const { PNG } = require('pngjs');
const img = PNG.sync.read(png);
const code = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
const ok = code && code.data === url;
fs.writeFileSync(`${out}/ar-qr.json`, JSON.stringify({ url, decoded: code?.data ?? null, ok, draft, created: new Date().toISOString() }, null, 1));
console.log(ok ? `QR OK -> ${out}/ar-qr.png / .svg (${url})` : 'QR decode mismatch!'); if (!ok) process.exit(2);
