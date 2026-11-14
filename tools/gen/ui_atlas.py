#!/usr/bin/env python3
"""Build the UI atlas (plan Phase 4): assets/ui/atlas.png + src/ui-atlas.ts.

Every sprite is white on transparent and is tinted where it is drawn, so one atlas serves
every palette (the colour-blind palettes included). Shapes are drawn at 4x and reduced.
The four weapon silhouettes come from tools/blender/weapon_silhouette.py:

    for w in rifle blaster chaingun cannon; do
      blender -b -P tools/blender/weapon_silhouette.py -- assets/models/weapon_$w.glb art/ui/sil_$w.png
    done
    python3 tools/gen/ui_atlas.py

Adding a sprite: append to SPRITES below and re-run; the TypeScript table is regenerated, so
nothing is indexed by hand.
"""
import math, os, sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SS = 4
ATLAS = 1024
PAD = 2


def canvas(w, h):
    return Image.new('L', (w * SS, h * SS), 0)


def done(im, w, h):
    return im.resize((w, h), Image.LANCZOS)


def P(pts):
    return [(x * SS, y * SS) for x, y in pts]


def disc(w=64):
    im = canvas(w, w); d = ImageDraw.Draw(im)
    d.ellipse(P([(1, 1), (w - 1, w - 1)]), fill=255)
    return done(im, w, w)


def ring(w=128, t=3.0):
    im = canvas(w, w); d = ImageDraw.Draw(im)
    d.ellipse(P([(1, 1), (w - 1, w - 1)]), fill=255)
    d.ellipse(P([(1 + t, 1 + t), (w - 1 - t, w - 1 - t)]), fill=0)
    return done(im, w, w)


def soft(w=128):
    im = Image.new('L', (w, w), 0); px = im.load()
    c = (w - 1) / 2
    for y in range(w):
        for x in range(w):
            r = math.hypot(x - c, y - c) / c
            v = max(0.0, 1 - r)
            px[x, y] = int(255 * v * v)
    return im


def vignette(w=256):
    """Alpha rises toward the edges and most in the corners; stretched over the screen."""
    im = Image.new('L', (w, w), 0); px = im.load()
    for y in range(w):
        for x in range(w):
            u = abs(x / (w - 1) * 2 - 1); v = abs(y / (w - 1) * 2 - 1)
            e = max(u, v) * 0.75 + math.hypot(u, v) / 1.414 * 0.25
            t = max(0.0, (e - 0.55) / 0.45)
            px[x, y] = int(255 * t ** 2.2)
    return im


def arc(w=256, h=96):
    """Damage-direction wedge: a band of arc, thickest in the middle, pointing up."""
    im = canvas(w, h); d = ImageDraw.Draw(im)
    cx, cy, R = w / 2, 250.0, 236.0
    pts_out, pts_in = [], []
    span = math.radians(27)
    n = 48
    for i in range(n + 1):
        a = -span + 2 * span * i / n
        k = 1 - abs(i / n * 2 - 1)
        t = 3 + 19 * math.sin(k * math.pi / 2) ** 1.4
        pts_out.append((cx + math.sin(a) * (R + t * 0.5), cy - math.cos(a) * (R + t * 0.5)))
        pts_in.append((cx + math.sin(a) * (R - t * 0.5), cy - math.cos(a) * (R - t * 0.5)))
    d.polygon(P(pts_out + pts_in[::-1]), fill=255)
    # the pointer: a small tooth on the inside, so the wedge reads as "from there"
    d.polygon(P([(cx - 9, cy - R + 8), (cx + 9, cy - R + 8), (cx, cy - R + 24)]), fill=255)
    im = done(im, w, h)
    glow = im.filter(ImageFilter.GaussianBlur(5))
    return ImageChops.lighter(im, glow.point(lambda v: int(v * 0.55)))


