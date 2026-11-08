"""Blender -> web assets for the 결합 AR player. Never saves the source file.

  blender --background --disable-autoexec input/<file>.blend --python scripts/export-web-assets.py -- --out public/assets
  python -I scripts/export-web-assets.py -- --blend input/<file>.blend --out public/assets          (bpy module)

Outputs (all little-endian):
  manifest.json          schema, timing, counts, array layouts, hashes
  bodies-geo.bin         per-vertex corner-split geometry of the 'body' icon meshes (quantized)
  tips-geo.bin           connection tip meshes (float32)
  anim-*.bin.gz          frame-major animation, int16 quantized, delta-coded along frames, gzip
  atlas.png / poster.jpg packed images, original bytes

Timeline: samples scene frames frame_start..frame_end with the scene's time remapping applied
(scene.frame_set evaluates the remapped time), so sample i is shown at i / fps seconds.
Coordinates: Blender world XYZ copied unchanged (poster in the XY plane, viewer on +Z) -> three.js XYZ.
Quaternions stored xyzw (three.js order); Blender wxyz is converted. Sign made continuous per object.
Curves: P0=pt0.co, P1=pt0.handle_right, P2=pt1.handle_left, P3=pt1.co in world space, plus the evaluated
bevel_factor_start / bevel_factor_end (SPLINE = arc-length mapping) that decide the visible part.
The control points are NOT pre-trimmed in this file version, so the player draws only [start, end].
"""
import bpy, sys, os, json, hashlib, gzip, argparse, time, math
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--blend'); ap.add_argument('--out', required=True)
ap.add_argument('--frames', type=int, default=0, help='debug: limit sampled frames')
a = ap.parse_args(argv)
if a.blend:
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a.blend), load_ui=False, use_scripts=False)
SRC = bpy.data.filepath
OUT = os.path.abspath(a.out); os.makedirs(OUT, exist_ok=True)
t0 = time.time()
sc = bpy.context.scene
F0, F1 = sc.frame_start, sc.frame_end
FR = list(range(F0, F1 + 1))
if a.frames: FR = FR[:a.frames]
NF = len(FR)
fps = sc.render.fps / sc.render.fps_base

def sha(b): return hashlib.sha256(b).hexdigest()
def fcurves_of(act):
    return [f for l in act.layers for st in l.strips for cb in st.channelbags for f in cb.fcurves] if act else []

# ---------------- classify ----------------
bodies = sorted([o for o in bpy.data.objects if o.get('export_kind') == 'body'], key=lambda o: int(o.get('export_index', 0)))
tips = sorted([o for o in bpy.data.objects if 'connection_tip' in o], key=lambda o: o.name)
lines = sorted([o for o in bpy.data.objects if o.type == 'CURVE' and not o.name.startswith('◆') and len(o.data.splines)], key=lambda o: o.name)
poster = next((o for o in bpy.data.objects if o.type == 'MESH' and any(u.name == 'Poster UV' for u in o.data.uv_layers)), None)
print(f'bodies {len(bodies)} tips {len(tips)} lines {len(lines)} frames {NF}')

# keep everything evaluated: hidden objects can be skipped by the depsgraph (in memory only, never saved)
for o in tips + lines:
    if o.animation_data and o.animation_data.action:
        for cb in [cb for l in o.animation_data.action.layers for st in l.strips for cb in st.channelbags]:
            for f in [f for f in cb.fcurves if f.data_path == 'hide_viewport']:
                cb.fcurves.remove(f)
    o.hide_viewport = False

# ---------------- materials ----------------
MIX = 'Personal mix from approved motion'
mix_mats = []
for o in bodies:
    for m in o.data.materials:
        if m and MIX in m.node_tree.nodes and m not in mix_mats: mix_mats.append(m)
mix_index = {m.name: i + 1 for i, m in enumerate(mix_mats)}   # 0 = no personal mix

def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)

