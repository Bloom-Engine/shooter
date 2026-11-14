"""Turn a dense Tripo Studio mesh (about 2M triangles, PBR textures) into a static game model.

  blender -b -P tools/blender/process_static.py -- <in.glb> <out.glb> --kind prop|weapon
        --size <metres> [--tris 20000] [--bake 4096] [--yaw <deg>] [--flip] [--long x|z] [--length <m>]

Steps: import -> join, apply transforms -> orient and scale -> decimated copy at the triangle
budget -> smart UV unwrap -> Cycles bakes from the dense mesh onto the new UVs:
tangent normal (geometry + the source normal map), base colour, roughness, metallic ->
one material with base colour, normal and a glTF metallic-roughness map -> export GLB.

Base colour, roughness and metallic are baked as EMISSION from the source textures: a DIFFUSE
bake of a metallic surface is black, and Cycles has no metallic bake pass.

Conventions the shooter's code relies on (see CLAUDE.md "Asset pipeline"):
  prop    origin at the centre of the base, +Y up, --size is the HEIGHT in metres. Props are drawn
          without rotation, so author the final facing here with --yaw (degrees about the vertical).
          --long x|z turns the prop a quarter turn if needed so its longer side runs along that
          glTF axis (tables and beds must match the box colliders authored in the world files).
          --length <m> stretches that longer side to a given length independently of the height,
          for the case where the generator foreshortened a long object (the cot came out 1.2 m).
  weapon  barrel along glTF +Z (Blender -Y), +Y up, the REARMOST point at z = 0 and the model
          centred left-right; --size is the LENGTH in metres. The concept shows the gun in profile
          with the barrel to the right, and Tripo keeps that view as the model's front, so the
          barrel comes in along Blender +X: it is turned to -Y here. --flip turns it end for end
          if a mesh arrives with the barrel pointing the other way.
No vertex colours are exported (the engine multiplies COLOR_0 into albedo).
"""
import bpy, sys, math, os
from mathutils import Vector, Matrix

a = sys.argv[sys.argv.index("--") + 1:]
src, dst = a[0], a[1]
opt = lambda k, d: type(d)(a[a.index(k) + 1]) if k in a else d
kind, size, tris, bake = opt("--kind", "prop"), opt("--size", 1.0), opt("--tris", 20000), opt("--bake", 4096)
yaw, flip, long_axis = opt("--yaw", 0.0), "--flip" in a, opt("--long", "")
length = opt("--length", 0.0)
name = os.path.splitext(os.path.basename(dst))[0]


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def only_select(*obs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.name.startswith("Icosphere")]
only_select(*meshes)
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
for o in [o for o in bpy.context.scene.objects if o not in meshes]:
    bpy.data.objects.remove(o)
if len(meshes) > 1:
    bpy.ops.object.join()
hi = bpy.context.view_layer.objects.active
hi.name = name + "_hi"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for ca in list(hi.data.color_attributes):
    hi.data.color_attributes.remove(ca)

# Orient.
rot = Matrix.Identity(4)
if kind == "weapon":
    # Barrel from Blender +X to Blender -Y (glTF +Z): -90 degrees about Z. --flip: +90 instead.
    rot = Matrix.Rotation(math.radians(90 if flip else -90), 4, "Z")
if kind == "prop" and long_axis:
    d = hi.dimensions            # Blender X = glTF X, Blender Y = glTF -Z
    if (long_axis == "x") != (d.x >= d.y):
        rot = Matrix.Rotation(math.radians(90), 4, "Z")
rot = Matrix.Rotation(math.radians(yaw), 4, "Z") @ rot
hi.data.transform(rot)

co = [v.co for v in hi.data.vertices]
lo_b = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
hi_b = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
if kind == "weapon":
    s = size / (hi_b.y - lo_b.y)
    # Rear of the gun (Blender +Y end, since the barrel points to -Y) at the origin; centred in X;
    # the origin sits 30 % below the top of the bounding box, about on the line of the barrel, so the
    # grip and magazine hang below the point the game places at the hand (as the old models did).
    origin = Vector(((lo_b.x + hi_b.x) / 2, hi_b.y, hi_b.z - 0.3 * (hi_b.z - lo_b.z)))
else:
    s = size / (hi_b.z - lo_b.z)
    origin = Vector(((lo_b.x + hi_b.x) / 2, (lo_b.y + hi_b.y) / 2, lo_b.z))
hi.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-origin))
if kind == "prop" and length > 0:
    ex, ey = (hi_b.x - lo_b.x) * s, (hi_b.y - lo_b.y) * s
    axis = Vector((1, 0, 0)) if ex >= ey else Vector((0, 1, 0))
    hi.data.transform(Matrix.Scale(length / max(ex, ey), 4, axis))
hi.data.update()
src_tris = tri_count(hi)
print("STATIC", name, kind, "source tris", src_tris, "scale", round(s, 4), "dims", [round(d, 3) for d in hi.dimensions])

