#!/usr/bin/env python3
"""The Google Play listing of Bloom Shooter, in fastlane `supply` layout, from the App Store copy.

  python3 android/play/build_listing.py            # text + graphics
  python3 android/play/build_listing.py --text     # text only

Writes android/play/metadata/<play locale>/:
  title.txt, short_description.txt, full_description.txt     (committed)
  images/icon.png, images/featureGraphic.png,
  images/phoneScreenshots/, sevenInchScreenshots/, tenInchScreenshots/   (git-ignored, rebuilt)

The listing copy is store/metadata/source.json (the App Store listing, 13 languages), with the
lines that are only true on Apple devices or on a desktop replaced (PLAY below): the control
bullets name iPhone, iPad and Mac, the Apple TV line goes, key rebinding and aim assist are not
on a touch screen (the binding tab is hidden there and aim assist is a pad aid), and lit fog and
lamp shadows are desktop-only. The screenshots are the App Store captures
(store/screenshots/raw), framed with store/tools/frame_screenshots.py's own functions.

Limits checked here: title <= 30, short description <= 80, full description <= 4000.
"""
import json, os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "android", "play", "metadata")
SRC = json.load(open(os.path.join(ROOT, "store", "metadata", "source.json")))["languages"]

# source.json language -> Play Console locale
LOCALE = {"en": "en-US", "de": "de-DE", "es": "es-ES", "fr": "fr-FR", "it": "it-IT",
          "ja": "ja-JP", "ko": "ko-KR", "pt": "pt-BR", "th": "th", "tr": "tr-TR",
          "vi": "vi", "id": "id", "zh": "zh-CN"}

# One name everywhere: Apple refused "Bloom Shooter" in six storefronts (another developer's
# app); Play has no such rule.
TITLE = "Bloom Shooter"

