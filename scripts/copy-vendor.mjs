// Copy the whole 8th Wall engine-binary dist (all chunks + resources + LICENSE) into public/vendor/xr/.
// Copying only xr.js would miss lazily loaded chunks (xr-slam.js) and worker resources.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve('@8thwall/engine-binary/package.json'));
const src = path.join(pkgDir, 'dist');
const dst = path.resolve('public/vendor/xr');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));

fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
fs.copyFileSync(path.join(pkgDir, 'LICENSE'), path.join(dst, 'LICENSE-engine-binary.txt'));
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(path.relative(dst, p)); } })(dst);
fs.writeFileSync(path.join(dst, 'VENDOR.json'), JSON.stringify({ package: pkg.name, version: pkg.version, files }, null, 1));
for (const need of ['xr.js', 'xr-slam.js']) if (!files.includes(need)) { console.error(`missing ${need} in engine dist`); process.exit(1); }
console.log(`vendor: ${pkg.name}@${pkg.version} -> public/vendor/xr (${files.length} files)`);