def chevron(w=64):
    im = canvas(w, w); d = ImageDraw.Draw(im)
    d.polygon(P([(32, 6), (58, 52), (32, 40), (6, 52)]), fill=255)
    return done(im, w, w)


def chamfer_pts(w, h, c, inset=0.0):
    i = inset
    return [(c + i * 0.41, i), (w - i, i), (w - i, h - c - i * 0.41), (w - c - i * 0.41, h - i),
            (i, h - i), (i, c + i * 0.41)]


def panel(w=48, c=12):
    im = canvas(w, w); d = ImageDraw.Draw(im)
    d.polygon(P(chamfer_pts(w, w, c)), fill=255)
    return done(im, w, w)


def panel_line(w=48, c=12, t=1.6):
    im = canvas(w, w); d = ImageDraw.Draw(im)
    d.polygon(P(chamfer_pts(w, w, c)), fill=255)
    d.polygon(P(chamfer_pts(w, w, c, t)), fill=0)
    return done(im, w, w)


def keycap(w=48):
    """A key: rounded square with a lighter top face and a lip underneath."""
    im = canvas(w, w); d = ImageDraw.Draw(im)
    d.rounded_rectangle(P([(2, 2), (w - 2, w - 2)]), radius=8 * SS, fill=150)
    d.rounded_rectangle(P([(4, 3), (w - 4, w - 8)]), radius=6 * SS, fill=255)
    return done(im, w, w)


def keycap_line(w=48):
    im = canvas(w, w); d = ImageDraw.Draw(im)
    d.rounded_rectangle(P([(2, 2), (w - 2, w - 2)]), radius=8 * SS, fill=255)
    d.rounded_rectangle(P([(3.6, 3.6), (w - 3.6, w - 3.6)]), radius=6.6 * SS, fill=0)
    return done(im, w, w)


def fade_h(w=128, h=8):
    im = Image.new('L', (w, h), 0); px = im.load()
    for x in range(w):
        t = 1 - abs(x / (w - 1) * 2 - 1)
        v = int(255 * min(1.0, t * 1.6) ** 1.5)
        for y in range(h):
            px[x, y] = v
    return im


def fade_r(w=128, h=8):
    im = Image.new('L', (w, h), 0); px = im.load()
    for x in range(w):
        v = int(255 * (1 - x / (w - 1)) ** 1.6)
        for y in range(h):
            px[x, y] = v
    return im


def pip(w=12, h=28):
    """One round in the magazine: a bullet outline standing up."""
    im = canvas(w, h); d = ImageDraw.Draw(im)
    d.rounded_rectangle(P([(2, 9), (w - 2, h - 1)]), radius=1.5 * SS, fill=255)
    d.pieslice(P([(2, 1), (w - 2, 19)]), 180, 360, fill=255)
    return done(im, w, h)


def icon(fn, w=64):
    im = canvas(w, w); d = ImageDraw.Draw(im)
    fn(d, im)
    return done(im, w, w)


def i_grenade(d, im):
    d.ellipse(P([(14, 22), (50, 60)]), fill=255)
    d.rectangle(P([(25, 12), (39, 24)]), fill=255)
    d.line(P([(39, 14), (52, 14), (54, 30)]), fill=255, width=4 * SS)
    d.ellipse(P([(15, 4), (29, 18)]), outline=255, width=3 * SS)
    d.line(P([(14, 41), (50, 41)]), fill=0, width=2 * SS)
    d.line(P([(32, 24), (32, 60)]), fill=0, width=2 * SS)


def i_cross(d, im):
    d.rounded_rectangle(P([(24, 8), (40, 56)]), radius=3 * SS, fill=255)
    d.rounded_rectangle(P([(8, 24), (56, 40)]), radius=3 * SS, fill=255)


