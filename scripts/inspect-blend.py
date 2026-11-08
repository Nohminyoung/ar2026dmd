"""Inspect the source .blend (read-only) and write a JSON report.

Usage (either):
  blender --background --disable-autoexec input/<file>.blend --python scripts/inspect-blend.py -- --out qa/inspect-report.json [--images-out public/assets/packed]
  python -I scripts/inspect-blend.py -- --blend input/<file>.blend --out qa/inspect-report.json   (bpy module)

The source file is never saved.
"""
import bpy, sys, json, hashlib, os, collections, argparse

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--blend'); ap.add_argument('--out', required=True); ap.add_argument('--images-out')
a = ap.parse_args(argv)
if a.blend:
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a.blend), load_ui=False, use_scripts=False)
path = bpy.data.filepath
sha = hashlib.sha256(open(path, 'rb').read()).hexdigest()
sc = bpy.context.scene
r = sc.render

def fcurves_of(act):
    out = []
    for l in getattr(act, 'layers', []):
        for st in l.strips:
            for cb in st.channelbags:
                out += list(cb.fcurves)
    return out

def anim_info(idb):
    ad = getattr(idb, 'animation_data', None)
    if not ad: return None
    info = {}
    if ad.action:
        fc = fcurves_of(ad.action)
        info['action'] = ad.action.name
        info['paths'] = sorted({f.data_path for f in fc})
        info['keys'] = max((len(f.keyframe_points) for f in fc), default=0)
    if len(ad.nla_tracks):
        info['nla'] = [{'track': t.name, 'strips': [(s.action.name if s.action else None, round(s.frame_start, 2), round(s.frame_end, 2), round(s.scale, 3)) for s in t.strips]} for t in ad.nla_tracks]
    if len(ad.drivers): info['drivers'] = len(ad.drivers)
    return info or None

rep = {
    'blenderVersion': bpy.app.version_string,
    'fileVersion': list(bpy.data.version),
    'file': os.path.basename(path), 'sha256': sha,
    'scene': {
        'name': sc.name, 'frameStart': sc.frame_start, 'frameEnd': sc.frame_end,
        'fps': r.fps, 'fpsBase': r.fps_base,
        'timeRemap': {'old': r.frame_map_old, 'new': r.frame_map_new},
        'resolution': [r.resolution_x, r.resolution_y, r.resolution_percentage],
        'engine': r.engine, 'motionBlur': r.use_motion_blur,
        'unitSystem': sc.unit_settings.system, 'scaleLength': sc.unit_settings.scale_length,
        'camera': sc.camera.name if sc.camera else None,
        'customProps': {k: (v if isinstance(v, (int, float, str)) else str(v)) for k, v in sc.items()},
        'markers': sorted([(m.frame, m.name) for m in sc.timeline_markers]),
    },
}
cam = sc.camera
if cam:
    rep['camera'] = {'type': cam.data.type, 'lens': cam.data.lens, 'sensor': [cam.data.sensor_width, cam.data.sensor_height, cam.data.sensor_fit],
                     'location': list(cam.matrix_world.translation), 'rotationEuler': list(cam.matrix_world.to_euler())}

def walk(c):
    return {'name': c.name, 'objects': len(c.objects), 'hideRender': c.hide_render, 'children': [walk(ch) for ch in c.children]}
rep['collections'] = walk(sc.collection)

types = collections.Counter(o.type for o in bpy.data.objects)
rep['objectTypes'] = dict(types)
kinds = collections.Counter()
props = collections.Counter()
for o in bpy.data.objects:
    for k in o.keys(): props[k] += 1
    if 'export_kind' in o: kinds[str(o['export_kind'])] += 1
rep['objectCustomProps'] = dict(props)
rep['exportKinds'] = dict(kinds)

tri = 0; verts = 0; uv_layers = collections.Counter(); color_attrs = collections.Counter(); mesh_objs = 0
for o in bpy.data.objects:
    if o.type != 'MESH': continue
    mesh_objs += 1
    me = o.data
    verts += len(me.vertices)
    tri += sum(len(p.vertices) - 2 for p in me.polygons)
    for u in me.uv_layers: uv_layers[u.name] += 1
    for ca in me.color_attributes: color_attrs[f'{ca.name}:{ca.domain}:{ca.data_type}'] += 1