# Low-poly copy with fresh UVs.
lo = hi.copy(); lo.data = hi.data.copy(); lo.name = name
bpy.context.scene.collection.objects.link(lo)
only_select(lo)
if src_tris > tris:
    d = lo.modifiers.new("dec", "DECIMATE")
    d.ratio = tris / src_tris
    d.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier="dec")
bpy.ops.object.shade_smooth()
for uv in list(lo.data.uv_layers):
    lo.data.uv_layers.remove(uv)
lo.data.uv_layers.new(name="UVMap")
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")


# Source channels on the dense mesh: (colour socket | default) per material.
def source_of(mat, socket):
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        return None, None, None
    inp = bsdf.inputs[socket]
    return bsdf, (inp.links[0].from_socket if inp.links else None), inp.default_value


def emit_channel(socket):
    """Rewire every dense-mesh material to emit one channel; returns an undo function."""
    undo = []
    for mat in [m for m in hi.data.materials if m and m.use_nodes]:
        nt = mat.node_tree
        bsdf, link, default = source_of(mat, socket)
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        old = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].links else None
        em = nt.nodes.new("ShaderNodeEmission")
        if link is not None:
            nt.links.new(link, em.inputs["Color"])
        else:
            v = default if hasattr(default, "__len__") else (default, default, default, 1.0)
            em.inputs["Color"].default_value = tuple(v)[:3] + (1.0,)
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
        undo.append((nt, em, old, out))

    def restore():
        for nt, em, old, out in undo:
            if old is not None:
                nt.links.new(old, out.inputs["Surface"])
            nt.nodes.remove(em)
    return restore


# Bake targets on the low mesh.
lo.data.materials.clear()
mat = bpy.data.materials.new(name)
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]


def target(suffix, colour):
    img = bpy.data.images.new(f"{name}_{suffix}", bake, bake, alpha=False)
    if not colour:
        img.colorspace_settings.name = "Non-Color"
    node = nt.nodes.new("ShaderNodeTexImage"); node.image = img
    return img, node


img_n, tex_n = target("normal", False)
img_c, tex_c = target("basecolor", True)
img_r, tex_r = target("rough", False)
img_m, tex_m = target("metal", False)
lo.data.materials.append(mat)

sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = 4
sc.cycles.device = "CPU"
ext = max(hi.dimensions) * 0.02
bk = sc.render.bake
bk.use_selected_to_active = True
bk.cage_extrusion = ext
bk.max_ray_distance = ext * 4
bk.margin = 16


def bake_to(node, btype, **kw):
    only_select(hi, lo, active=lo)
    nt.nodes.active = node
    bpy.ops.object.bake(type=btype, **kw)


bake_to(tex_n, "NORMAL", normal_space="TANGENT")
for socket, node in (("Base Color", tex_c), ("Roughness", tex_r), ("Metallic", tex_m)):
    restore = emit_channel(socket)
    bake_to(node, "EMIT")
    restore()

# glTF metallic-roughness texture: G = roughness, B = metallic (R unused, kept white).
n = bake * bake
r = [0.0] * (n * 4); img_r.pixels.foreach_get(r)
m = [0.0] * (n * 4); img_m.pixels.foreach_get(m)
orm = [1.0] * (n * 4)
orm[1::4] = r[0::4]
orm[2::4] = m[0::4]
img_orm = bpy.data.images.new(f"{name}_rm", bake, bake, alpha=False)
img_orm.colorspace_settings.name = "Non-Color"
img_orm.pixels.foreach_set(orm)
tex_orm = nt.nodes.new("ShaderNodeTexImage"); tex_orm.image = img_orm
sep = nt.nodes.new("ShaderNodeSeparateColor")
nt.links.new(tex_orm.outputs["Color"], sep.inputs["Color"])
nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
nt.links.new(tex_c.outputs["Color"], bsdf.inputs["Base Color"])
nmap = nt.nodes.new("ShaderNodeNormalMap")
nt.links.new(tex_n.outputs["Color"], nmap.inputs["Color"])
nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
for node in (tex_r, tex_m):
    nt.nodes.remove(node)
tmp = os.path.join(bpy.app.tempdir, name)
for img in (img_n, img_c, img_orm):
    img.filepath_raw = f"{tmp}_{img.name}.png"; img.file_format = "PNG"; img.save()

bpy.data.objects.remove(hi)
only_select(lo)
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                          export_image_format="JPEG", export_jpeg_quality=92, export_materials="EXPORT",
                          export_vertex_color="NONE", export_tangents=True)
co = [v.co for v in lo.data.vertices]
print("STATIC wrote", dst, "tris", tri_count(lo), "bbox(blender)",
      [round(min(c[i] for c in co), 3) for i in range(3)], [round(max(c[i] for c in co), 3) for i in range(3)])
