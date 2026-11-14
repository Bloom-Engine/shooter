#!/usr/bin/env python3
"""Store art in icons/ from the two generated source images (prompts: art/style/keyart/).

  icons/icon-src.png     square key icon  (tools/gen/codex_image.sh ... art/style/keyart/icon-prompt.txt)
  icons/keyart-src.png   wide key art     (... art/style/keyart/keyart-prompt.txt)
->
  icon-1024.png        iOS + macOS app icon (square, no alpha)
  tv-back.png          tvOS layered icon, back layer   (1280x768)
  tv-front.png         tvOS layered icon, front layer  (title, transparent)
  topshelf.png         tvOS Top Shelf        (3840x1440)
  topshelf-wide.png    tvOS Top Shelf Wide   (4640x1440)

tools/release/release.py turns these into per-platform asset catalogs.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parents[2] / "icons"
TITLE = "BLOOM SHOOTER"
FONTS = ["/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf",
         "/System/Library/Fonts/Supplemental/Impact.ttf",
         "/System/Library/Fonts/Helvetica.ttc"]
ORANGE = (232, 122, 44)
BONE = (236, 230, 214)


def font(size):
    for f in FONTS:
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def cover(img, w, h, focus=(0.5, 0.5)):
    """Scale and crop to exactly w x h, keeping the point `focus` (0..1) as centred as possible."""
    s = max(w / img.width, h / img.height)
    im = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    x = min(max(round(im.width * focus[0] - w / 2), 0), im.width - w)
    y = min(max(round(im.height * focus[1] - h / 2), 0), im.height - h)
    return im.crop((x, y, x + w, y + h))


def title_layer(w, h, size, y_frac=0.5, shadow=True):
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    f = font(size)
    words = TITLE.split(" ")
    d = ImageDraw.Draw(layer)
    widths = [d.textlength(wd, font=f) for wd in words]
    gap = size * 0.28
    total = sum(widths) + gap * (len(words) - 1)
    x, y = (w - total) / 2, h * y_frac - size * 0.5
    if shadow:
        sh = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sh)
        xs = x
        for wd, ww in zip(words, widths):
            sd.text((xs, y + size * 0.04), wd, font=f, fill=(0, 0, 0, 210)); xs += ww + gap
        layer = Image.alpha_composite(layer, sh.filter(ImageFilter.GaussianBlur(size * 0.07)))
        d = ImageDraw.Draw(layer)
    for i, (wd, ww) in enumerate(zip(words, widths)):
        d.text((x, y), wd, font=f, fill=(BONE if i == 0 else ORANGE) + (255,)); x += ww + gap
    return layer


def main():
    icon = Image.open(OUT / "icon-src.png").convert("RGB")
    key = Image.open(OUT / "keyart-src.png").convert("RGB")
    icon.resize((1024, 1024), Image.LANCZOS).save(OUT / "icon-1024.png")

    cover(key, 1280, 768).save(OUT / "tv-back.png")
    title_layer(1280, 768, 150, y_frac=0.80).save(OUT / "tv-front.png")

    for name, (w, h) in (("topshelf.png", (3840, 1440)), ("topshelf-wide.png", (4640, 1440))):
        base = cover(key, w, h, focus=(0.5, 0.40)).convert("RGBA")
        # Darken the lower third so the title reads on any crop.
        grad = Image.new("L", (1, h))
        grad.putdata([int(max(0, (y / h - 0.55) / 0.45) * 170) for y in range(h)])
        shade = Image.new("RGBA", (w, h), (0, 0, 0, 255)); shade.putalpha(grad.resize((w, h)))
        base = Image.alpha_composite(base, shade)
        base = Image.alpha_composite(base, title_layer(w, h, 260, y_frac=0.84))
        base.convert("RGB").save(OUT / name)
    for p in sorted(OUT.glob("*.png")):
        print(p.name, Image.open(p).size)


if __name__ == "__main__":
    main()
