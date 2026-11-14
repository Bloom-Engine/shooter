"""Process one raw generated asset into a game-ready GLB.

  blender -b -P tools/blender/process.py -- <asset-name>

Reads art/assets.json[<asset-name>]:
  source, height_m, tris, bake, material, collision
Steps: import dense source -> clear parents, apply transforms -> scale to height_m,
origin at base centre -> decimated copy at the triangle budget -> smart UV unwrap ->
Cycles bake (tangent normal from dense; albedo too if the source has a colour texture)
-> convex collision hull -> export:
  assets/<name>/<name>.glb        render mesh (+ baked textures embedded)
  assets/<name>/<name>_col.glb    collision hull (only when collision == convex)
  assets/<name>/<name>.report.json
"""
import bpy, bmesh, sys, json, math, os
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
name = sys.argv[sys.argv.index("--") + 1]
spec = json.load(open(os.path.join(ROOT, "art/assets.json")))[name]
out_dir = os.path.join(ROOT, "assets", name)
os.makedirs(out_dir, exist_ok=True)

# Flat base colours (sRGB hex) used when the source has no colour texture.
PALETTE = {
    "m_clay": "a8603e", "m_wood_dry": "8c7458", "m_wood_wet": "4a3a30", "m_canvas": "d8c8a8",
    "m_rope": "a88a5c", "m_wool": "7a2e2a", "m_linen": "d9c9a6", "m_bronze": "6b5536",
    "m_stone": "c8b89a", "m_pitch": "1c1816",
}
ROUGH = {"m_bronze": 0.45, "m_pitch": 0.35}


def srgb(hexs):
    c = [int(hexs[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def only_select(*obs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]


bpy.ops.wm.read_factory_settings(use_empty=True)
src = os.path.join(ROOT, "art/source", spec["source"])
if src.endswith(".fbx"):
    bpy.ops.import_scene.fbx(filepath=src)
else:
    bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
only_select(*meshes)
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
for o in [o for o in bpy.context.scene.objects if o.type != "MESH"]:
    bpy.data.objects.remove(o)
if len(meshes) > 1:
    bpy.ops.object.join()
hi = bpy.context.view_layer.objects.active
hi.name = name + "_hi"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Scale to height, origin at base centre (Blender is Z-up; the glTF exporter converts to Y-up).
co = [v.co for v in hi.data.vertices]
lo_b = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
hi_b = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
s = spec["height_m"] / (hi_b.z - lo_b.z)
base = Vector(((lo_b.x + hi_b.x) / 2, (lo_b.y + hi_b.y) / 2, lo_b.z))
hi.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-base))
hi.data.update()
src_tris = tri_count(hi)

has_albedo = any(n.type == "TEX_IMAGE" and n.image for m in hi.data.materials if m and m.use_nodes for n in m.node_tree.nodes)

# Low-poly copy.
lo = hi.copy(); lo.data = hi.data.copy(); lo.name = name
bpy.context.scene.collection.objects.link(lo)
only_select(lo)
if src_tris > spec["tris"]:
    d = lo.modifiers.new("dec", "DECIMATE")
    d.ratio = spec["tris"] / src_tris
    d.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier="dec")
bpy.ops.object.shade_smooth()
for uv in list(lo.data.uv_layers):
    lo.data.uv_layers.remove(uv)
lo.data.uv_layers.new(name="UVMap")
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01)
bpy.ops.object.mode_set(mode="OBJECT")

# Material with bake targets.
lo.data.materials.clear()
mat = bpy.data.materials.new(spec["material"])
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = ROUGH.get(spec["material"], 0.8)
size = spec["bake"]
img_n = bpy.data.images.new(name + "_normal", size, size)
img_n.colorspace_settings.name = "Non-Color"
tex_n = nt.nodes.new("ShaderNodeTexImage"); tex_n.image = img_n
nmap = nt.nodes.new("ShaderNodeNormalMap")
nt.links.new(tex_n.outputs["Color"], nmap.inputs["Color"])
nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
tex_c = None
if has_albedo:
    img_c = bpy.data.images.new(name + "_albedo", size, size)
    tex_c = nt.nodes.new("ShaderNodeTexImage"); tex_c.image = img_c
    nt.links.new(tex_c.outputs["Color"], bsdf.inputs["Base Color"])
else:
    bsdf.inputs["Base Color"].default_value = srgb(PALETTE.get(spec["material"], "808080"))
lo.data.materials.append(mat)

# Bake dense -> low.
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = 4
sc.cycles.device = "CPU"
ext = max(hi.dimensions) * 0.03
bk = sc.render.bake
bk.use_selected_to_active = True
bk.cage_extrusion = ext
bk.max_ray_distance = ext * 6
bk.margin = 8
only_select(hi, lo, active=lo)
nt.nodes.active = tex_n
bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT")
if tex_c:
    nt.nodes.active = tex_c
    bk.use_pass_direct = False; bk.use_pass_indirect = False; bk.use_pass_color = True
    bpy.ops.object.bake(type="DIFFUSE")
for img in [img_n] + ([tex_c.image] if tex_c else []):
    img.filepath_raw = os.path.join(out_dir, img.name + ".png")
    img.file_format = "PNG"
    img.save()

report = {"name": name, "source": spec["source"], "source_tris": src_tris, "tris": tri_count(lo),
          "height_m": spec["height_m"], "albedo_baked": bool(tex_c), "bake": size}

# Collision hull.
col = None
if spec.get("collision") == "convex":
    # Hull of a coarse proxy: decimate a copy to ~96 tris first, then take the convex hull.
    proxy = lo.copy(); proxy.data = lo.data.copy(); sc.collection.objects.link(proxy)
    only_select(proxy)
    d = proxy.modifiers.new("dec", "DECIMATE"); d.ratio = min(1.0, 96 / max(1, tri_count(proxy)))
    bpy.ops.object.modifier_apply(modifier="dec")
    bm = bmesh.new(); bm.from_mesh(proxy.data)
    res = bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.delete(bm, geom=[g for g in res["geom_interior"] + res["geom_unused"] if isinstance(g, bmesh.types.BMVert)], context="VERTS")
    bmesh.ops.triangulate(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name + "_col"); bm.to_mesh(me); bm.free()
    bpy.data.objects.remove(proxy)
    col = bpy.data.objects.new(name + "_col", me); sc.collection.objects.link(col)
    report["collision_tris"] = tri_count(col)

bpy.data.objects.remove(hi)


def export(ob, path):
    only_select(ob)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_image_format="AUTO", export_materials="EXPORT" if ob is lo else "NONE")


export(lo, os.path.join(out_dir, name + ".glb"))
if col:
    export(col, os.path.join(out_dir, name + "_col.glb"))
json.dump(report, open(os.path.join(out_dir, name + ".report.json"), "w"), indent=2)
print("REPORT", json.dumps(report))