# short: <= 80. touch: replaces the three control bullets. access: the accessibility bullet
# without aim assist. look: the graphics paragraph without lit fog and lamp shadows.
PLAY = {
    "en": dict(
        short="Third-person alien shooter: five arenas, six weapons and the Matriarch.",
        touch="• Touch controls made for phones and tablets",
        access="• Subtitles and colour palettes for red-green and blue-yellow colour vision deficiency, plus high contrast",
        look="Photoreal creatures and gear, dynamic lighting, a different time of day in every arena, 3D positional sound, and a soundtrack that rises with the fight."),
    "de": dict(
        short="Third-Person-Alien-Shooter: fünf Arenen, sechs Waffen und die Matriarch.",
        touch="• Touch-Steuerung für Smartphones und Tablets",
        access="• Untertitel und Farbpaletten für Rot-Grün- und Blau-Gelb-Sehschwäche sowie hoher Kontrast",
        look="Fotorealistische Kreaturen und Ausrüstung, dynamische Beleuchtung, eine andere Tageszeit in jeder Arena, 3D-Raumklang und ein Soundtrack, der mit dem Kampf anschwillt."),
    "es": dict(
        short="Shooter TPS contra alienígenas: cinco arenas, seis armas y la Matriarch.",
        touch="• Controles táctiles pensados para móviles y tabletas",
        access="• Subtítulos y paletas de color para daltonismo rojo-verde y azul-amarillo, además de alto contraste",
        look="Criaturas y equipo fotorrealistas, iluminación dinámica, una hora del día distinta en cada arena, sonido posicional 3D y una banda sonora que crece con el combate."),
    "fr": dict(
        short="Shooter alien à la 3e personne : cinq arènes, six armes et la Matriarch.",
        touch="• Commandes tactiles pensées pour smartphones et tablettes",
        access="• Sous-titres et palettes de couleurs pour les daltonismes rouge-vert et bleu-jaune, ainsi qu'un mode contraste élevé",
        look="Créatures et équipement photoréalistes, éclairage dynamique, une heure différente dans chaque arène, son 3D positionnel et une bande-son qui monte avec le combat."),
    "it": dict(
        short="Sparatutto TPS contro alieni: cinque arene, sei armi e la Matriarch.",
        touch="• Controlli touch pensati per smartphone e tablet",
        access="• Sottotitoli e palette di colori per il daltonismo rosso-verde e blu-giallo, oltre all'alto contrasto",
        look="Creature ed equipaggiamento fotorealistici, illuminazione dinamica, un'ora del giorno diversa in ogni arena, audio posizionale 3D e una colonna sonora che cresce con lo scontro."),
    "ja": dict(
        short="三人称視点のエイリアンシューター。5つのアリーナ、6つの武器、そして Matriarch。",
        touch="• スマートフォンとタブレット向けのタッチ操作",
        access="• 字幕、赤緑・青黄の色覚特性に配慮したカラーパレット、ハイコントラスト",
        look="フォトリアルなクリーチャーと装備、ダイナミックライティング、アリーナごとに異なる時間帯、3D定位サウンド、そして戦いとともに高まるサウンドトラック。"),
    "ko": dict(
        short="3인칭 에일리언 슈팅 게임. 다섯 개의 아레나, 여섯 가지 무기, 그리고 Matriarch.",
        touch="• 스마트폰과 태블릿에 맞춘 터치 조작",
        access="• 자막, 적록 및 청황 색각 이상을 위한 색상 팔레트, 고대비 모드",
        look="사실적인 크리처와 장비, 다이내믹 라이팅, 아레나마다 다른 시간대, 3D 입체 음향, 그리고 전투와 함께 고조되는 사운드트랙."),
    "pt": dict(
        short="Tiro alienígena em 3ª pessoa: cinco arenas, seis armas e a Matriarch.",
        touch="• Controles de toque feitos para celulares e tablets",
        access="• Legendas e paletas de cores para daltonismo vermelho-verde e azul-amarelo, além de alto contraste",
        look="Criaturas e equipamentos fotorrealistas, iluminação dinâmica, um horário diferente em cada arena, som posicional 3D e uma trilha sonora que cresce com o combate."),
    "th": dict(
        short="เกมยิงเอเลี่ยนมุมบุคคลที่สาม ห้าอารีน่า อาวุธหกแบบ และ Matriarch",
        touch="• ระบบควบคุมแบบสัมผัสสำหรับโทรศัพท์และแท็บเล็ต",
        access="• คำบรรยาย และชุดสีสำหรับผู้มีภาวะบกพร่องในการมองเห็นสีแดง-เขียวและน้ำเงิน-เหลือง พร้อมโหมดคอนทราสต์สูง",
        look="สิ่งมีชีวิตและอุปกรณ์ที่สมจริงระดับภาพถ่าย แสงแบบไดนามิก ช่วงเวลาที่ต่างกันในทุกอารีน่า เสียงสามมิติตามตำแหน่ง และดนตรีประกอบที่เร้าใจขึ้นตามการต่อสู้"),
    "tr": dict(
        short="Üçüncü şahıs uzaylı nişancı: beş arena, altı silah ve Matriarch.",
        touch="• Telefon ve tabletler için dokunmatik kontroller",
        access="• Altyazılar ve kırmızı-yeşil ile mavi-sarı renk körlüğü için renk paletleri, ayrıca yüksek kontrast",
        look="Fotogerçekçi yaratıklar ve teçhizat, dinamik ışıklandırma, her arenada farklı bir gün saati, 3D konumsal ses ve çatışmayla birlikte yükselen bir müzik."),
    "vi": dict(
        short="Bắn súng TPS diệt alien: năm đấu trường, sáu vũ khí và Matriarch.",
        touch="• Điều khiển cảm ứng dành cho điện thoại và máy tính bảng",
        access="• Phụ đề và bảng màu cho người mù màu đỏ-lục và lam-vàng, cùng chế độ tương phản cao",
        look="Sinh vật và trang bị chân thực như ảnh chụp, ánh sáng động, mỗi đấu trường một thời điểm khác nhau trong ngày, âm thanh định vị 3D và nhạc nền dâng trào theo trận chiến."),
    "id": dict(
        short="Game tembak alien orang ketiga: lima arena, enam senjata, dan Matriarch.",
        touch="• Kontrol sentuh untuk ponsel dan tablet",
        access="• Subtitel dan palet warna untuk buta warna merah-hijau dan biru-kuning, serta kontras tinggi",
        look="Makhluk dan perlengkapan fotorealistis, pencahayaan dinamis, waktu yang berbeda di setiap arena, suara posisional 3D, dan musik yang memuncak seiring pertempuran."),
    "zh": dict(
        short="第三人称外星怪物射击：五座竞技场、六种武器，以及 Matriarch。",
        touch="• 专为手机和平板设计的触控操作",
        access="• 字幕、针对红绿与蓝黄色觉障碍的配色方案，以及高对比度模式",
        look="照片级写实的生物与装备，动态光照，每座竞技场都有不同的时段，3D 定位音效，以及随战斗升腾的配乐。"),
}

# Line numbers in every language's App Store description (they share one layout; checked below).
L_LOOK, L_TOUCH, L_PAD, L_REBIND, L_ACCESS, L_TV = 14, 17, 18, 19, 21, 26


