#!/usr/bin/env python3
"""Chroma-key a leaf-branch photo shot on pure magenta into an RGBA leaf-card texture.

  tools/gen/key_foliage.py <in.png> <out_rgba.png> [--size 1024] [--gain 0.72]

--gain darkens the leaf colour: a flat-lit studio leaf is far brighter than the same leaf in a
crown, and with the engine's backlit-foliage term an unscaled card renders lime green.

Alpha comes from how magenta a pixel is (min(R, B) - G). Edge pixels are despilled (their red and
blue pulled down to what a leaf would have), and the colour of opaque pixels is bled outward into
the transparent area so mip-mapping and the alpha test never show a magenta or black fringe.
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, dst = sys.argv[1], sys.argv[2]
size = int(sys.argv[sys.argv.index("--size") + 1]) if "--size" in sys.argv else 1024
gain = float(sys.argv[sys.argv.index("--gain") + 1]) if "--gain" in sys.argv else 0.72
im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32) / 255.0
r, g, b = im[..., 0], im[..., 1], im[..., 2]
mag = np.minimum(r, b) - g                      # +1 on the background, negative on green leaves
alpha = np.clip(1.0 - (mag - 0.05) / 0.30, 0.0, 1.0)
# Despill: no leaf or twig pixel is more red-and-blue than green by much.
limit = g + 0.10
spill = np.clip(np.minimum(r, b) - limit, 0.0, 1.0)
r2, b2 = r - spill, b - spill
rgb = np.stack([r2, g, b2], -1)
a8 = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))   # shave 1 px of fringe
alpha = np.asarray(a8).astype(np.float32) / 255.0
# Bleed opaque colour outward (premultiplied blur, repeated) so transparent texels carry leaf colour.
solid = (alpha > 0.5).astype(np.float32)
acc = rgb * solid[..., None]
w = solid.copy()
out = rgb.copy()
for radius in (2, 4, 8, 16, 32, 64):
    ba = np.asarray(Image.fromarray((np.clip(acc, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255.0
    bw = np.asarray(Image.fromarray((w * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255.0
    fill = ba / np.maximum(bw, 1e-3)[..., None]
    need = (w < 0.5) & (bw > 0.02)
    out[need] = fill[need]
    acc = np.where(need[..., None], fill, acc)
    w = np.where(need, 1.0, w)
out[w < 0.5] = rgb[solid > 0.5].mean(0) if solid.sum() else 0.3
res = np.dstack([np.clip(out * gain, 0, 1), alpha])
img = Image.fromarray((res * 255).astype(np.uint8), "RGBA")
if img.size != (size, size):
    img = img.resize((size, size), Image.LANCZOS)
img.save(dst)
print(dst, img.size, "coverage %.0f%%" % (100 * (alpha > 0.5).mean()))
