"""Rotate an asset about the vertical axis so it faces the glTF front (+Z) and drop stray helper meshes.

  blender -b -P tools/blender/face_front.py -- in.glb out.glb <deg> [--drop Name ...]

Works on skinned files: rotates the armature/root objects and re-exports with skin and animations.
"""
import bpy, sys, math
a = sys.argv[sys.argv.index("--") + 1:]
src, dst, deg = a[0], a[1], float(a[2])
drop = a[a.index("--drop") + 1:] if "--drop" in a else []
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in list(bpy.context.scene.objects):
    if any(o.name.startswith(d) for d in drop):
        bpy.data.objects.remove(o)
roots = [o for o in bpy.context.scene.objects if o.parent is None]
for o in roots:
    o.rotation_mode = "XYZ"
    o.rotation_euler.z += math.radians(deg)
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = roots[0]
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_yup=True, export_skins=True, export_animations=True)
print("FACED", dst, deg, "dropped", drop)