# ---------------- body geometry ----------------
pos_q, nrm_q, uv_q, col_q, mix_q, idx_q, objtab = [], [], [], [], [], [], []
vtot = itot = 0; tri_total = 0
for bi, o in enumerate(bodies):
    me = o.data
    me.calc_loop_triangles()
    nv, nl, nt = len(me.vertices), len(me.loops), len(me.loop_triangles)
    co = np.empty(nv * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    lv = np.empty(nl, np.int32); me.loops.foreach_get('vertex_index', lv)
    cn = np.empty(nl * 3, np.float32); me.corner_normals.foreach_get('vector', cn); cn = cn.reshape(-1, 3)
    uvl = me.uv_layers.get('Source atlas UV') or me.uv_layers.active
    uv = np.empty(nl * 2, np.float32); uvl.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    ca = me.color_attributes.get('Personal RGB')
    pc = np.empty(nl * 4, np.float32); ca.data.foreach_get('color', pc); pc = pc.reshape(-1, 4)[:, :3]
    tl = np.empty(nt * 3, np.int32); me.loop_triangles.foreach_get('loops', tl); tl = tl.reshape(-1, 3)
    tm = np.empty(nt, np.int32); me.loop_triangles.foreach_get('material_index', tm)
    slot_mix = np.array([mix_index.get(m.name, 0) if m else 0 for m in me.materials] or [0], np.uint8)
    loop_mix = np.zeros(nl, np.uint8)
    loop_mix[tl.reshape(-1)] = np.repeat(slot_mix[np.clip(tm, 0, len(slot_mix) - 1)], 3)
    # quantize corner attributes, then split vertices by unique corner signature
    nq = np.clip(np.round(cn * 127), -127, 127).astype(np.int8)
    uq = np.clip(np.round(uv * 65535), 0, 65535).astype(np.uint16)
    cq = np.clip(np.round(lin2srgb(pc) * 255), 0, 255).astype(np.uint8)
    key = np.zeros(nl, dtype=[('v', '<i4'), ('n', 'i1', 3), ('u', '<u2', 2), ('c', 'u1', 3), ('m', 'u1')])
    key['v'] = lv; key['n'] = nq; key['u'] = uq; key['c'] = cq; key['m'] = loop_mix
    used = np.unique(tl.reshape(-1))
    uk, inv = np.unique(key[used], return_inverse=True)
    remap = np.full(nl, -1, np.int64); remap[used] = inv
    idx = remap[tl.reshape(-1)]
    assert len(uk) < 65536 and idx.min() >= 0
    p = co[uk['v']]
    bmin = p.min(0); ext = np.maximum(p.max(0) - bmin, 1e-9)
    qp = (np.round((p - bmin) / ext * 65535) - 32768).astype(np.int16)
    pos_q.append(qp); nrm_q.append(uk['n']); uv_q.append(uk['u']); col_q.append(uk['c']); mix_q.append(uk['m'])
    idx_q.append(idx.astype(np.uint16))
    objtab.append([vtot, len(uk), itot, len(idx), *bmin.tolist(), *ext.tolist()])
    vtot += len(uk); itot += len(idx); tri_total += nt
    if bi % 500 == 0: print(f'  geo {bi}/{len(bodies)} verts {vtot} {time.time()-t0:.0f}s')

def concat(lst, dt): return np.ascontiguousarray(np.concatenate(lst).astype(dt))
geo_parts = [('position', concat(pos_q, '<i2'), 'int16', 3), ('normal', concat(nrm_q, 'i1'), 'int8', 3),
             ('uv', concat(uv_q, '<u2'), 'uint16', 2), ('color', concat(col_q, 'u1'), 'uint8', 3),
             ('mixId', concat(mix_q, 'u1'), 'uint8', 1), ('index', concat(idx_q, '<u2'), 'uint16', 1)]
objt = np.array(objtab, dtype=np.float64)
obj_ints = objt[:, :4].astype('<u4'); obj_flt = objt[:, 4:].astype('<f4')
def write_bin(name, parts):
    blob = bytearray(); layout = []
    for pname, arr, dtype, comps in parts:
        while len(blob) % 4: blob.append(0)
        layout.append({'name': pname, 'dtype': dtype, 'components': comps, 'byteOffset': len(blob), 'count': int(arr.size // comps)})
        blob += arr.tobytes()
    open(os.path.join(OUT, name), 'wb').write(blob)
    return {'url': name, 'bytes': len(blob), 'sha256': sha(bytes(blob)), 'arrays': layout}
geo_parts += [('objectRanges', obj_ints, 'uint32', 4), ('objectBounds', obj_flt, 'float32', 6)]
bodies_geo = write_bin('bodies-geo.bin', geo_parts)
print(f'bodies geo: verts {vtot} tris {itot//3} bytes {bodies_geo["bytes"]/1e6:.1f}MB {time.time()-t0:.0f}s')

# ---------------- tips geometry (tiny, float32) ----------------
tpos, tidx, ttab = [], [], []; tv = ti = 0
for o in tips:
    me = o.data; me.calc_loop_triangles()
    co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co)
    tl = np.empty(len(me.loop_triangles) * 3, np.int32); me.loop_triangles.foreach_get('vertices', tl)
    tpos.append(co); tidx.append(tl.astype('<u2')); ttab.append([tv, len(me.vertices), ti, len(tl)])
    tv += len(me.vertices); ti += len(tl)
tips_geo = write_bin('tips-geo.bin', [('position', concat(tpos, '<f4'), 'float32', 3), ('index', concat(tidx, '<u2'), 'uint16', 1),
                                      ('objectRanges', np.array(ttab, '<u4'), 'uint32', 4)])

def emission_rgb(m):
    for n in m.node_tree.nodes:
        if n.type == 'EMISSION': return [float(x) for x in n.inputs['Color'].default_value[:3]]
    return [1, 1, 1]
def opacity_socket(m):
    n = m.node_tree.nodes.get('Animated opacity'); return n.inputs[0] if n else None

# ---------------- sample animation ----------------
NB, NT, NL, NM = len(bodies), len(tips), len(lines), len(mix_mats)
B = np.zeros((NF, NB, 8), np.float32)      # pos xyz, quat xyzw, uniform scale
T = np.zeros((NF, NT, 9), np.float32)      # pos xyz, quat xyzw, scale, alpha
TV = np.zeros((NF, NT), np.uint8)
L = np.zeros((NF, NL, 15), np.float32)     # P0..P3 (12), start, end, alpha
LV = np.zeros((NF, NL), np.uint8)
M = np.zeros((NF, max(NM, 1)), np.float32)
tip_mats = [o.data.materials[0] for o in tips]; line_mats = [o.data.materials[0] for o in lines]
aniso = 0.0
for k, f in enumerate(FR):
    sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    for i, o in enumerate(bodies):
        mw = o.evaluated_get(dg).matrix_world
        loc, q, s = mw.decompose()
        B[k, i] = (loc.x, loc.y, loc.z, q.x, q.y, q.z, q.w, s.x)
        if s.x > 1e-6: aniso = max(aniso, (max(s) - min(s)) / max(s))
    for i, o in enumerate(tips):
        ev = o.evaluated_get(dg)
        loc, q, s = ev.matrix_world.decompose()
        sock = opacity_socket(tip_mats[i].evaluated_get(dg))
        T[k, i] = (loc.x, loc.y, loc.z, q.x, q.y, q.z, q.w, s.x, sock.default_value if sock else 1)
        TV[k, i] = 0 if o.hide_render else 1
    for i, o in enumerate(lines):
        ev = o.evaluated_get(dg); cu = ev.data; mw = ev.matrix_world
        p0, p1 = cu.splines[0].bezier_points[0], cu.splines[0].bezier_points[1]
        pts = [mw @ p0.co, mw @ p0.handle_right, mw @ p1.handle_left, mw @ p1.co]
        sock = opacity_socket(line_mats[i].evaluated_get(dg))
        L[k, i, :12] = [c for p in pts for c in (p.x, p.y, p.z)]
        L[k, i, 12:] = (cu.bevel_factor_start, cu.bevel_factor_end, sock.default_value if sock else 1)
        LV[k, i] = 0 if o.hide_render else 1
    for j, m in enumerate(mix_mats):
        M[k, j] = m.node_tree.evaluated_get(dg).nodes[MIX].inputs[0].default_value if hasattr(m.node_tree, 'evaluated_get') else m.node_tree.nodes[MIX].inputs[0].default_value
    if k % 25 == 0: print(f'  frame {f} ({k+1}/{NF}) {time.time()-t0:.0f}s')

# quaternion sign continuity (slerp along the short arc)
for arr in (B, T):
    q = arr[:, :, 3:7]
    for k in range(1, NF):
        flip = (q[k] * q[k - 1]).sum(-1) < 0
        q[k][flip] *= -1

# ---------------- encode: int16 quantize, delta along frames, gzip ----------------
def encode(name, A, channels):
    """A: [F, N, C] float. channels: list of (label, lo, hi). Returns manifest entry."""
    F, N, C = A.shape
    lo = np.array([c[1] for c in channels], np.float64); hi = np.array([c[2] for c in channels], np.float64)
    span = np.maximum(hi - lo, 1e-12)
    q = np.round((A - lo) / span * 65535 - 32768).clip(-32768, 32767).astype(np.int32)
    err = np.abs(((q + 32768) / 65535 * span + lo) - A).max(axis=(0, 1))
    d = q.copy(); d[1:] -= q[:-1]
    d16 = (d.astype(np.int64) & 0xFFFF).astype('<u2').view('<i2')
    raw = np.ascontiguousarray(d16).tobytes()
    gz = gzip.compress(raw, 9, mtime=0)
    open(os.path.join(OUT, name), 'wb').write(gz)
    return {'url': name, 'encoding': 'gzip(int16 delta along frames)', 'shape': [F, N, C], 'frameMajor': True,
            'channels': [{'name': c[0], 'min': float(c[1]), 'max': float(c[2]), 'maxAbsError': float(err[i])} for i, c in enumerate(channels)],
            'bytes': len(gz), 'rawBytes': len(raw), 'sha256': sha(gz)}
def enc_u8(name, A):
    gz = gzip.compress(np.ascontiguousarray(A, 'u1').tobytes(), 9, mtime=0)
    open(os.path.join(OUT, name), 'wb').write(gz)
    return {'url': name, 'encoding': 'gzip(uint8)', 'shape': list(A.shape), 'frameMajor': True, 'bytes': len(gz), 'sha256': sha(gz)}

def rng(x, pad=1e-4): return float(x.min()) - pad, float(x.max()) + pad
bp = B[:, :, :3]; lp = L[:, :, :12].reshape(NF, NL, 4, 3); tp = T[:, :, :3]
xyz = [rng(np.concatenate([bp[..., i].ravel(), lp[..., i].ravel(), tp[..., i].ravel()])) for i in range(3)]
Q = [(-1.0, 1.0)] * 4
smax = float(max(B[:, :, 7].max(), T[:, :, 7].max())) * 1.0001 + 1e-6
anim = {
    'bodies': encode('anim-bodies.gzb', B, [('px', *xyz[0]), ('py', *xyz[1]), ('pz', *xyz[2]), ('qx', *Q[0]), ('qy', *Q[1]), ('qz', *Q[2]), ('qw', *Q[3]), ('scale', 0.0, smax)]),
    'tips': encode('anim-tips.gzb', T, [('px', *xyz[0]), ('py', *xyz[1]), ('pz', *xyz[2]), ('qx', *Q[0]), ('qy', *Q[1]), ('qz', *Q[2]), ('qw', *Q[3]), ('scale', 0.0, smax), ('alpha', 0.0, 1.0)]),
    'tipsVisible': enc_u8('anim-tips-visible.gzb', TV),
    'lines': encode('anim-lines.gzb', L, [(f'p{j}{ax}', *xyz['xyz'.index(ax)]) for j in range(4) for ax in 'xyz'] + [('start', 0.0, 1.0), ('end', 0.0, 1.0), ('alpha', 0.0, 1.0)]),
    'linesVisible': enc_u8('anim-lines-visible.gzb', LV),
    'personalMix': encode('anim-personal-mix.gzb', M[:, :, None], [('factor', 0.0, 1.0)]),
}

# ---------------- images (original packed bytes) ----------------
images = {}
for im in bpy.data.images:
    if not im.packed_file: continue
    if any(n.type == 'TEX_IMAGE' and n.image == im for m in mix_mats[:1] + [bodies[0].data.materials[0]] for n in m.node_tree.nodes):
        fn = 'atlas.png'
    elif poster and any(n.type == 'TEX_IMAGE' and n.image == im for n in poster.data.materials[0].node_tree.nodes):
        fn = 'poster.jpg'
    else: continue
    data = bytes(im.packed_file.data); open(os.path.join(OUT, fn), 'wb').write(data)
    images[fn] = {'url': fn, 'source': im.name, 'size': list(im.size), 'colorSpace': im.colorspace_settings.name, 'bytes': len(data), 'sha256': sha(data)}

# ---------------- bounds over the whole animation (world, approx. by object radius) ----------------
rad = np.linalg.norm(obj_flt[:, 3:6], axis=1) * 0.5
centers = bp + 0  # object origins
r_world = rad[None, :] * B[:, :, 7]
vis = B[:, :, 7] > 1e-6
lo_b = np.where(vis[..., None], centers - r_world[..., None], np.inf).min(axis=(0, 1))
hi_b = np.where(vis[..., None], centers + r_world[..., None], -np.inf).max(axis=(0, 1))
lp_v = lp[LV.astype(bool)]
if len(lp_v):
    lo_b = np.minimum(lo_b, lp_v.reshape(-1, 3).min(0)); hi_b = np.maximum(hi_b, lp_v.reshape(-1, 3).max(0))

px = None
if poster:
    vv = [poster.matrix_world @ v.co for v in poster.data.vertices]
    px = {'minX': min(v.x for v in vv), 'maxX': max(v.x for v in vv), 'minY': min(v.y for v in vv), 'maxY': max(v.y for v in vv), 'z': vv[0].z}

lights = []
for o in bpy.data.objects:
    if o.type != 'LIGHT': continue
    d = o.matrix_world.to_3x3() @ __import__('mathutils').Vector((0, 0, -1))
    lights.append({'name': o.name, 'type': o.data.type, 'energyW': o.data.energy, 'color': list(o.data.color), 'size': getattr(o.data, 'size', 0),
                   'position': list(o.matrix_world.translation), 'direction': list(d)})

manifest = {
    'schemaVersion': 1,
    'source': {'file': os.path.basename(SRC), 'sha256': sha(open(SRC, 'rb').read()), 'blenderVersion': bpy.app.version_string,
               'scene': sc.name, 'timeRemap': {'old': sc.render.frame_map_old, 'new': sc.render.frame_map_new}},
    'fps': fps, 'frameStart': FR[0], 'frameEnd': FR[-1], 'frameCount': NF, 'durationSeconds': NF / fps,
    'timing': 'sample i (0-based) is shown at i/fps s; the last sample is held until durationSeconds',
    'coordinateConvention': 'Blender world XYZ unchanged = three.js XYZ; poster in XY plane, viewer +Z; poster width 1.0 unit',
    'quaternionOrder': 'xyzw', 'byteOrder': 'little-endian',
    'referencePosterWidth': (px['maxX'] - px['minX']) if px else 1.0,
    'posterPlane': px,
    'bodies': {'count': NB, 'vertices': vtot, 'triangles': itot // 3, 'sourceTriangles': tri_total,
               'geometry': bodies_geo, 'positionDecode': 'p = boundsMin + (q + 32768) / 65535 * boundsExtent (per object, objectBounds = min xyz, extent xyz)',
               'normalDecode': 'int8 / 127', 'uvDecode': 'uint16 / 65535 (Blender UV convention, v up = three.js default flipY=true images)',
               'colorEncoding': 'Personal RGB, sRGB-encoded uint8 (decode to linear in shader)',
               'mixIdNote': '0 = atlas only; k = personal mix material k (factor in anim personalMix[:, k-1])',
               'material': {'type': 'principled', 'roughness': 0.38, 'metallic': 0.0, 'specularIOR': 1.5},
               'names': [o.name for o in bodies]},
    'tips': {'count': NT, 'geometry': tips_geo, 'colors': [emission_rgb(m) for m in tip_mats], 'colorSpace': 'linear', 'shading': 'emission + alpha', 'names': [o.name for o in tips]},
    'lines': {'count': NL, 'colors': [emission_rgb(m) for m in line_mats], 'colorSpace': 'linear', 'radius': [o.data.bevel_depth for o in lines],
              'mapping': 'SPLINE (arc length) for start/end', 'names': [o.name for o in lines],
              'kinds': ['membership' if '→ 팀' in o.name else ('satellite' if '위성' in o.name else 'ring') for o in lines]},
    'personalMix': {'count': NM, 'materials': [m.name for m in mix_mats]},
    'animation': anim,
    'images': images,
    'boundsOverAnimation': {'min': lo_b.tolist(), 'max': hi_b.tolist()},
    'lighting': {'world': 'uniform gray 0.065 x 0.65', 'lights': lights, 'viewTransform': sc.view_settings.view_transform},
    'camera': {'lensMm': sc.camera.data.lens, 'sensor': [sc.camera.data.sensor_width, sc.camera.data.sensor_height, sc.camera.data.sensor_fit],
               'position': list(sc.camera.matrix_world.translation), 'resolution': [sc.render.resolution_x, sc.render.resolution_y]},
    'scaleAnisotropyMax': aniso,
}
json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), ensure_ascii=False, indent=1)
print(f'EXPORT OK {time.time()-t0:.0f}s -> {OUT}')
