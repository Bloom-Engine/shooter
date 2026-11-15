#!/usr/bin/env python3
"""Download a Poly Haven model (CC0) into tools/.cache/polyhaven/<name>/ (git-ignored).

  tools/gen/fetch_polyhaven.py <name> [<name> ...] [--res 2k]

Fetches the glTF package (the .gltf, its .bin and its textures) and, when the asset has one, the
separate Alpha map: Poly Haven's glTF packages leave the cut-out map of a plant out, and
tools/blender/plant_card.py takes it with --alpha. Files already there are kept.
"""
import json, os, sys, urllib.request

args = [a for a in sys.argv[1:] if not a.startswith("--")]
res = sys.argv[sys.argv.index("--res") + 1] if "--res" in sys.argv else "2k"
if "--res" in sys.argv:
    args.remove(res)
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".cache", "polyhaven")


def get(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={"User-Agent": "asset-fetch"})
        with urllib.request.urlopen(req) as r, open(path, "wb") as f:
            f.write(r.read())
    print("  %-52s %7d KB" % (os.path.relpath(path, root), os.path.getsize(path) // 1024))


for name in args:
    req = urllib.request.Request("https://api.polyhaven.com/files/" + name, headers={"User-Agent": "asset-fetch"})
    d = json.load(urllib.request.urlopen(req))
    g = d["gltf"][res]["gltf"]
    out = os.path.join(root, name)
    print(name)
    get(g["url"], os.path.join(out, os.path.basename(g["url"])))
    for rel, v in g.get("include", {}).items():
        get(v["url"], os.path.join(out, rel))
    if "Alpha" in d:
        f = d["Alpha"][res]
        url = f["png" if "png" in f else next(iter(f))]["url"]
        get(url, os.path.join(out, "textures", os.path.basename(url)))
