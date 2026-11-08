// Loads manifest + binary assets produced by scripts/export-web-assets.py and scripts/pack-geometry.mjs.
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

async function fetchBytes(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error(`asset ${url}: HTTP ${res.status}`), { code: 'network' });
  let stream = res.body;
  if (onProgress && stream) {
    let got = 0;
    stream = stream.pipeThrough(new TransformStream({ transform(chunk, c) { got += chunk.byteLength; onProgress(got); c.enqueue(chunk); } }));
  }
  let bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  // .gzb = gzip payload. Some servers add Content-Encoding and the browser already inflated it: check the magic bytes.
  if (url.endsWith('.gzb') && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw Object.assign(new Error('DecompressionStream unsupported'), { code: 'unsupported' });
    bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  return bytes;
}

// int16 delta-along-frames -> absolute int16 [F*N*C]
function undelta(bytes, shape) {
  const [F, N, C] = shape, row = N * C;
  const q = new Int16Array(bytes.buffer, bytes.byteOffset, F * row);
  for (let k = 1; k < F; k++) {
    const o = k * row, p = o - row;
    for (let j = 0; j < row; j++) q[o + j] = (q[p + j] + q[o + j]) << 16 >> 16;
  }
  return q;
}

export class AnimTrack {
  constructor(entry, q) {
    this.shape = entry.shape; [this.F, this.N, this.C] = entry.shape;
    this.q = q;
    this.lo = Float32Array.from(entry.channels.map((c) => c.min));
    this.k = Float32Array.from(entry.channels.map((c) => (c.max - c.min) / 65535));
  }
  // value of channel c of item n at frame index f
  get(f, n, c) { return (this.q[(f * this.N + n) * this.C + c] + 32768) * this.k[c] + this.lo[c]; }
}

export async function loadArtwork(base, { onProgress } = {}) {
  const manifest = await (await fetch(`${base}manifest.json`)).json();
  if (manifest.schemaVersion !== 1) throw new Error(`unsupported manifest schema ${manifest.schemaVersion}`);
  const urls = [manifest.bodies.packed.url, ...Object.values(manifest.animation).map((a) => a.url), manifest.tips.geometry.url];
  const totals = { bodies: manifest.bodies.packed.bytes }; let done = 0; const got = {};
  const prog = (key) => (n) => { got[key] = n; if (onProgress) onProgress(Object.values(got).reduce((a, b) => a + b, 0)); };
  const totalBytes = manifest.bodies.packed.bytes + Object.values(manifest.animation).reduce((s, a) => s + a.bytes, 0) + manifest.tips.geometry.bytes;
  const [geoBytes, tipBytes, ...animBytes] = await Promise.all([
    fetchBytes(base + manifest.bodies.packed.url, prog('geo')),
    fetchBytes(base + manifest.tips.geometry.url, prog('tips')),
    ...Object.entries(manifest.animation).map(([k, a]) => fetchBytes(base + a.url, prog(k))),
  ]);
  const anim = {};
  Object.keys(manifest.animation).forEach((k, i) => {
    const e = manifest.animation[k];
    anim[k] = e.encoding.startsWith('gzip(int16') ? new AnimTrack(e, undelta(animBytes[i], e.shape)) : { shape: e.shape, data: animBytes[i] };
  });
  await MeshoptDecoder.ready;
  const geo = decodeBodies(geoBytes, manifest);
  const tips = sliceTips(tipBytes, manifest);
  return { manifest, geo, tips, anim, totalBytes };
}

function decodeBodies(bytes, manifest) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hlen = dv.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + hlen)));
  let base = 4 + hlen; base += (4 - (base % 4)) % 4;
  const blk = (name) => bytes.subarray(base + header[name].byteOffset, base + header[name].byteOffset + header[name].byteLength);
  const NV = header.position.count;
  const vstream = (name) => { const h = header[name]; const out = new Uint8Array(h.count * h.stride); MeshoptDecoder.decodeVertexBuffer(out, h.count, h.stride, blk(name)); return out; };
  const posQ = new Int16Array(vstream('position').buffer);           // stride 4 shorts
  const normal = new Int8Array(vstream('normal').buffer);            // stride 4
  const uv = new Uint16Array(vstream('uv').buffer);                  // stride 2
  const colorMix = vstream('colorMix');                              // stride 4 (rgb srgb, mixId)
  const ih = header.index; const idx32 = new Uint32Array(ih.count);
  MeshoptDecoder.decodeIndexBuffer(new Uint8Array(idx32.buffer), ih.count, 4, blk('index'));
  const rb = blk('objectRanges'), bb = blk('objectBounds');
  const ranges = new Uint32Array(rb.slice().buffer), bounds = new Float32Array(bb.slice().buffer);
  // decode local positions to float and build per-vertex object id
  const NB = ranges.length / 4;
  const position = new Float32Array(NV * 3), objId = new Uint16Array(NV);
  for (let o = 0; o < NB; o++) {
    const v0 = ranges[o * 4], vc = ranges[o * 4 + 1];
    const mx = bounds[o * 6], my = bounds[o * 6 + 1], mz = bounds[o * 6 + 2];
    const ex = bounds[o * 6 + 3] / 65535, ey = bounds[o * 6 + 4] / 65535, ez = bounds[o * 6 + 5] / 65535;
    for (let v = v0; v < v0 + vc; v++) {
      position[v * 3] = mx + (posQ[v * 4] + 32768) * ex;
      position[v * 3 + 1] = my + (posQ[v * 4 + 1] + 32768) * ey;
      position[v * 3 + 2] = mz + (posQ[v * 4 + 2] + 32768) * ez;
      objId[v] = o;
    }
  }
  return { NV, NB, position, normal, uv, colorMix, objId, index: idx32, ranges, bounds };
}

function sliceTips(bytes, manifest) {
  const A = Object.fromEntries(manifest.tips.geometry.arrays.map((a) => [a.name, a]));
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return {
    position: new Float32Array(buf, A.position.byteOffset, A.position.count * 3),
    index: new Uint16Array(buf, A.index.byteOffset, A.index.count),
    ranges: new Uint32Array(buf, A.objectRanges.byteOffset, A.objectRanges.count * 4),
  };
}
