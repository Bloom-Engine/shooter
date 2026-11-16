"""Cap the embedded textures of every GLB in a bundle's COPY of assets/models at --max pixels.

  python3 tools/release/shrink_glb_textures.py <copy-of-assets>/models [--max 1024]

The models carry 4K maps (photoreal pipeline). All of them resident is 6.3 GB as RGBA8 and ~1.6 GB
as ASTC 4x4, which a 6 GB phone cannot hold: the Pixel 4a's low-memory killer ended the game during
load (2026-11-15). A phone renders at ~1100 px wide, so 1024 px maps lose little. Images are
resampled in place (same format, PNG or JPEG); every bufferView is re-packed into a new BIN chunk.
Run it BEFORE making the .astc.glb copies, so those are cut from the small images. Always point it
at a copy: it rewrites files in place.
"""
import io, json, struct, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
GLB_MAGIC, CHUNK_JSON, CHUNK_BIN = 0x46546C67, 0x4E4F534A, 0x004E4942


def pad4(b, fill=b"\0"):
    return b + fill * (-len(b) % 4)


def shrink_glb(path, max_px):
    data = path.read_bytes()
    magic, _ver, _len = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC:
        return 0
    jlen, jtype = struct.unpack_from("<II", data, 12)
    gltf = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    bin_chunk = b""
    if off < len(data):
        blen, btype = struct.unpack_from("<II", data, off)
        if btype == CHUNK_BIN:
            bin_chunk = data[off + 8:off + 8 + blen]
    views = gltf.get("bufferViews", [])
    if len(gltf.get("buffers", [])) != 1 or not views:
        return 0
    replace = {}
    for im in gltf.get("images", []):
        if "bufferView" not in im:
            continue
        bv = views[im["bufferView"]]
        start = bv.get("byteOffset", 0)
        raw = bin_chunk[start:start + bv["byteLength"]]
        try:
            img = Image.open(io.BytesIO(raw))
            img.load()
        except Exception:
            continue  # KTX2 or anything PIL cannot read: leave it
        w, h = img.size
        if max(w, h) <= max_px:
            continue
        s = max_px / max(w, h)
        small = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
        out = io.BytesIO()
        if (im.get("mimeType") or "").endswith("jpeg"):
            small.convert("RGB").save(out, "JPEG", quality=92)
        else:
            small.save(out, "PNG", optimize=False)
        replace[im["bufferView"]] = out.getvalue()
    if not replace:
        return 0
    new_bin = bytearray()
    for i, bv in enumerate(views):
        start = bv.get("byteOffset", 0)
        chunk = replace.get(i, bin_chunk[start:start + bv["byteLength"]])
        new_bin += b"\0" * (-len(new_bin) % 4)
        bv["byteOffset"] = len(new_bin)
        bv["byteLength"] = len(chunk)
        new_bin += chunk
    new_bin = pad4(bytes(new_bin))
    gltf["buffers"][0]["byteLength"] = len(new_bin)
    j = pad4(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    total = 12 + 8 + len(j) + 8 + len(new_bin)
    path.write_bytes(struct.pack("<III", GLB_MAGIC, 2, total)
                     + struct.pack("<II", len(j), CHUNK_JSON) + j
                     + struct.pack("<II", len(new_bin), CHUNK_BIN) + new_bin)
    return len(replace)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    max_px = 1024
    if "--max" in sys.argv:
        max_px = int(sys.argv[sys.argv.index("--max") + 1])
        args = [a for a in args if a != str(max_px)]
    if len(args) != 1:
        sys.exit(__doc__)
    models = Path(args[0])
    if models.resolve() == (ROOT / "assets" / "models").resolve():
        sys.exit(f"refusing to rewrite {models}: it is the repository's models folder, not a copy")
    for glb in sorted(models.glob("*.glb")):
        if glb.name.endswith(".astc.glb"):
            continue
        n = shrink_glb(glb, max_px)
        if n:
            print(f"[shrink] {glb.name}: {n} image(s) -> <= {max_px} px")
