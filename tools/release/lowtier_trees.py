"""Write a low-tier variant next to each tree model in a bundle's COPY of assets/models.

  python3 tools/release/lowtier_trees.py <copy-of-assets>/models [--keep 0.6]

<tree>.glb -> <tree>_low.glb with fewer leaf cards. tree_from_scan.py gives every crown cell cards
in three orientations (facing out, across, down) so a crown reads full from every side; a crown
is then about ten cards deep, and on a low-tier phone each layer is an alpha-tested texture read:
the near trees were 31 of 72 ms of a Pixel 4a frame (SH-069). The variant keeps the cards that
face out from the crown's centre (the silhouette), --keep of the leaf area, and drops the
rest. Trunk and branches are untouched,
and only the index list of the leaf primitive changes, so materials, UVs and vertex colours are
the source's. main.ts loads the variants on the low tier only.

Always point it at a copy.
"""
import json, struct, sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
TREES = ("prop_tree.glb", "prop_tree2.glb", "prop_tree3.glb")


def read_glb(path):
    d = path.read_bytes()
    jl = struct.unpack_from("<I", d, 12)[0]
    j = json.loads(d[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack_from("<I", d, off)[0]
    return j, bytearray(d[off + 8:off + 8 + bl])


def write_glb(path, j, bin_):
    bin_ = bytes(bin_) + b"\0" * (-len(bin_) % 4)
    j["buffers"] = [{"byteLength": len(bin_)}]
    js = json.dumps(j, separators=(",", ":")).encode()
    js = js + b" " * (-len(js) % 4)
    path.write_bytes(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_))
                     + struct.pack("<II", len(js), 0x4E4F534A) + js
                     + struct.pack("<II", len(bin_), 0x004E4942) + bin_)


def accessor(j, b, i):
    a = j["accessors"][i]
    bv = j["bufferViews"][a["bufferView"]]
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a["componentType"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    if bv.get("byteStride", 0) not in (0, n * np.dtype(dt).itemsize):
        raise ValueError("interleaved accessor")
    return np.frombuffer(bytes(b), dtype=dt, count=a["count"] * n, offset=off).reshape(a["count"], n)


def low_variant(src, dst, keep):
    j, b = read_glb(src)
    leaves = [p for m in j["meshes"] for p in m["primitives"]
              if j["materials"][p["material"]].get("alphaMode") == "MASK"]
    if len(leaves) != 1:
        return None
    p = leaves[0]
    P = accessor(j, b, p["attributes"]["POSITION"])
    tri = accessor(j, b, p["indices"]).reshape(-1, 3).astype(np.int64)
    e1 = P[tri[:, 1]] - P[tri[:, 0]]
    e2 = P[tri[:, 2]] - P[tri[:, 0]]
    fn = np.cross(e1, e2)
    area = np.linalg.norm(fn, axis=1) / 2
    fn = fn / (np.linalg.norm(fn, axis=1, keepdims=True) + 1e-9)
    centre = (P[tri[:, 0]] + P[tri[:, 1]] + P[tri[:, 2]]) / 3
    crown = np.average(centre, axis=0, weights=area)
    radial = centre - crown
    radial[:, 1] *= 0.5                       # a crown is wider than it is deep
    radial = radial / (np.linalg.norm(radial, axis=1, keepdims=True) + 1e-9)
    facing = np.abs(np.sum(fn * radial, axis=1))   # 1 = faces out of the crown
    # A card is two triangles with the same normal: rank by facing, keep the best `keep` of
    # the area (both halves of a card score alike, so cards stay whole).
    order = np.argsort(-facing)
    cum = np.cumsum(area[order]) / area.sum()
    kept = np.sort(order[cum <= keep])
    new_idx = tri[kept].astype(np.uint32).ravel()
    data = new_idx.tobytes()
    b.extend(b"\0" * (-len(b) % 4))
    j["bufferViews"].append({"buffer": 0, "byteOffset": len(b), "byteLength": len(data),
                             "target": 34963})
    b.extend(data)
    j["accessors"].append({"bufferView": len(j["bufferViews"]) - 1, "componentType": 5125,
                           "count": int(new_idx.size), "type": "SCALAR"})
    p["indices"] = len(j["accessors"]) - 1
    write_glb(dst, j, b)
    return len(tri), len(kept)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    keep = 0.6
    if "--keep" in sys.argv:
        keep = float(sys.argv[sys.argv.index("--keep") + 1])
        args = [a for a in args if a != sys.argv[sys.argv.index("--keep") + 1]]
    if len(args) != 1:
        sys.exit(__doc__)
    models = Path(args[0])
    if models.resolve() == (ROOT / "assets" / "models").resolve():
        sys.exit(f"refusing to write into {models}: it is the repository's models folder")
    for name in TREES:
        src = models / name
        if not src.exists():
            continue
        r = low_variant(src, src.with_name(src.stem + "_low.glb"), keep)
        if r:
            print(f"[lowtier] {src.stem}_low.glb: {r[1]} of {r[0]} leaf triangles")
