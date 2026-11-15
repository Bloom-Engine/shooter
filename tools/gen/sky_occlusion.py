#!/usr/bin/env python3
"""Give every material of a GLB a flat glTF occlusion map: how much of the sky the model sees.

  tools/gen/sky_occlusion.py <value 0..1> <model.glb> [<model.glb> ...]

The engine gives a surface the whole sky's diffuse light and mirror reflection unless a glTF
occlusion map says otherwise. A figure standing on the ground, among trees or indoors sees far
less of it, and on a dark material the unoccluded reflection is brighter than the material's own
colour: the Trooper outdoors was a pale blue-grey clay figure, tree bark was ash grey. One grey
value for the whole model takes both down together; the sun, the lamps and the scene's ambient
term are untouched. Re-running replaces the value. Materials that already carry a real occlusion
map are left alone. (tools/blender/tree_from_scan.py does the same for tree wood.)
"""
import json, struct, sys, zlib

value = float(sys.argv[1])


def flat_png(v):
    raw = b"".join(b"\x00" + bytes([v, v, v]) * 4 for _ in range(4))
    chunk = lambda t, c: struct.pack(">I", len(c)) + t + c + struct.pack(">I", zlib.crc32(t + c) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


for path in sys.argv[2:]:
    d = open(path, "rb").read()
    jl = struct.unpack("<I", d[12:16])[0]
    j = json.loads(d[20:20 + jl])
    bl = struct.unpack("<I", d[20 + jl:24 + jl])[0]
    bin_data = bytearray(d[28 + jl:28 + jl + bl])
    png = flat_png(int(round(value * 255)))
    images = j.setdefault("images", [])
    idx = next((i for i, im in enumerate(images) if im.get("name") == "sky_occlusion"), -1)
    if idx >= 0:                                   # same size: overwrite the bytes in place
        bv = j["bufferViews"][images[idx]["bufferView"]]
        assert bv["byteLength"] == len(png), "an older sky_occlusion image of another size"
        bin_data[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + len(png)] = png
        tex = next(i for i, t in enumerate(j["textures"]) if t.get("source") == idx)
    else:
        bin_data += b"\x00" * (-len(bin_data) % 4)
        j["bufferViews"].append({"buffer": 0, "byteOffset": len(bin_data), "byteLength": len(png)})
        bin_data += png + b"\x00" * (-len(png) % 4)
        images.append({"bufferView": len(j["bufferViews"]) - 1, "mimeType": "image/png", "name": "sky_occlusion"})
        j.setdefault("textures", []).append({"source": len(images) - 1})
        tex = len(j["textures"]) - 1
    n = 0
    for m in j.get("materials", []):
        if "occlusionTexture" not in m or m["occlusionTexture"].get("index") == tex:
            m["occlusionTexture"] = {"index": tex}
            n += 1
    j["buffers"][0]["byteLength"] = len(bin_data)
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    open(path, "wb").write(b"glTF" + struct.pack("<II", 2, 12 + 8 + len(js) + 8 + len(bin_data))
                           + struct.pack("<I", len(js)) + b"JSON" + js
                           + struct.pack("<I", len(bin_data)) + b"BIN\x00" + bytes(bin_data))
    print("%s: sky %.2f on %d of %d materials" % (path, value, n, len(j.get("materials", []))))
