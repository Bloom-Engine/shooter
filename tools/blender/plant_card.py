"""Photograph a scanned plant onto one RGBA card for src/flora.ts.

  blender -b -P tools/blender/plant_card.py -- <in.gltf> <out.png> --pick <name part>[,<name part>...]
        [--size 1024] [--gain 1.0] [--gap 0.02]

The source is a Poly Haven plant set (CC0): several small meshes in a row, each a real plant
built from photographed leaves. The named ones are stood side by side (touching, `--gap` metres
apart) and rendered straight from the side, orthographic, with no lighting of their own: the
picture is the leaves' photographed colour, darkened only where leaves crowd each other (a short
ambient-occlusion probe), because the game's card shader lights it again. The texture is square but the
frame hugs the plants (so the picture is stretched), and they stand on its bottom edge, centred: what `buildFan` in src/flora.ts expects.

Prints the frame's size in metres, which is the card size to give `buildFan`.
"""
import bpy, sys, os
import numpy as np
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
src, dst = os.path.abspath(a[0]), os.path.abspath(a[1])
opt = lambda k, d: type(d)(a[a.index(k) + 1]) if k in a else d
picks = opt("--pick", "").split(",")
SIZE, GAIN, GAP = opt("--size", 1024), opt("--gain", 1.0), opt("--gap", 0.02)
AO_DIST, AO_MIN = opt("--ao", 0.04), opt("--ao-min", 0.45)   # a whole tree wants metres and a deeper floor
ALPHA = opt("--alpha", "")     # Poly Haven's glTF packages leave the cut-out map out; it is a separate download

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
allm = [o for o in scene.objects if o.type == "MESH"]
chosen = []
for p in picks:
    m = [o for o in allm if p in o.name]
    assert m, "no mesh named like %r in %s" % (p, [o.name for o in allm])
    chosen.append(m[0])
for o in allm:
    o.hide_render = o not in chosen


def bounds(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))), \
           Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))


x = 0.0
for o in chosen:                                   # side by side along X, each standing on z = 0
    lo, hi = bounds(o)
    o.location.x += x - lo.x
    o.location.y -= (lo.y + hi.y) / 2
    o.location.z -= lo.z
    x += (hi.x - lo.x) + GAP
bpy.context.view_layer.update()
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in chosen:
    l, h = bounds(o)
    lo = Vector(map(min, lo, l)); hi = Vector(map(max, hi, h))
TOP = "--top" in a           # seen from straight above: ground litter, laid flat by src/flora.ts
fw, fh = (hi.x - lo.x) * 1.03, ((hi.y - lo.y) if TOP else (hi.z - lo.z)) * 1.03      # the frame hugs the plants: a card need not be square
print("CARD %s: plants %.2f m wide, %.2f m tall; card %.3f m wide x %.3f m tall" % (os.path.basename(dst), hi.x - lo.x, hi.z - lo.z, fw, fh))

