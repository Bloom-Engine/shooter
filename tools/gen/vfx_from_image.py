#!/usr/bin/env python3
"""Turn a generated photograph into a particle or decal texture (RGBA, straight alpha).

  tools/gen/vfx_from_image.py <in.png> <out.png> --mode light|dark|flame [--size 512]

  light   subject photographed on pure BLACK (smoke, dust, a white splat): alpha is the brightness,
          colour is the image normalised to near white, so the game's per-instance tint colours it.
  flame   like light, but the colour is kept (a muzzle flash is additive and must stay hot).
  dark    dark marks on pure WHITE (bullet hole, scorch, crater): alpha is the darkness, colour is
          the image's own dark tone.
The alpha is windowed to zero toward the edge of the square, so a sprite can never show its quad.
"""
import sys
import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
mode = sys.argv[sys.argv.index("--mode") + 1]
size = int(sys.argv[sys.argv.index("--size") + 1]) if "--size" in sys.argv else 512
im = np.asarray(Image.open(src).convert("RGB").resize((size, size), Image.LANCZOS)).astype(np.float32) / 255.0
lum = im @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
r = np.hypot((xx - size / 2) / (size / 2), (yy - size / 2) / (size / 2))
window = np.clip((1.0 - r) / 0.12, 0.0, 1.0)            # 1 inside, fading to 0 over the outer 12 %
if mode == "dark":
    alpha = np.clip((1.0 - lum - 0.06) / 0.80, 0.0, 1.0) ** 0.9
    rgb = np.clip(im * 0.55, 0.0, 1.0)                   # keep the mark's own soot/shadow tone
else:
    alpha = np.clip((lum - 0.03) / 0.75, 0.0, 1.0)
    if mode == "flame":
        rgb = np.clip(im / np.maximum(lum, 0.35)[..., None] * 0.9, 0.0, 1.0)
    else:
        shade = np.clip(0.80 + 0.20 * (lum / max(float(lum.max()), 1e-3)), 0.0, 1.0)   # keep a little form
        rgb = np.repeat(shade[..., None], 3, axis=2)
alpha = alpha * window
out = np.dstack([rgb, alpha])
Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), "RGBA").save(dst)
print(dst, size, mode, "coverage %.0f%%" % (100 * (alpha > 0.1).mean()))
