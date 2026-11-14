"""Re-seat a mesh that an auto-rigger fitted BACKWARDS into its skeleton, and re-skin it.

  blender -b -P tools/blender/reskin_flip.py -- in.glb out.glb [--auto]

Symptom (Jonah, Tripo v3 rig): the skeleton's front (hips, shoulders, toe bones) is the mesh's back.
Turning the whole character 180 degrees fixes the torso but not the joints: knees and ankles still
bend the wrong way (feet point backwards on the ladder). Fix: in the rest pose, turn only the MESH
180 degrees about the vertical axis through the hips, so its face lies along the skeleton's front,
then bind it again, keeping the rigger's weights with Left/Right swapped (--auto: heat weights). Bones and animation clips stay untouched.
"""
import bpy, sys, math
from mathutils import Matrix, Vector

a = sys.argv[sys.argv.index("--") + 1:]
src, dst = a[0], a[1]
AUTO = "--auto" in a   # recompute weights (heat) instead of keeping the rigger's mirrored ones
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

for o in list(bpy.context.scene.objects):   # Tripo leaves a helper sphere in rigged files
    if o.type == "MESH" and o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
arm.data.pose_position = "REST"
bpy.context.view_layer.update()

# Pivot: the hips bone head in world space (vertical axis through the body).
hips = next(b for b in arm.data.bones if b.name.endswith("Hips"))
pivot = arm.matrix_world @ hips.head_local
turn = Matrix.Translation(Vector((pivot.x, pivot.y, 0.0))) @ Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Translation(Vector((-pivot.x, -pivot.y, 0.0)))

for m in meshes:
    # Unbind: keep the world transform, drop the armature modifier and the old weights.
    mw = m.matrix_world.copy()
    m.parent = None
    m.matrix_world = mw
    for mod in list(m.modifiers):
        if mod.type == "ARMATURE":
            m.modifiers.remove(mod)
    if AUTO:
        m.vertex_groups.clear()
    else:
        # Keep the rigger's weights. Turned 180 degrees, the mesh's right leg lies where the skeleton's
        # Right bones are, but it is weighted to the Left ones: swap Left/Right group names.
        for vg in m.vertex_groups:
            if "Left" in vg.name:
                vg.name = vg.name.replace("Left", "@@")
        for vg in m.vertex_groups:
            if "Right" in vg.name:
                vg.name = vg.name.replace("Right", "Left")
        for vg in m.vertex_groups:
            if "@@" in vg.name:
                vg.name = vg.name.replace("@@", "Right")
    # Turn the mesh data itself in world space.
    m.data.transform(m.matrix_world)
    m.matrix_world = Matrix.Identity(4)
    m.data.transform(turn)
    m.data.update()

# Bind again with automatic (heat) weights.
bpy.ops.object.select_all(action="DESELECT")
for m in meshes:
    m.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type="ARMATURE_AUTO" if AUTO else "ARMATURE_NAME")
for m in meshes:
    n = sum(1 for v in m.data.vertices if len(v.groups) == 0)
    print("RESKIN", m.name, "verts", len(m.data.vertices), "unweighted", n)

arm.data.pose_position = "POSE"
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_yup=True, export_skins=True,
                          export_animations=True, export_animation_mode="ACTIONS")
print("RESEATED", dst)
