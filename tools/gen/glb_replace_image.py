#!/usr/bin/env python3
"""Replace one embedded image of a GLB.

  glb_replace_image.py <in.glb> <out.glb> <image name or index> <new image file>

Used to put a re-baked normal map (tools/blender/bake_normals.py) into a character without a
round trip through Blender, which would re-export the rig and clips. `normal` as the image
selects the image the first material's normalTexture points at.
"""
import json, struct, sys, mimetypes

src, dst, which, new_path = sys.argv[1:5]
d = open(src, "rb").read()
assert d[:4] == b"glTF", "not a GLB"
jl = struct.unpack("<I", d[12:16])[0]
j = json.loads(d[20:20 + jl])
bl = struct.unpack("<I", d[20 + jl:24 + jl])[0]
b = d[28 + jl:28 + jl + bl]
if which == "normal":
    idx = j["textures"][j["materials"][0]["normalTexture"]["index"]]["source"]
elif which.isdigit():
    idx = int(which)
else:
    idx = next(i for i, im in enumerate(j["images"]) if im.get("name") == which)
new = open(new_path, "rb").read()
target = j["images"][idx]["bufferView"]
assert sum(1 for im in j["images"] if im.get("bufferView") == target) == 1, "image data is shared"
out = bytearray()
for i in sorted(range(len(j["bufferViews"])), key=lambda i: j["bufferViews"][i].get("byteOffset", 0)):
    v = j["bufferViews"][i]
    o = v.get("byteOffset", 0)
    data = new if i == target else b[o:o + v["byteLength"]]
    out += b"\0" * (-len(out) % 4)
    v["byteOffset"] = len(out); v["byteLength"] = len(data)
    out += data
out += b"\0" * (-len(out) % 4)
j["buffers"][0]["byteLength"] = len(out)
j["images"][idx]["mimeType"] = mimetypes.guess_type(new_path)[0] or "image/png"
js = json.dumps(j, separators=(",", ":")).encode()
js += b" " * (-len(js) % 4)
with open(dst, "wb") as f:
    f.write(b"glTF" + struct.pack("<II", 2, 28 + len(js) + len(out)))
    f.write(struct.pack("<I", len(js)) + b"JSON" + js)
    f.write(struct.pack("<I", len(out)) + b"BIN\0" + bytes(out))
print(f"replaced image {idx} ({len(new)} bytes) -> {dst}")