rep['meshes'] = {'objects': mesh_objs, 'uniqueMeshData': len({o.data.name for o in bpy.data.objects if o.type == 'MESH'}),
                 'vertices': verts, 'triangles': tri, 'uvLayers': dict(uv_layers), 'colorAttributes': dict(color_attrs)}

curves = [o for o in bpy.data.objects if o.type == 'CURVE']
rep['curves'] = {
    'count': len(curves),
    'withConnectionIndex': sum(1 for o in curves if 'connection_index' in o),
    'controlObjects': [o.name for o in curves if o.name.startswith('◆')],
    'byCollection': dict(collections.Counter(o.users_collection[0].name for o in curves)),
    'sample': [{'name': o.name, 'splines': len(o.data.splines), 'points': [len(s.bezier_points) for s in o.data.splines],
                'bevelDepth': o.data.bevel_depth, 'mapping': [o.data.bevel_factor_mapping_start, o.data.bevel_factor_mapping_end],
                'objectAnim': anim_info(o), 'dataAnim': anim_info(o.data),
                'materials': [m.name for m in o.data.materials if m]} for o in curves[:2] + [c for c in curves if '위성' in c.name][:1] + [c for c in curves if c.name.startswith('◆')][:1]],
}
rep['connectionTips'] = sum(1 for o in bpy.data.objects if 'connection_tip' in o)

mat_nodes = collections.Counter(); mat_anim = 0
for m in bpy.data.materials:
    if m.node_tree:
        for n in m.node_tree.nodes: mat_nodes[n.name if n.name in ('Animated opacity', 'Personal mix from approved motion') else n.type] += 1
        if m.node_tree.animation_data and m.node_tree.animation_data.action: mat_anim += 1
rep['materials'] = {'count': len(bpy.data.materials), 'animatedNodeTrees': mat_anim, 'nodes': dict(mat_nodes.most_common(25))}

imgs = []
for im in bpy.data.images:
    e = {'name': im.name, 'size': list(im.size), 'source': im.source, 'packed': bool(im.packed_file),
         'filepath': im.filepath, 'colorspace': im.colorspace_settings.name}
    if im.packed_file and a.images_out:
        os.makedirs(a.images_out, exist_ok=True)
        data = im.packed_file.data
        ext = os.path.splitext(im.filepath or im.name)[1] or '.bin'
        fn = os.path.join(a.images_out, ''.join(ch if ch.isalnum() or ch in '._-' else '_' for ch in im.name) + ('' if im.name.lower().endswith(ext.lower()) else ext))
        open(fn, 'wb').write(data)
        e['extracted'] = fn; e['bytes'] = len(data); e['sha256'] = hashlib.sha256(data).hexdigest()
    imgs.append(e)
rep['images'] = imgs

anim_objs = sum(1 for o in bpy.data.objects if o.animation_data and o.animation_data.action)
rep['animation'] = {
    'objectsWithAction': anim_objs,
    'objectsWithHideRenderAnim': sum(1 for o in bpy.data.objects if o.animation_data and o.animation_data.action and any(f.data_path == 'hide_render' for f in fcurves_of(o.animation_data.action))),
    'curveDataWithNLA': sum(1 for o in curves if o.data.animation_data and len(o.data.animation_data.nla_tracks)),
    'actions': len(bpy.data.actions),
    'parents': dict(collections.Counter(o.parent.name if o.parent else None for o in bpy.data.objects).most_common(5)),
}
pa = bpy.data.objects.get('전체 애니메이션 · 좌표 기준')
if pa:
    import mathutils
    rep['animation']['rootEmptyIsIdentity'] = pa.matrix_world == mathutils.Matrix.Identity(4) and pa.animation_data is None
rep['texts'] = [t.name for t in bpy.data.texts]
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
json.dump(rep, open(a.out, 'w'), ensure_ascii=False, indent=1)
print('INSPECT OK ->', a.out)
