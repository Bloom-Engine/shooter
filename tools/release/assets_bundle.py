#!/usr/bin/env python3
"""What a shipped copy of assets/ contains. ONE list, used by every build path:

  tools/release/release.py   (TestFlight: iOS, tvOS, macOS)   imports prune_assets
  tools/build-web.sh         (browser)                         runs this file
  tools/build-android.sh     (APK)                             runs this file

  python3 tools/release/assets_bundle.py <copy-of-assets> [--no-astc]

Until 2026-11-14 only release.py pruned; the web and Android builds copied the whole tree,
build inputs and unused models included. Always point this at a COPY: it deletes files.

--no-astc: drop the <model>.astc.glb copies instead of shipping them under the plain names.
Desktop GPUs and browsers do not decode ASTC, so the web build wants the plain GLBs. Android
ships ASTC (Pixel 4a, 2026-11-15), cut by build-android.sh from 1024 px copies of the models
(tools/release/shrink_glb_textures.py), not the 4K .astc.glb files.
"""
import shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Models the game does not load: outputs of tools/build-props.ts that nothing draws any more.
UNUSED_MODELS = ("prop_flower", "prop_grasstuft")
# Files that document or drive the build and are never read at runtime.
JUNK_FILES = ("*.report.json", ".DS_Store", ".gitkeep", ".generated", "SOURCES.md",
              "SUNO-PROMPTS.md")
JUNK_DIRS = ("music/src", "textures/external")


def prune_assets(assets, astc=True):
    """Trim a bundle's COPY of assets/ to what the game loads. With astc=True every model that
    has an ASTC copy ships as that copy under the plain name: the game asks for <model>.glb, and
    the engine reads KTX2/ASTC images from a GLB like any other (the GPU keeps them compressed)."""
    assets = Path(assets)
    if assets.is_symlink() or assets.resolve() == (ROOT / "assets").resolve():
        sys.exit(f"refusing to prune {assets}: it is the repository's assets folder, not a copy")
    for name in UNUSED_MODELS:
        for f in assets.glob(f"models/{name}*.glb"):
            f.unlink()
    for copy in assets.rglob("*.astc.glb"):
        if astc:
            copy.replace(copy.with_name(copy.name.replace(".astc.glb", ".glb")))
        else:
            copy.unlink()
    for pattern in JUNK_FILES:
        for junk in assets.rglob(pattern):
            junk.unlink()
    for junk_dir in JUNK_DIRS:
        shutil.rmtree(assets / junk_dir, ignore_errors=True)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        sys.exit(__doc__)
    prune_assets(args[0], astc="--no-astc" not in sys.argv)
