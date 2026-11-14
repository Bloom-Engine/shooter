"""blender -b -P tools/blender/inspect.py -- in.glb out.png : print stats, render a clay turntable still."""
import bpy, sys, math, mathutils
argv = sys.argv[sys.argv.index("--") + 1:]
src, png = argv[0], argv[1]
keep = "--keep" in argv
yaw = float(argv[argv.index("--yaw")+1]) if "--yaw" in argv else 0.0
bpy.ops.wm.read_factory_settings(use_empty=True)
if src.endswith(".fbx"):
    bpy.ops.import_scene.fbx(filepath=src)
else:
    bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
tris = quads = ngons = verts = 0
lo = mathutils.Vector((1e9,) * 3); hi = -lo
for o in meshes:
    me = o.data; verts += len(me.vertices)
    for p in me.polygons:
        n = len(p.vertices); tris += n == 3; quads += n == 4; ngons += n > 4
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c); lo = mathutils.Vector(map(min, lo, w)); hi = mathutils.Vector(map(max, hi, w))
size = hi - lo
print(f"STATS objects={len(meshes)} verts={verts} tris={tris} quads={quads} ngons={ngons} "
      f"size=({size.x:.3f},{size.y:.3f},{size.z:.3f}) uv={[len(o.data.uv_layers) for o in meshes]} "
      f"materials={[s.material.name if s.material else None for o in meshes for s in o.material_slots]}")
clay = bpy.data.materials.new("clay"); clay.use_nodes = True
clay.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.62, 0.45, 0.32, 1)
for o in meshes:
    if not keep:
        o.data.materials.clear(); o.data.materials.append(clay)
center = (lo + hi) / 2; r = max(size) * 1.6
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); bpy.context.scene.collection.objects.link(cam)
off = mathutils.Matrix.Rotation(math.radians(yaw), 3, "Z") @ mathutils.Vector((r * 0.8, -r, r * 0.5))
cam.location = center + off
cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
bpy.context.scene.camera = cam
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 4
sun.rotation_euler = (math.radians(50), 0, math.radians(30)); bpy.context.scene.collection.objects.link(sun)
w = bpy.data.worlds.new("w"); w.use_nodes = True; w.node_tree.nodes["Background"].inputs[0].default_value = (0.25, 0.27, 0.3, 1)
s = bpy.context.scene; s.world = w; s.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
s.render.resolution_x = s.render.resolution_y = 768; s.render.filepath = png
s.view_settings.view_transform = "Standard"
bpy.ops.render.render(write_still=True)
