"""Render reference stills (no save of the source). bpy module or blender --background.
python -I scripts/render-reference.py -- input/<file>.blend qa/reference 1,40,84 50 32"""
import bpy, sys, os
a=sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a[0]), load_ui=False, use_scripts=False)
out=a[1]; frames=[int(x) for x in a[2].split(',')]; pct=int(a[3]); spp=int(a[4])
os.makedirs(out,exist_ok=True)
sc=bpy.context.scene; sc.render.resolution_percentage=pct; sc.cycles.samples=spp
sc.render.image_settings.file_format='PNG'
for f in frames:
    sc.frame_set(f); sc.render.filepath=os.path.abspath(f"{out}/ref_{f:03d}.png"); bpy.ops.render.render(write_still=True)
print("REF DONE")