def i_skull(d, im):
    d.ellipse(P([(10, 6), (54, 46)]), fill=255)
    d.rounded_rectangle(P([(21, 36), (43, 58)]), radius=3 * SS, fill=255)
    d.ellipse(P([(18, 22), (30, 36)]), fill=0)
    d.ellipse(P([(34, 22), (46, 36)]), fill=0)
    d.polygon(P([(32, 36), (28, 44), (36, 44)]), fill=0)
    for x in (28, 32, 36):
        d.line(P([(x, 49), (x, 58)]), fill=0, width=int(1.6 * SS))


def i_roll(d, im):
    d.arc(P([(10, 10), (54, 54)]), 200, 110, fill=255, width=7 * SS)
    d.polygon(P([(4, 30), (24, 34), (10, 50)]), fill=255)
    d.ellipse(P([(26, 26), (38, 38)]), fill=255)


def i_head(d, im):
    d.ellipse(P([(18, 6), (46, 36)]), fill=255)
    d.pieslice(P([(6, 34), (58, 86)]), 180, 360, fill=255)
    d.line(P([(32, 0), (32, 14)]), fill=0, width=2 * SS)
    d.line(P([(32, 28), (32, 42)]), fill=0, width=2 * SS)
    d.line(P([(12, 21), (26, 21)]), fill=0, width=2 * SS)
    d.line(P([(38, 21), (52, 21)]), fill=0, width=2 * SS)


def i_clock(d, im):
    d.ellipse(P([(6, 6), (58, 58)]), outline=255, width=5 * SS)
    d.line(P([(32, 32), (32, 16)]), fill=255, width=4 * SS)
    d.line(P([(32, 32), (44, 38)]), fill=255, width=4 * SS)


def i_target(d, im):
    d.ellipse(P([(6, 6), (58, 58)]), outline=255, width=4 * SS)
    d.ellipse(P([(19, 19), (45, 45)]), outline=255, width=4 * SS)
    d.ellipse(P([(28, 28), (36, 36)]), fill=255)


def i_bolt(d, im):
    d.polygon(P([(38, 2), (12, 36), (29, 36), (22, 62), (52, 24), (34, 24)]), fill=255)


def i_eye(d, im):
    d.polygon(P([(2, 32), (16, 18), (32, 13), (48, 18), (62, 32), (48, 46), (32, 51), (16, 46)]), fill=255)
    d.ellipse(P([(21, 21), (43, 43)]), fill=0)
    d.ellipse(P([(27, 27), (37, 37)]), fill=255)


def i_fist(d, im):
    # a rifle butt swung: a thick slanted bar with a block on the end
    d.polygon(P([(8, 48), (18, 58), (46, 30), (36, 20)]), fill=255)
    d.polygon(P([(32, 14), (50, 6), (60, 22), (50, 34)]), fill=255)


def i_arrow_r(d, im):
    d.polygon(P([(20, 8), (48, 32), (20, 56), (20, 44), (34, 32), (20, 20)]), fill=255)


def i_arrow_l(d, im):
    d.polygon(P([(44, 8), (16, 32), (44, 56), (44, 44), (30, 32), (44, 20)]), fill=255)


def i_check(d, im):
    d.line(P([(10, 34), (26, 50), (54, 14)]), fill=255, width=8 * SS, joint='curve')


def i_star(d, im):
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        r = 29 if i % 2 == 0 else 12
        pts.append((32 + math.cos(a) * r, 33 + math.sin(a) * r))
    d.polygon(P(pts), fill=255)


def i_lock(d, im):
    d.rounded_rectangle(P([(12, 28), (52, 58)]), radius=4 * SS, fill=255)
    d.arc(P([(18, 6), (46, 40)]), 180, 360, fill=255, width=6 * SS)
    d.ellipse(P([(28, 37), (36, 45)]), fill=0)


def i_dpad(d, im):
    d.rounded_rectangle(P([(23, 6), (41, 58)]), radius=3 * SS, fill=255)
    d.rounded_rectangle(P([(6, 23), (58, 41)]), radius=3 * SS, fill=255)


