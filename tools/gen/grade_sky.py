#!/usr/bin/env python3
"""Grade the sky panorama into a time of day (plan 3.5).

  tools/gen/grade_sky.py assets/env/outdoor.hdr assets/env/outdoor_dusk.hdr dusk [sun_x sun_y sun_z]

The game's sky and image-based light are one equirectangular Radiance .hdr. An arena that moves
its sun to the horizon and turns it orange still had the noon sky above it. This writes a graded
copy: a vertical colour ramp (zenith to horizon), a desaturation, and for presets with a low sun
a glow on the horizon round the sun's bearing, given as the world's sunDirection.
`src/main.ts` picks the file by the look key `sky_variant` (SKY_FILES there, same order as
PRESETS here). Reads and writes RLE Radiance RGBE with no dependency beyond numpy.
"""
import sys, math
import numpy as np

#           zenith rgb            horizon rgb           saturation, gain, glow rgb, glow strength,
#           cap (the panorama carries its own high noon sun: brightness is clamped to this many
#           times the mid-sky median so it does not shine through a dusk; 0 = leave it)
PRESETS = {
    "afternoon": ((0.80, 0.88, 1.00), (1.12, 0.98, 0.80), 1.00, 0.95, (1.0, 0.75, 0.45), 0.9, 0),
    "mist":      ((0.78, 0.84, 0.90), (1.05, 1.06, 1.06), 0.45, 0.90, (1.0, 0.92, 0.80), 0.6, 2.4),
    "dusk":      ((0.16, 0.20, 0.42), (0.95, 0.50, 0.30), 0.90, 0.60, (1.0, 0.45, 0.16), 2.6, 1.5),
}


def read_hdr(path):
    f = open(path, "rb")
    while True:
        line = f.readline()
        if line.strip() == b"":
            break
    parts = f.readline().split()
    h, w = int(parts[1]), int(parts[3])
    data = np.frombuffer(f.read(), dtype=np.uint8)
    out = np.zeros((h, w, 4), dtype=np.uint8)
    p = 0
    for y in range(h):
        if data[p] == 2 and data[p + 1] == 2 and (int(data[p + 2]) << 8 | int(data[p + 3])) == w:
            p += 4
            for c in range(4):
                x = 0
                while x < w:
                    n = int(data[p]); p += 1
                    if n > 128:
                        n -= 128
                        out[y, x:x + n, c] = data[p]; p += 1
                    else:
                        out[y, x:x + n, c] = data[p:p + n]; p += n
                    x += n
        else:                                   # flat scanline
            out[y] = data[p:p + w * 4].reshape(w, 4); p += w * 4
    e = out[..., 3].astype(np.float32)
    scale = np.where(e > 0, np.ldexp(1.0, (e - 136).astype(np.int32)), 0.0)
    return out[..., :3].astype(np.float32) * scale[..., None]


def write_hdr(path, rgb):
    h, w, _ = rgb.shape
    m = np.maximum(rgb.max(-1), 1e-32)
    e = np.ceil(np.log2(m)).astype(np.int32)
    e = np.where(np.ldexp(1.0, e) <= m, e + 1, e)           # mantissa strictly below 1
    scale = np.ldexp(1.0, -e) * 256.0
    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[..., :3] = np.clip(rgb * scale[..., None], 0, 255).astype(np.uint8)
    out[..., 3] = np.clip(e + 128, 0, 255).astype(np.uint8)
    out[rgb.max(-1) < 1e-30] = 0
    f = open(path, "wb")
    f.write(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y %d +X %d\n" % (h, w))
    for y in range(h):
        f.write(bytes([2, 2, w >> 8, w & 255]))
        for c in range(4):
            row = out[y, :, c]
            buf = bytearray()
            x = 0
            while x < w:
                run = 1
                while x + run < w and run < 127 and row[x + run] == row[x]:
                    run += 1
                if run >= 4:
                    buf += bytes([128 + run, int(row[x])]); x += run
                else:
                    start = x
                    x += run
                    while x < w and x - start < 127:
                        r2 = 1
                        while x + r2 < w and r2 < 4 and row[x + r2] == row[x]:
                            r2 += 1
                        if r2 >= 4:
                            break
                        x += 1
                    x = min(x, start + 127)
                    buf += bytes([x - start]) + row[start:x].tobytes()
            f.write(bytes(buf))
    f.close()


src, dst, preset = sys.argv[1], sys.argv[2], sys.argv[3]
sun = [float(v) for v in sys.argv[4:7]] if len(sys.argv) >= 7 else [0.0, 1.0, 0.0]
zen, hor, sat, gain, glow, glow_k, cap = PRESETS[preset]
im = read_hdr(src)
h, w, _ = im.shape
v = (np.arange(h, dtype=np.float32) + 0.5) / h                 # 0 = zenith, 0.5 = horizon, 1 = nadir
el = np.clip(1.0 - v * 2.0, 0.0, 1.0)                           # 1 at the zenith, 0 at and below the horizon
t = (el ** 0.6)[:, None, None]
ramp = np.array(hor, np.float32) * (1 - t) + np.array(zen, np.float32) * t
lum = im @ np.array([0.2126, 0.7152, 0.0722], np.float32)
if cap > 0:
    lim = cap * float(np.median(lum[int(h * 0.30):int(h * 0.45)]))
    k = np.minimum(1.0, lim / np.maximum(lum, 1e-6))
    im = im * k[..., None]
    lum = lum * k
im = (lum[..., None] * (1 - sat) + im * sat) * ramp * gain
# Glow round the sun's bearing. The engine's lookup is u = fract(atan2(z, x) / 2pi) (common/pbr.wgsl).
su = (math.atan2(sun[2], sun[0]) / (2 * math.pi)) % 1.0
u = (np.arange(w, dtype=np.float32) + 0.5) / w
du = np.abs(u - su); du = np.minimum(du, 1 - du) * 2 * math.pi   # radians of bearing from the sun
sun_el = math.asin(max(-1.0, min(1.0, sun[1] / math.sqrt(sum(c * c for c in sun)))))
dv = (np.pi / 2 - v * np.pi) - sun_el                              # radians of elevation from the sun
ang2 = (du[None, :] / 1.6) ** 2 + (dv[:, None] / 0.55) ** 2
g = np.exp(-ang2 * 2.2) * glow_k * (v[:, None] < 0.56)
base = float(np.median(lum[int(h * 0.30):int(h * 0.45)]))
im = im + g[..., None] * np.array(glow, np.float32) * base
write_hdr(dst, im.astype(np.float32))
print(dst, im.shape, "mean", float(im.mean()))
