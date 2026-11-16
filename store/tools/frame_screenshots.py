#!/usr/bin/env python3
"""Store screenshots: a game capture, full bleed, cropped to each device, with a caption.

Input:  store/screenshots/raw/<shot>.(png|jpg) for each id in SHOTS (pick them from
        store/screenshots/raw/captures/, which store/tools/capture.sh fills)
        store/metadata/captions.json
Output: store/screenshots/out/<device>/<lang>/NN-<shot>.jpg, exact App Store sizes, JPEG
        (accepted by App Store Connect, a tenth of the PNG size: the disk is tight).

The look: the frame fills the screen; a dark band fades down from the top edge and the caption
sits on it in the game's own UI face (Rajdhani SemiBold), upper case, with a short accent rule
in the HUD's amber. Scripts Rajdhani does not cover (ja, ko, zh, th, and any missing glyph)
fall back to Arial Unicode.

  python3 store/tools/frame_screenshots.py [--lang en] [--device iphone_6_9]
"""
import argparse, json, os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RAW = os.path.join(ROOT, "store", "screenshots", "raw")
OUT = os.path.join(ROOT, "store", "screenshots", "out")
CAPTIONS = json.load(open(os.path.join(ROOT, "store", "metadata", "captions.json")))["captions"]

LATIN_FONT = os.path.join(ROOT, "assets", "fonts", "Rajdhani-SemiBold.ttf")
WIDE_FONT = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"
UPPER = {"en", "de", "es", "fr", "it", "pt", "tr", "vi", "id"}   # scripts with case

# Store order. Each shot carries a horizontal focus (0..1) used when a crop is narrower than
# the capture (the iPad's 4:3 loses a fifth of a 16:10 frame), or None for an INSET shot: a
# menu, which no crop may cut and the caption must not cover, is drawn whole below the caption
# over a blurred, darkened copy of itself.
SHOTS = [("01-fight", 0.5), ("02-boss", 0.5), ("03-arenas", None), ("04-night", 0.5),
         ("05-weapons", 0.5), ("06-objective", 0.5), ("07-armory", None), ("08-world", 0.5)]

# Exact accepted sizes (landscape: the game is landscape only).
DEVICES = {
    "iphone_6_9": (2868, 1320),   # 6.9" display; also covers the smaller iPhones
    "ipad_13":    (2752, 2064),   # 13" display
    "mac":        (2880, 1800),
    "apple_tv":   (1920, 1080),
}
AMBER = (240, 178, 64)


def cover(img, W, H, fx):
    """Scale to cover W x H, crop around horizontal focus fx."""
    w, h = img.size
    s = max(W / w, H / h)
    img = img.resize((round(w * s), round(h * s)), Image.LANCZOS)
    w, h = img.size
    x = min(max(0, round(fx * w - W / 2)), w - W)
    y = (h - H) // 2
    return img.crop((x, y, x + W, y + H))


def inset(img, W, H):
    """The whole capture, fitted below the caption, over a blurred copy of itself."""
    back = cover(img, W, H, 0.5).filter(ImageFilter.GaussianBlur(H / 40))
    back = Image.blend(back, Image.new("RGB", (W, H), (6, 8, 12)), 0.55)
    top = int(H * 0.30)                     # the caption's band
    margin = int(min(W, H) * 0.045)
    w, h = img.size
    s = min((W - 2 * margin) / w, (H - top - margin) / h)
    fg = img.resize((round(w * s), round(h * s)), Image.LANCZOS)
    x = (W - fg.size[0]) // 2
    y = top + (H - top - margin - fg.size[1]) // 2
    shadow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(shadow).rectangle([x - 6, y - 6, x + fg.size[0] + 6, y + fg.size[1] + 6], fill=170)
    back.paste((0, 0, 0), (0, 0), shadow.filter(ImageFilter.GaussianBlur(14)))
    back.paste(fg, (x, y))
    ImageDraw.Draw(back).rectangle([x - 1, y - 1, x + fg.size[0], y + fg.size[1]],
                                   outline=(90, 96, 104), width=2)
    return back


def top_shade(W, H, depth, alpha):
    band = Image.new("L", (1, depth))
    for y in range(depth):
        t = 1 - y / depth
        band.putpixel((0, y), int(alpha * t * t * (3 - 2 * t)))   # smoothstep falloff
    shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shade.paste(Image.new("RGBA", (W, depth), (6, 8, 12, 255)), (0, 0), band.resize((W, depth)))
    return shade


_cmap = None


def latin_covers(text):
    global _cmap
    if _cmap is None:
        from fontTools.ttLib import TTFont
        _cmap = set(TTFont(LATIN_FONT).getBestCmap())
    return all(ord(c) in _cmap or c == " " for c in text)


def caption_font(text, px):
    path = LATIN_FONT if latin_covers(text) else WIDE_FONT
    # Arial Unicode is a regular weight and sets larger than Rajdhani: smaller, and stroked.
    if path == WIDE_FONT:
        return ImageFont.truetype(path, int(px * 0.78)), max(1, px // 40)
    return ImageFont.truetype(path, px), 0


def draw_caption(canvas, text, W, H):
    draw = ImageDraw.Draw(canvas)
    margin = int(H * 0.075)
    px = int(H * 0.085)
    max_w = W - 2 * margin
    while True:
        font, stroke = caption_font(text, px)
        if draw.textlength(text, font=font) <= max_w or px < H * 0.04:
            break
        px -= 4
    rule_h = max(4, int(H * 0.008))
    draw.rectangle([margin, margin, margin + int(H * 0.09), margin + rule_h], fill=AMBER)
    y = margin + rule_h + int(H * 0.022)
    off = max(2, px // 28)
    draw.text((margin + off, y + off), text, font=font, fill=(0, 0, 0, 150),
              stroke_width=stroke, stroke_fill=(0, 0, 0, 150))
    draw.text((margin, y), text, font=font, fill=(246, 244, 238),
              stroke_width=stroke, stroke_fill=(246, 244, 238))


def raw_path(shot):
    for ext in (".png", ".jpg"):
        p = os.path.join(RAW, shot + ext)
        if os.path.exists(p):
            return p
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang")
    ap.add_argument("--device")
    a = ap.parse_args()
    langs = [a.lang] if a.lang else list(CAPTIONS)
    devices = [a.device] if a.device else list(DEVICES)
    n = 0
    missing = [s for s, _ in SHOTS if not raw_path(s)]
    if missing:
        print("no capture for: " + ", ".join(missing))
    for shot_i, (shot, fx) in enumerate(SHOTS, 1):
        p = raw_path(shot)
        if not p:
            continue
        src = Image.open(p).convert("RGB")
        for dev in devices:
            W, H = DEVICES[dev]
            base = (inset(src, W, H) if fx is None else cover(src, W, H, fx)).convert("RGBA")
            base.alpha_composite(top_shade(W, H, int(H * 0.36), 200))
            for lang in langs:
                text = CAPTIONS.get(lang, CAPTIONS["en"]).get(shot) or CAPTIONS["en"][shot]
                if lang == "tr":                    # dotted capital I
                    text = text.replace("i", "İ")
                if lang in UPPER:
                    text = text.upper()
                img = base.copy()
                draw_caption(img, text, W, H)
                d = os.path.join(OUT, dev, lang)
                os.makedirs(d, exist_ok=True)
                img.convert("RGB").save(os.path.join(d, f"{shot_i:02d}-{shot[3:]}.jpg"),
                                        quality=90, subsampling=0, optimize=True)
                n += 1
    print(f"{n} images -> {OUT}")


if __name__ == "__main__":
    main()