def i_stick(d, im):
    d.ellipse(P([(4, 4), (60, 60)]), outline=255, width=4 * SS)
    d.ellipse(P([(15, 15), (49, 49)]), fill=255)


def i_trigger(d, im):
    # a trigger seen from behind: flat top, rounded hanging body
    d.rounded_rectangle(P([(10, 6), (54, 30)]), radius=6 * SS, fill=255)
    d.pieslice(P([(10, -6), (54, 60)]), 0, 180, fill=255)


def i_bumper(d, im):
    d.rounded_rectangle(P([(4, 18), (60, 46)]), radius=10 * SS, fill=255)


def mouse(which, w=64):
    """A mouse seen from above; the button meant is filled solid, the rest is outline."""
    im = canvas(w, w); d = ImageDraw.Draw(im)
    body = [(13, 3), (51, 61)]
    d.rounded_rectangle(P(body), radius=18 * SS, outline=255, width=4 * SS)
    d.line(P([(13, 28), (51, 28)]), fill=255, width=3 * SS)
    d.line(P([(32, 3), (32, 28)]), fill=255, width=3 * SS)
    if which in ('l', 'r'):
        solid = canvas(w, w); ds = ImageDraw.Draw(solid)
        ds.rounded_rectangle(P(body), radius=18 * SS, fill=255)
        half = canvas(w, w); dh = ImageDraw.Draw(half)
        dh.rectangle(P([(0, 0), (32, 28)] if which == 'l' else [(32, 0), (64, 28)]), fill=255)
        im = ImageChops.lighter(im, ImageChops.multiply(solid, half))
    else:
        d.rounded_rectangle(P([(26, 8), (38, 25)]), radius=6 * SS, fill=255)
    return done(im, w, w)


def emblem(w=256):
    """Title mark: a reticle whose four quadrants are petals (the game is called Bloom)."""
    im = canvas(w, w); d = ImageDraw.Draw(im)
    c = w / 2
    for k in range(4):
        a0 = k * 90 + 12
        d.pieslice(P([(18, 18), (w - 18, w - 18)]), a0, a0 + 66, fill=255)
    d.ellipse(P([(62, 62), (w - 62, w - 62)]), fill=0)
    d.ellipse(P([(4, 4), (w - 4, w - 4)]), outline=255, width=3 * SS)
    for k in range(4):
        a = math.radians(k * 90)
        d.line(P([(c + math.cos(a) * 30, c + math.sin(a) * 30),
                  (c + math.cos(a) * 124, c + math.sin(a) * 124)]), fill=255, width=4 * SS)
    d.ellipse(P([(c - 9, c - 9), (c + 9, c + 9)]), fill=255)
    return done(im, w, w)


def weapon(name, w=384, h=144):
    p = os.path.join(ROOT, 'art', 'ui', 'sil_' + name + '.png')
    src = Image.open(p).convert('RGBA')
    a = src.split()[3]
    # close the pin-holes a coplanar face leaves, then shade: keep a little of the render's
    # form so the silhouette has inner lines once tinted
    a = a.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    shade = src.convert('L').filter(ImageFilter.MedianFilter(7)).point(lambda v: 150 + int(v * 105 / 255))
    out = Image.merge('LA', (shade, a)).resize((w, h), Image.LANCZOS)
    return out


