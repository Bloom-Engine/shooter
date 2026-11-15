#!/usr/bin/env python3
"""Plan Phase 5.6 - the two effect textures that are drawn, not photographed.

  python3 tools/gen/vfx_flipbook.py

  assets/textures/vfx_explosion.png   2048 x 2048, a 4 x 4 flipbook of a fireball: sixteen
                                      frames from the white flash to the last red tatters.
                                      particle.wgsl plays it by the particle's age (cfg.w = 4)
                                      and blends neighbouring frames.
  assets/textures/vfx_chip.png        512 x 512, one angular shard: masonry chips, splinters,
                                      clods (tinted per pool).

Both are for the ADDITIVE particle bucket, so colour is light: the fireball's smoke is left dim
on purpose (dark smoke cannot be drawn by adding). Deterministic (fixed seed).
"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets/textures")
rng = np.random.default_rng(7)


def lattice(n, size):
    """Smooth noise: an n x n random grid resized to size x size (bicubic)."""
    a = (rng.random((n, n)) * 255).astype(np.uint8)
    return np.asarray(Image.fromarray(a).resize((size, size), Image.BICUBIC), dtype=np.float32) / 255.0


def fbm(size, base):
    out = np.zeros((size, size), np.float32)
    amp, tot, n = 1.0, 0.0, base
    for _ in range(5):
        out += lattice(n, size) * amp
        tot += amp
        amp *= 0.5
        n *= 2
    return out / tot


def ramp(t):
    """Heat 0..1 -> emitted colour (black, deep red, orange, yellow, white)."""
    stops = [(0.0, (0.0, 0.0, 0.0)), (0.18, (0.16, 0.10, 0.08)), (0.38, (0.75, 0.13, 0.02)),
             (0.60, (1.0, 0.45, 0.06)), (0.82, (1.0, 0.85, 0.40)), (1.0, (1.0, 1.0, 0.95))]
    r = np.zeros(t.shape + (3,), np.float32)
    for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
        k = np.clip((t - t0) / (t1 - t0), 0, 1)[..., None]
        m = ((t >= t0) & (t <= t1))[..., None]
        r = np.where(m, np.array(c0) + (np.array(c1) - np.array(c0)) * k, r)
    return r


def explosion():
    f, grid = 512, 4
    sheet = np.zeros((f * grid, f * grid, 4), np.float32)
    # twice the frame, so a scrolling window never wraps (a wrap shows as a straight seam)
    na, nb, nc = fbm(f * 2, 8), fbm(f * 2, 8), fbm(f * 2, 16)
    yy, xx = np.mgrid[0:f, 0:f].astype(np.float32)
    cx = (xx / (f - 1) - 0.5) * 2
    cy = (yy / (f - 1) - 0.5) * 2
    for i in range(grid * grid):
        u = i / (grid * grid - 1)
        # the cloud grows fast, then slowly, and drifts up; its noise scrolls so it boils
        radius = 0.42 + 0.50 * (1 - (1 - u) ** 2.5)
        rise = -0.08 * u
        d = np.sqrt(cx ** 2 + (cy - rise) ** 2) / radius
        shift = int(u * f * 0.30)
        n1 = na[shift:shift + f, :f] * (1 - u) + nb[shift // 2:shift // 2 + f, :f] * u
        n = n1 * 0.65 + nc[:f, shift:shift + f] * 0.35
        n = np.clip((n - 0.5) * 2.2 + 0.5, 0, 1)            # contrast: lobes, not fog
        # a lumpy ball: the noise pushes the rim in and out, more as it ages
        body = np.clip((1.0 - d ** 1.6 + (n - 0.5) * (0.5 + 0.7 * u)) * 1.6, 0, 1)
        # it burns out from the inside of the dark lobes: holes open late
        body = np.clip(body - np.clip(u - 0.55, 0, 1) * (1 - n) * 2.0, 0, 1)
        core = np.clip(1.15 - d * 1.5, 0, 1)
        heat = (0.35 + 0.65 * n) * (1.0 - u) ** 0.9 * (0.55 + 0.6 * core) * 1.5
        heat = heat + max(0.0, 1 - u * 5) * core * 1.2      # the white flash, first three frames
        heat = np.clip(np.maximum(heat, 0.16), 0, 1) * np.clip(body * 3, 0, 1)
        rgb = ramp(heat)
        fade = 1.0 if u < 0.7 else max(0.0, 1 - (u - 0.7) / 0.3)
        a = body * fade
        edge = np.clip((1 - np.maximum(np.abs(cx), np.abs(cy))) / 0.08, 0, 1)   # never touch a cell edge
        a *= edge
        r0, c0 = (i // grid) * f, (i % grid) * f
        sheet[r0:r0 + f, c0:c0 + f, :3] = rgb
        sheet[r0:r0 + f, c0:c0 + f, 3] = a
    Image.fromarray((np.clip(sheet, 0, 1) * 255).astype(np.uint8), "RGBA").save(
        os.path.join(OUT, "vfx_explosion.png"), optimize=True)


def chip():
    s = 512
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    x = (xx / (s - 1) - 0.5) * 2
    y = (yy / (s - 1) - 0.5) * 2
    # a convex shard: the intersection of five half-planes
    inside = np.ones((s, s), np.float32)
    for ang, dist in ((0.2, 0.55), (1.5, 0.42), (2.7, 0.60), (3.9, 0.38), (5.2, 0.50)):
        e = dist - (x * np.cos(ang) + y * np.sin(ang))
        inside = np.minimum(inside, np.clip(e / 0.03, 0, 1))
    shade = 0.62 + 0.38 * np.clip(0.5 + 0.9 * (x * 0.6 - y * 0.8), 0, 1) + (fbm(s, 16) - 0.5) * 0.25
    img = np.zeros((s, s, 4), np.float32)
    img[..., :3] = np.clip(shade, 0, 1)[..., None]
    img[..., 3] = inside
    Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), "RGBA").save(
        os.path.join(OUT, "vfx_chip.png"), optimize=True)


if __name__ == "__main__":
    explosion()
    chip()
    print("wrote vfx_explosion.png, vfx_chip.png")
