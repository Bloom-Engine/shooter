#!/usr/bin/env python3
"""Phase 7.4 - what a bundle's assets/ weighs, by kind, without building one.

  python3 tools/release/bundle_audit.py            both variants
  python3 tools/release/bundle_audit.py --top 20   and the largest files

Applies the same rules as assets_bundle.py to a LISTING of assets/ (nothing is copied or
deleted). "apple" is what release.py ships (every model as its ASTC copy, where one exists);
"plain" is what the web and Android builds ship. Run tools/gen/compress_assets.sh first or the
apple column counts the plain file for any model whose ASTC copy has not been made.
"""
import fnmatch, os, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from assets_bundle import UNUSED_MODELS, JUNK_FILES, JUNK_DIRS, ROOT

A = ROOT / "assets"


def listing(astc):
    files = [p for p in A.rglob("*") if p.is_file()]
    have = {p.with_name(p.name.replace(".astc.glb", ".glb")) for p in files if p.name.endswith(".astc.glb")}
    out = []
    for p in files:
        rel = p.relative_to(A).as_posix()
        if any(fnmatch.fnmatch(p.name, j) for j in JUNK_FILES):
            continue
        if any(rel.startswith(d + "/") for d in JUNK_DIRS):
            continue
        if any(rel.startswith(f"models/{n}") for n in UNUSED_MODELS):
            continue
        is_astc = p.name.endswith(".astc.glb")
        if astc and p in have:
            continue            # replaced by its ASTC copy
        if not astc and is_astc:
            continue
        out.append((p.stat().st_size, rel))
    return out


def main():
    top = int(sys.argv[sys.argv.index("--top") + 1]) if "--top" in sys.argv else 0
    for label, astc in (("apple (ASTC models)", True), ("plain (web, Android)", False)):
        files = listing(astc)
        kinds = {}
        for size, rel in files:
            k = rel.split("/")[0] if "/" in rel else "(root)"
            if k == "models":
                k = "models/" + rel.split("/")[1].split("_")[0]
            kinds[k] = kinds.get(k, 0) + size
        total = sum(s for s, _ in files)
        print(f"{label}: {total / 1e6:.0f} MB in {len(files)} files")
        for k, s in sorted(kinds.items(), key=lambda x: -x[1]):
            if s >= 1e6:
                print(f"  {s / 1e6:7.1f} MB  {k}")
        if top:
            for s, rel in sorted(files, reverse=True)[:top]:
                print(f"    {s / 1e6:7.1f} MB  {rel}")
        print()


if __name__ == "__main__":
    main()
