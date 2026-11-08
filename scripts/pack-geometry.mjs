// Compress public/assets/bodies-geo.bin (written by export-web-assets.py) into
// public/assets/bodies-geo.meshopt.gzb : gzip( meshopt-encoded streams ), lossless w.r.t. the quantized export.
// Streams: position int16x4 (w pad), normal int8x4 (w pad), uv uint16x2, color+mix uint8x4, index (triangles, local per object).
// Usage: node scripts/pack-geometry.mjs [assetsDir]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { MeshoptEncoder } from 'meshoptimizer';

const dir = process.argv[2] || 'public/assets';
const rawDir = process.argv[3] || 'build-cache'; // raw export kept out of the public build
const manPath = path.join(dir, 'manifest.json');
const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
const g = man.bodies.geometry;
const rawPath = fs.existsSync(path.join(dir, g.url)) ? path.join(dir, g.url) : path.join(rawDir, g.url);
const raw = fs.readFileSync(rawPath);
const A = Object.fromEntries(g.arrays.map((a) => [a.name, a]));
const view = (n, T) => new T(raw.buffer, raw.byteOffset + A[n].byteOffset, A[n].count * A[n].components);
const pos = view('position', Int16Array), nrm = view('normal', Int8Array), uv = view('uv', Uint16Array);
const col = view('color', Uint8Array), mix = view('mixId', Uint8Array), idx = view('index', Uint16Array);
const ranges = view('objectRanges', Uint32Array), bounds = view('objectBounds', Float32Array);
const NV = A.position.count;

await MeshoptEncoder.ready;
function stream(stride, fill) {
  const b = new Uint8Array(NV * stride); const d = new DataView(b.buffer);
  for (let i = 0; i < NV; i++) fill(d, b, i * stride, i);
  return MeshoptEncoder.encodeVertexBuffer(b, NV, stride);
}
const streams = {
  position: { stride: 8, data: stream(8, (d, b, o, i) => { d.setInt16(o, pos[i * 3], true); d.setInt16(o + 2, pos[i * 3 + 1], true); d.setInt16(o + 4, pos[i * 3 + 2], true); }) },
  normal: { stride: 4, data: stream(4, (d, b, o, i) => { b[o] = nrm[i * 3] & 255; b[o + 1] = nrm[i * 3 + 1] & 255; b[o + 2] = nrm[i * 3 + 2] & 255; }) },
  uv: { stride: 4, data: stream(4, (d, b, o, i) => { d.setUint16(o, uv[i * 2], true); d.setUint16(o + 2, uv[i * 2 + 1], true); }) },
  colorMix: { stride: 4, data: stream(4, (d, b, o, i) => { b[o] = col[i * 3]; b[o + 1] = col[i * 3 + 1]; b[o + 2] = col[i * 3 + 2]; b[o + 3] = mix[i]; }) },
};
const i32 = Uint32Array.from(idx);
const indexEnc = MeshoptEncoder.encodeIndexBuffer(new Uint8Array(i32.buffer), idx.length, 4);

// container: [u32 headerLen][header json][pad4][blocks...]
const blocks = []; let off = 0; const layout = {};
const add = (name, data, extra) => { while (off % 4) { blocks.push(new Uint8Array(1)); off++; } layout[name] = { byteOffset: off, byteLength: data.length, ...extra }; blocks.push(data); off += data.length; };
for (const [k, s] of Object.entries(streams)) add(k, s.data, { codec: 'meshopt-vertex', stride: s.stride, count: NV });
add('index', indexEnc, { codec: 'meshopt-index', stride: 4, count: idx.length, note: 'decode to uint32 then narrow to uint16 local indices' });
add('objectRanges', new Uint8Array(ranges.buffer.slice(ranges.byteOffset, ranges.byteOffset + ranges.byteLength)), { codec: 'raw', dtype: 'uint32', components: 4 });
add('objectBounds', new Uint8Array(bounds.buffer.slice(bounds.byteOffset, bounds.byteOffset + bounds.byteLength)), { codec: 'raw', dtype: 'float32', components: 6 });
const header = Buffer.from(JSON.stringify(layout));
const head = Buffer.alloc(4); head.writeUInt32LE(header.length);
let pad = (4 - ((4 + header.length) % 4)) % 4;
const body = Buffer.concat([head, header, Buffer.alloc(pad), ...blocks.map((b) => Buffer.from(b.buffer, b.byteOffset, b.byteLength))]);
const gz = zlib.gzipSync(body, { level: 9 });
const outName = 'bodies-geo.meshopt.gzb';
fs.writeFileSync(path.join(dir, outName), gz);
man.bodies.packed = {
  url: outName, encoding: 'gzip( u32 headerLen | header JSON | pad4 | blocks )', blocksRelativeTo: 'start of data after header+pad',
  bytes: gz.length, uncompressedBytes: body.length, sha256: crypto.createHash('sha256').update(gz).digest('hex'),
  decoder: 'three/examples/jsm/libs/meshopt_decoder.module.js', positionStride8: 'int16 xyz + pad', normalStride4: 'int8 xyz + pad',
};
fs.writeFileSync(manPath, JSON.stringify(man, null, 1));
if (rawPath.startsWith(dir)) { fs.mkdirSync(rawDir, { recursive: true }); fs.renameSync(rawPath, path.join(rawDir, g.url)); }
console.log(`packed ${(raw.length / 1e6).toFixed(1)}MB -> ${(gz.length / 1e6).toFixed(2)}MB (${outName})`);