def play_description(lang):
    lines = SRC[lang]["description"].split("\n")
    p = PLAY[lang]
    # The layout check: the lines replaced must be the ones that name Apple devices, or the
    # App Store copy changed shape and this table needs updating.
    assert len(lines) == 27, (lang, len(lines))
    assert lines[L_TOUCH].startswith("•") and lines[L_ACCESS].startswith("•"), lang
    assert "Mac" in lines[L_PAD] and "Apple TV" in lines[L_TV], lang
    lines[L_LOOK] = p["look"]
    lines[L_TOUCH] = p["touch"]
    lines[L_ACCESS] = p["access"]
    drop = {L_PAD, L_REBIND, L_TV, L_TV - 1}       # and the blank line before the TV line
    return "\n".join(l for i, l in enumerate(lines) if i not in drop).rstrip() + "\n"


def write_text():
    for lang, loc in LOCALE.items():
        d = os.path.join(OUT, loc)
        os.makedirs(d, exist_ok=True)
        full = play_description(lang)
        short = PLAY[lang]["short"]
        for name, text, limit in (("title.txt", TITLE, 30), ("short_description.txt", short, 80),
                                  ("full_description.txt", full, 4000)):
            n = len(text.rstrip("\n"))
            if n > limit:
                sys.exit(f"{loc}/{name}: {n} characters, the limit is {limit}")
            open(os.path.join(d, name), "w").write(text if text.endswith("\n") else text + "\n")
        print(f"{loc}: short {len(short)}/80, full {len(full)}/4000")


def write_images():
    sys.path.insert(0, os.path.join(ROOT, "store", "tools"))
    import frame_screenshots as F
    from PIL import Image, ImageDraw
    # Play: phone 16:9 (max side 3840, ratio <= 2:1); tablets 16:10. Landscape: the game is.
    sizes = {"phoneScreenshots": (1920, 1080), "sevenInchScreenshots": (1920, 1200),
             "tenInchScreenshots": (2560, 1600)}
    for lang, loc in LOCALE.items():
        img_dir = os.path.join(OUT, loc, "images")
        for kind, (W, H) in sizes.items():
            d = os.path.join(img_dir, kind)
            os.makedirs(d, exist_ok=True)
            for i, (shot, fx) in enumerate(F.SHOTS, 1):
                p = F.raw_path(shot)
                if not p:
                    continue
                src = Image.open(p).convert("RGB")
                base = (F.inset(src, W, H) if fx is None else F.cover(src, W, H, fx)).convert("RGBA")
                base.alpha_composite(F.top_shade(W, H, int(H * 0.36), 200))
                text = F.CAPTIONS.get(lang, F.CAPTIONS["en"]).get(shot) or F.CAPTIONS["en"][shot]
                if lang == "tr":
                    text = text.replace("i", "İ")
                if lang in F.UPPER:
                    text = text.upper()
                F.draw_caption(base, text, W, H)
                base.convert("RGB").save(os.path.join(d, f"{i:02d}-{shot[3:]}.jpg"),
                                         quality=90, subsampling=0, optimize=True)
        # Icon 512 x 512 (32-bit PNG) and the feature graphic 1024 x 500, the same in every locale.
        icon = Image.open(os.path.join(ROOT, "icons", "icon-1024.png")).convert("RGBA")
        icon.resize((512, 512), Image.LANCZOS).save(os.path.join(img_dir, "icon.png"))
        feature_graphic().save(os.path.join(img_dir, "featureGraphic.png"))
    print(f"images -> {OUT}/<locale>/images")


def feature_graphic():
    """1024 x 500: the world capture, darkened on the left under the name in the game's UI face."""
    sys.path.insert(0, os.path.join(ROOT, "store", "tools"))
    import frame_screenshots as F
    from PIL import Image, ImageDraw, ImageFont
    W, H = 1024, 500
    src = Image.open(F.raw_path("01-fight")).convert("RGB")
    img = F.cover(src, W, H, 0.55).convert("RGBA")
    shade = Image.new("RGBA", (W, H))
    sd = ImageDraw.Draw(shade)
    for x in range(W):                              # dark on the left, clear by two thirds
        a = int(210 * max(0.0, 1 - x / (W * 0.62)))
        sd.line([(x, 0), (x, H)], fill=(6, 8, 12, a))
    img.alpha_composite(shade)
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(F.LATIN_FONT, 96)
    x, y = 56, 150
    d.rectangle([x, y - 26, x + 70, y - 18], fill=F.AMBER)
    d.text((x + 3, y + 3), "BLOOM", font=font, fill=(0, 0, 0, 150))
    d.text((x, y), "BLOOM", font=font, fill=(246, 244, 238))
    d.text((x + 3, y + 93), "SHOOTER", font=font, fill=(0, 0, 0, 150))
    d.text((x, y + 90), "SHOOTER", font=font, fill=F.AMBER)
    return img.convert("RGB")


if __name__ == "__main__":
    write_text()
    if "--text" not in sys.argv:
        write_images()