SPRITES = [
    ('DISC', lambda: disc(64)),
    ('RING', lambda: ring(128, 3.0)),
    ('RING_THIN', lambda: ring(128, 1.5)),
    ('SOFT', lambda: soft(128)),
    ('VIG', lambda: vignette(256)),
    ('ARC', lambda: arc()),
    ('CHEV', lambda: chevron()),
    ('PANEL', lambda: panel()),
    ('PANEL_LINE', lambda: panel_line()),
    ('KEY', lambda: keycap()),
    ('KEY_LINE', lambda: keycap_line()),
    ('FADE_H', lambda: fade_h()),
    ('FADE_R', lambda: fade_r()),
    ('PIP', lambda: pip()),
    ('GRENADE', lambda: icon(i_grenade)),
    ('CROSS', lambda: icon(i_cross)),
    ('SKULL', lambda: icon(i_skull)),
    ('ROLL', lambda: icon(i_roll)),
    ('HEAD', lambda: icon(i_head)),
    ('CLOCK', lambda: icon(i_clock)),
    ('TARGET', lambda: icon(i_target)),
    ('BOLT', lambda: icon(i_bolt)),
    ('EYE', lambda: icon(i_eye)),
    ('BUTT', lambda: icon(i_fist)),
    ('ARROW_R', lambda: icon(i_arrow_r)),
    ('ARROW_L', lambda: icon(i_arrow_l)),
    ('CHECK', lambda: icon(i_check)),
    ('STAR', lambda: icon(i_star)),
    ('LOCK', lambda: icon(i_lock)),
    ('DPAD', lambda: icon(i_dpad)),
    ('STICK', lambda: icon(i_stick)),
    ('TRIGGER', lambda: icon(i_trigger)),
    ('BUMPER', lambda: icon(i_bumper)),
    ('MOUSE_L', lambda: mouse('l')),
    ('MOUSE_R', lambda: mouse('r')),
    ('MOUSE_M', lambda: mouse('m')),
    ('EMBLEM', lambda: emblem()),
    ('WPN_RIFLE', lambda: weapon('rifle')),
    ('WPN_BLASTER', lambda: weapon('blaster')),
    ('WPN_CHAIN', lambda: weapon('chaingun')),
    ('WPN_CANNON', lambda: weapon('cannon')),
]


def main():
    built = []
    for name, fn in SPRITES:
        im = fn()
        if im.mode == 'L':
            im = Image.merge('LA', (Image.new('L', im.size, 255), im))
        built.append((name, im))
    # shelf packing, tallest first; the emitted table keeps declaration order
    order = sorted(range(len(built)), key=lambda i: -built[i][1].size[1])
    atlas = Image.new('RGBA', (ATLAS, ATLAS), (255, 255, 255, 0))
    rects = [None] * len(built)
    x = y = PAD; shelf = 0
    for i in order:
        im = built[i][1]; w, h = im.size
        if x + w + PAD > ATLAS:
            x = PAD; y += shelf + PAD * 2; shelf = 0
        if y + h + PAD > ATLAS:
            sys.exit('atlas full: raise ATLAS')
        l, a = im.split()
        atlas.paste(Image.merge('RGBA', (l, l, l, a)), (x, y))
        rects[i] = (x, y, w, h)
        x += w + PAD * 2; shelf = max(shelf, h)
    # a solid white block in the corner: rectangles drawn from the atlas (one draw state)
    out_dir = os.path.join(ROOT, 'assets', 'ui')
    os.makedirs(out_dir, exist_ok=True)
    atlas.save(os.path.join(out_dir, 'atlas.png'))

    ts = ['// GENERATED by tools/gen/ui_atlas.py - do not edit. Sprite rectangles in assets/ui/atlas.png.',
          '// Flat numbers (x, y, w, h per sprite) per the Perry conventions in CLAUDE.md.', '']
    for i, (name, _) in enumerate(built):
        ts.append('export const A_%s = %d;' % (name, i))
    ts.append('export const A_COUNT = %d;' % len(built))
    ts.append('')
    ts.append('export const ATLAS_SIZE = %d;' % ATLAS)
    ts.append('export const ATLAS_RECT: number[] = [')
    for i, (name, _) in enumerate(built):
        ts.append('  %d, %d, %d, %d,   // %s' % (rects[i] + (name,)))
    ts.append('];')
    open(os.path.join(ROOT, 'src', 'ui-atlas.ts'), 'w').write('\n'.join(ts) + '\n')
    print('atlas: %d sprites, used height %d of %d' % (len(built), y + shelf, ATLAS))


main()
