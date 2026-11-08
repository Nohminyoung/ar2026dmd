// Builds the 결합 artwork from exported data and poses everything from one time value.
// Bodies: merged chunks (<=65535 verts), transforms fetched per object from a float texture in the vertex shader.
// Lines: one ribbon mesh; per-line cubic control points + visible arc-length part from a float texture.
import * as THREE from 'three';

const TEX_W = 256;
const LINE_SEG = 48;

function floatTexture(texels) {
  const h = Math.max(1, Math.ceil(texels / TEX_W));
  const data = new Float32Array(TEX_W * h * 4);
  const t = new THREE.DataTexture(data, TEX_W, h, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

const QROT = /* glsl */`
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
vec4 fetchTexel(sampler2D t, int i) { return texelFetch(t, ivec2(i % ${TEX_W}, i / ${TEX_W}), 0); }
`;

export class ArtworkPlayer {
  constructor(data, { showPoster = false, posterTexture = null, atlasTexture } = {}) {
    this.data = data; this.m = data.manifest;
    this.fps = this.m.fps; this.F = this.m.frameCount; this.duration = this.m.durationSeconds;
    this.root = new THREE.Group(); this.root.name = 'artwork';
    this.time = -1;
    this._buildLights();
    this._buildBodies(atlasTexture);
    this._buildTips();
    this._buildLines();
    if (posterTexture) this._buildPoster(posterTexture, showPoster);
    this.setTime(0);
  }

  _buildLights() {
    // Blender: world gray 0.065 x 0.65 + two area lights. Calibrated against Blender reference renders (qa/compare).
    const amb = new THREE.AmbientLight(0xffffff, Math.PI * 0.065 * 0.65);
    this.root.add(amb);
    this.lights = [];
    const k = this.m.lightingCalibration ?? 0.32;
    for (const L of this.m.lighting.lights) {
      const d = new THREE.Vector3(...L.direction).normalize();
      const p = new THREE.Vector3(...L.position);
      const irr = L.energyW / Math.max(0.5, p.length() ** 2) * k;
      const light = new THREE.DirectionalLight(0xffffff, irr);
      light.position.copy(d.clone().multiplyScalar(-5));
      light.target.position.set(0, 0, 0);
      this.root.add(light, light.target);
      this.lights.push(light);
    }
  }

  _buildBodies(atlas) {
    const g = this.data.geo, NB = g.NB;
    this.xfTex = floatTexture(NB * 2);
    const NM = Math.max(1, this.m.personalMix.count);
    this.mixData = new Float32Array(TEX_W * 4);
    this.mixTex = new THREE.DataTexture(this.mixData, TEX_W, 1, THREE.RGBAFormat, THREE.FloatType);
    this.mixTex.minFilter = this.mixTex.magFilter = THREE.NearestFilter; this.mixTex.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.38, metalness: 0.0 });
    const uniforms = { xfTex: { value: this.xfTex }, mixTex: { value: this.mixTex } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float objId; attribute float mixId; attribute vec3 pcolor;
uniform highp sampler2D xfTex; uniform highp sampler2D mixTex;
varying vec3 vPColor; varying float vMix;
${QROT}
vec3 srgbToLinear3(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }`)
        .replace('#include <beginnormal_vertex>', `
int oid = int(objId + 0.5);
vec4 xf0 = fetchTexel(xfTex, oid * 2);
vec4 xq = fetchTexel(xfTex, oid * 2 + 1);
vec3 objectNormal = qrot(xq, normal);
vPColor = srgbToLinear3(pcolor);
vMix = mixId > 0.5 ? texelFetch(mixTex, ivec2(int(mixId + 0.5) - 1, 0), 0).r : 0.0;`)
        .replace('#include <begin_vertex>', 'vec3 transformed = qrot(xq, position * xf0.w) + xf0.xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPColor; varying float vMix;')
        .replace('#include <map_fragment>', `
vec4 sampledDiffuseColor = texture2D( map, vMapUv );
diffuseColor.rgb *= mix( sampledDiffuseColor.rgb, vPColor, vMix );`);
    };
    mat.customProgramCacheKey = () => 'gyeolhap-bodies-v1';
    this.bodyMaterial = mat;
    // chunking
    const R = g.ranges; const chunks = []; let cur = null;
    for (let o = 0; o < NB; o++) {
      const vc = R[o * 4 + 1];
      if (!cur || cur.vcount + vc > 65535) { cur = { objs: [], v0: R[o * 4], vcount: 0, icount: 0 }; chunks.push(cur); }
      cur.objs.push(o); cur.vcount += vc; cur.icount += R[o * 4 + 3];
    }
    this.bodyGroup = new THREE.Group(); this.bodyGroup.name = 'bodies';
    for (const c of chunks) {
      const geo = new THREE.BufferGeometry();
      const v0 = c.v0, v1 = v0 + c.vcount;
      geo.setAttribute('position', new THREE.BufferAttribute(g.position.subarray(v0 * 3, v1 * 3), 3));
      geo.setAttribute('normal', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(new Int8Array(g.normal.buffer, g.normal.byteOffset + v0 * 4, c.vcount * 4), 4), 3, 0, true));
      geo.setAttribute('uv', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(new Uint16Array(g.uv.buffer, g.uv.byteOffset + v0 * 4, c.vcount * 2), 2), 2, 0, true));
      const cm = new THREE.InterleavedBuffer(new Uint8Array(g.colorMix.buffer, g.colorMix.byteOffset + v0 * 4, c.vcount * 4), 4);
      geo.setAttribute('pcolor', new THREE.InterleavedBufferAttribute(cm, 3, 0, true));
      geo.setAttribute('mixId', new THREE.InterleavedBufferAttribute(cm, 1, 3, false));
      geo.setAttribute('objId', new THREE.BufferAttribute(g.objId.subarray(v0, v1), 1));
      const idx = new Uint16Array(c.icount); let w = 0;
      for (const o of c.objs) {
        const ov0 = R[o * 4] - v0, i0 = R[o * 4 + 2], ic = R[o * 4 + 3];
        for (let i = 0; i < ic; i++) idx[w++] = g.index[i0 + i] + ov0;
      }
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
      this.bodyGroup.add(mesh);
    }
    this.chunkCount = chunks.length;
    this.root.add(this.bodyGroup);
  }

  _buildTips() {
    const t = this.data.tips, m = this.m.tips;
    this.tipMeshes = [];
    for (let i = 0; i < m.count; i++) {
      const v0 = t.ranges[i * 4], vc = t.ranges[i * 4 + 1], i0 = t.ranges[i * 4 + 2], ic = t.ranges[i * 4 + 3];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(t.position.slice(v0 * 3, (v0 + vc) * 3), 3));
      geo.setIndex(new THREE.BufferAttribute(t.index.slice(i0, i0 + ic), 1));
      const c = m.colors[i];
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0 });
      mat.color.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);
      const mesh = new THREE.Mesh(geo, mat); mesh.visible = false; mesh.renderOrder = 2;
      this.tipMeshes.push(mesh); this.root.add(mesh);
    }
  }

  _buildLines() {
    const m = this.m.lines, NL = m.count;
    this.lineTex = floatTexture(NL * 4);
    const per = (LINE_SEG + 1) * 2;
    const tA = new Float32Array(NL * per), sA = new Float32Array(NL * per), idA = new Float32Array(NL * per), col = new Float32Array(NL * per * 3);
    const idx = new Uint32Array(NL * LINE_SEG * 6); let w = 0;
    for (let l = 0; l < NL; l++) {
      for (let s = 0; s <= LINE_SEG; s++) for (let side = 0; side < 2; side++) {
        const v = l * per + s * 2 + side;
        tA[v] = s / LINE_SEG; sA[v] = side ? 1 : -1; idA[v] = l; col.set(m.colors[l], v * 3);
      }
      for (let s = 0; s < LINE_SEG; s++) {
        const a = l * per + s * 2; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], w); w += 6;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NL * per * 3), 3));
    geo.setAttribute('lineT', new THREE.BufferAttribute(tA, 1));
    geo.setAttribute('lineSide', new THREE.BufferAttribute(sA, 1));
    geo.setAttribute('lineId', new THREE.BufferAttribute(idA, 1));
    geo.setAttribute('lcolor', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.lineUniforms = { lineTex: { value: this.lineTex }, resolution: { value: new THREE.Vector2(720, 1280) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.lineUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        attribute float lineT; attribute float lineSide; attribute float lineId; attribute vec3 lcolor;
        uniform highp sampler2D lineTex; uniform vec2 resolution;
        varying vec3 vColor; varying float vAlpha;
        ${QROT}
        void main() {
          int b = int(lineId + 0.5) * 4;
          vec4 a0 = fetchTexel(lineTex, b), a1 = fetchTexel(lineTex, b + 1), a2 = fetchTexel(lineTex, b + 2), a3 = fetchTexel(lineTex, b + 3);
          float u = mix(a2.w, a3.w, lineT), iu = 1.0 - u;
          vec3 p = iu*iu*iu*a0.xyz + 3.0*iu*iu*u*a1.xyz + 3.0*iu*u*u*a2.xyz + u*u*u*a3.xyz;
          vec3 d = 3.0*iu*iu*(a1.xyz-a0.xyz) + 6.0*iu*u*(a2.xyz-a1.xyz) + 3.0*u*u*(a3.xyz-a2.xyz);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vec4 clip = projectionMatrix * mv;
          vec4 clip2 = projectionMatrix * (modelViewMatrix * vec4(p + normalize(d + 1e-7) * 0.001, 1.0));
          vec2 s1 = clip.xy / clip.w * resolution * 0.5, s2 = clip2.xy / clip2.w * resolution * 0.5;
          vec2 dir = s2 - s1; dir = length(dir) > 1e-6 ? normalize(dir) : vec2(1.0, 0.0);
          vec2 nrm = vec2(-dir.y, dir.x);
          float rView = length(mat3(modelViewMatrix) * vec3(a1.w, 0.0, 0.0));
          float rPx = rView * projectionMatrix[1][1] * resolution.y * 0.5 / max(1e-4, -mv.z);
          float halfPx = max(rPx, 0.6);
          // Blender composites alpha in linear light; the canvas blends sRGB-encoded values.
          // Over the dark poster that is sRGB(a*c) ~= a^(1/2.2) * sRGB(c), so encode coverage*alpha the same way.
          float cov = (a3.w > a2.w + 1e-5) ? a0.w * min(1.0, rPx / 0.6) : 0.0;
          vAlpha = pow(cov, 1.0 / 2.2);
          vColor = lcolor;
          clip.xy += nrm * lineSide * halfPx / (resolution * 0.5) * clip.w;
          gl_Position = clip;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor; varying float vAlpha;
        void main() {
          if (vAlpha <= 0.0) discard;
          gl_FragColor = vec4(vColor, vAlpha);
          #include <colorspace_fragment>
        }`,
    });
    this.lineMesh = new THREE.Mesh(geo, mat);
    this.lineMesh.frustumCulled = false; this.lineMesh.renderOrder = 1;
    this.root.add(this.lineMesh);
    this._lut = new Float32Array(33);
  }

  _buildPoster(tex, visible) {
    const p = this.m.posterPlane;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(p.maxX - p.minX, p.maxY - p.minY), new THREE.MeshBasicMaterial({ map: tex }));
    mesh.position.set((p.minX + p.maxX) / 2, (p.minY + p.maxY) / 2, p.z);
    mesh.visible = visible; mesh.name = 'preview-poster';
    this.poster = mesh; this.root.add(mesh);
  }

  setResolution(w, h) { this.lineUniforms.resolution.value.set(w, h); }

  // t in seconds, clamped to [0, duration]; the last sample is held to the end.
  setTime(t) {
    t = Math.min(Math.max(t, 0), this.duration);
    if (t === this.time) return;
    this.time = t;
    const fp = Math.min(t * this.fps, this.F - 1);
    const f0 = Math.floor(fp + 1e-6), f1 = Math.min(f0 + 1, this.F - 1), a = fp - f0;
    this._poseBodies(f0, f1, a);
    this._poseTips(f0, f1, a);
    this._poseLines(f0, f1, a);
    this._poseMix(f0, f1, a);
  }

  _poseBodies(f0, f1, a) {
    const A = this.data.anim.bodies, N = A.N, out = this.xfTex.image.data;
    for (let n = 0; n < N; n++) {
      const o = n * 8;
      for (let c = 0; c < 3; c++) out[o + c] = A.get(f0, n, c) * (1 - a) + A.get(f1, n, c) * a;
      out[o + 3] = A.get(f0, n, 7) * (1 - a) + A.get(f1, n, 7) * a;
      let x = A.get(f0, n, 3) * (1 - a) + A.get(f1, n, 3) * a, y = A.get(f0, n, 4) * (1 - a) + A.get(f1, n, 4) * a;
      let z = A.get(f0, n, 5) * (1 - a) + A.get(f1, n, 5) * a, w = A.get(f0, n, 6) * (1 - a) + A.get(f1, n, 6) * a;
      const l = Math.hypot(x, y, z, w) || 1; // nlerp == slerp at these per-frame angles
      out[o + 4] = x / l; out[o + 5] = y / l; out[o + 6] = z / l; out[o + 7] = w / l;
    }
    this.xfTex.needsUpdate = true;
  }

  _poseTips(f0, f1, a) {
    const A = this.data.anim.tips, V = this.data.anim.tipsVisible.data, N = A.N;
    const q = new THREE.Quaternion();
    for (let n = 0; n < N; n++) {
      const mesh = this.tipMeshes[n];
      const lerp = (c) => A.get(f0, n, c) * (1 - a) + A.get(f1, n, c) * a;
      const alpha = lerp(8), vis = V[f0 * N + n] === 1;
      mesh.visible = vis && alpha > 1e-4;
      if (!mesh.visible) continue;
      mesh.position.set(lerp(0), lerp(1), lerp(2));
      q.set(lerp(3), lerp(4), lerp(5), lerp(6)).normalize(); mesh.quaternion.copy(q);
      mesh.scale.setScalar(lerp(7));
      mesh.material.opacity = Math.pow(alpha, 1 / 2.2); // linear-light alpha -> sRGB-space blend (see line shader)
    }
  }

  _poseLines(f0, f1, a) {
    const A = this.data.anim.lines, V = this.data.anim.linesVisible.data, N = A.N, out = this.lineTex.image.data;
    const radius = this.m.lines.radius;
    const P = new Float32Array(12);
    for (let n = 0; n < N; n++) {
      const o = n * 16;
      const vis = V[f0 * N + n] === 1;
      for (let c = 0; c < 12; c++) P[c] = A.get(f0, n, c) * (1 - a) + A.get(f1, n, c) * a;
      const s = A.get(f0, n, 12) * (1 - a) + A.get(f1, n, 12) * a;
      const e = A.get(f0, n, 13) * (1 - a) + A.get(f1, n, 13) * a;
      const al = A.get(f0, n, 14) * (1 - a) + A.get(f1, n, 14) * a;
      for (let j = 0; j < 4; j++) { out[o + j * 4] = P[j * 3]; out[o + j * 4 + 1] = P[j * 3 + 1]; out[o + j * 4 + 2] = P[j * 3 + 2]; }
      let u0 = 0, u1 = 0;
      if (vis && e - s > 1e-5 && al > 1e-5) { u0 = this._arcParam(P, Math.max(0, s)); u1 = this._arcParam(P, Math.min(1, e)); }
      out[o + 3] = vis ? al : 0; out[o + 7] = radius[n]; out[o + 11] = u0; out[o + 15] = u1;
    }
    this.lineTex.needsUpdate = true;
  }

  // Blender SPLINE mapping: bevel factor is a fraction of arc length -> cubic parameter
  _arcParam(P, frac) {
    if (frac <= 0) return 0; if (frac >= 1) return 1;
    const lut = this._lut, S = 32; let px = P[0], py = P[1], pz = P[2]; lut[0] = 0;
    for (let i = 1; i <= S; i++) {
      const u = i / S, iu = 1 - u, b0 = iu * iu * iu, b1 = 3 * iu * iu * u, b2 = 3 * iu * u * u, b3 = u * u * u;
      const x = b0 * P[0] + b1 * P[3] + b2 * P[6] + b3 * P[9], y = b0 * P[1] + b1 * P[4] + b2 * P[7] + b3 * P[10], z = b0 * P[2] + b1 * P[5] + b2 * P[8] + b3 * P[11];
      lut[i] = lut[i - 1] + Math.hypot(x - px, y - py, z - pz); px = x; py = y; pz = z;
    }
    const target = frac * lut[S];
    let i = 1; while (i < S && lut[i] < target) i++;
    const seg = lut[i] - lut[i - 1] || 1;
    return (i - 1 + (target - lut[i - 1]) / seg) / S;
  }

  _poseMix(f0, f1, a) {
    const A = this.data.anim.personalMix, N = A.N;
    for (let n = 0; n < N; n++) this.mixData[n * 4] = A.get(f0, n, 0) * (1 - a) + A.get(f1, n, 0) * a;
    this.mixTex.needsUpdate = true;
  }

  dispose() {
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });
    this.xfTex.dispose(); this.mixTex.dispose(); this.lineTex.dispose();
  }
}