for o in chosen:
    for slot in o.material_slots:
        src_m = slot.material
        img = None; alpha_img = None; alpha_out = "Alpha"
        for n in src_m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED" and n.inputs["Base Color"].links:
                img = n.inputs["Base Color"].links[0].from_node.image
            if n.type == "BSDF_PRINCIPLED" and n.inputs["Alpha"].links:      # the cut-out is often its own map
                l = n.inputs["Alpha"].links[0]
                fn = l.from_node
                while fn.type != "TEX_IMAGE" and any(i.links for i in fn.inputs):
                    l = next(i.links[0] for i in fn.inputs if i.links); fn = l.from_node
                if fn.type == "TEX_IMAGE":
                    alpha_img, alpha_out = fn.image, l.from_socket.name
        m = bpy.data.materials.new(src_m.name + "_flat"); m.use_nodes = True
        nt = m.node_tree; nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = img
        ao = nt.nodes.new("ShaderNodeAmbientOcclusion"); ao.inputs["Distance"].default_value = AO_DIST; ao.samples = 8
        rng = nt.nodes.new("ShaderNodeMapRange"); rng.inputs["To Min"].default_value = AO_MIN
        nt.links.new(ao.outputs["AO"], rng.inputs["Value"])
        mul = nt.nodes.new("ShaderNodeVectorMath"); mul.operation = "SCALE"
        nt.links.new(t.outputs["Color"], mul.inputs[0]); nt.links.new(rng.outputs[0], mul.inputs["Scale"])
        em = nt.nodes.new("ShaderNodeEmission"); nt.links.new(mul.outputs[0], em.inputs["Color"])
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        ta = t
        if ALPHA:
            alpha_img = bpy.data.images.load(os.path.abspath(ALPHA)); alpha_img.colorspace_settings.name = "Non-Color"
            alpha_out = "Color"
        if alpha_img is not None and alpha_img != img:
            ta = nt.nodes.new("ShaderNodeTexImage"); ta.image = alpha_img
        nt.links.new(ta.outputs[alpha_out if alpha_out in ta.outputs else "Alpha"], mix.inputs[0]); nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
        slot.material = m

cam_d = bpy.data.cameras.new("c"); cam_d.type = "ORTHO"; cam_d.ortho_scale = max(fw, fh)
cam = bpy.data.objects.new("c", cam_d); scene.collection.objects.link(cam); scene.camera = cam
cam.location = ((lo.x + hi.x) / 2, -20, fh / 2); cam.rotation_euler = (1.5707963, 0, 0)
if TOP:
    cam.location = ((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, 20); cam.rotation_euler = (0, 0, 0)
w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
scene.render.engine = "CYCLES"; scene.cycles.samples = 64; scene.cycles.use_denoising = False
scene.cycles.transparent_max_bounces = 32
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = SIZE; scene.render.resolution_percentage = 100
# square texture, oblong frame: non-square pixels
# (Blender takes no pixel aspect below 1, so the long side's pixels are made wider.)
if fw >= fh:
    scene.render.pixel_aspect_x, scene.render.pixel_aspect_y = fw / fh, 1.0
else:
    scene.render.pixel_aspect_x, scene.render.pixel_aspect_y = 1.0, fh / fw
scene.render.image_settings.file_format = "OPEN_EXR"; scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "32"
scene.view_settings.view_transform = "Standard"
exr = dst + ".exr"
scene.render.filepath = exr
bpy.ops.render.render(write_still=True)

img = bpy.data.images.load(exr)
px = np.empty(SIZE * SIZE * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(SIZE, SIZE, 4)
al = np.clip(px[..., 3], 0, 1)
rgb = px[..., :3] / np.maximum(al, 1e-4)[..., None] * GAIN
known = al > 0.5
acc = rgb * known[..., None]
for _ in range(64):                               # leaf colour out into the transparent texels
    s = np.zeros_like(acc); c = np.zeros(known.shape, np.float32)
    for ax, sh in ((0, 1), (0, -1), (1, 1), (1, -1)):
        s += np.roll(acc, sh, ax); c += np.roll(known, sh, ax)
    new = (~known) & (c > 0)
    acc[new] = s[new] / c[new][:, None]
    known = known | new
acc[~known] = acc[known].mean(0)
acc = np.clip(acc, 0, 1)
srgb = np.where(acc < 0.0031308, acc * 12.92, 1.055 * acc ** (1 / 2.4) - 0.055)
out_img = bpy.data.images.new("o", SIZE, SIZE, alpha=True)
out_img.pixels.foreach_set(np.dstack([srgb, al]).astype(np.float32).ravel())
out_img.filepath_raw = dst; out_img.file_format = "PNG"; out_img.save()
os.remove(exr)
print("COVERAGE %.0f%%  mean leaf colour (sRGB 0-255) %s" % (100 * (al > 0.5).mean(), (srgb[al > 0.5].mean(0) * 255).round()))
