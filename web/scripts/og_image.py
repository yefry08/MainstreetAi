"""
The link preview card: public/og.png, 1200 x 630.

    python web/scripts/og_image.py

This is what WhatsApp, LinkedIn, Slack and X show when someone pastes a link
to the site. Before it existed a shared link was a bare URL titled
"MainstreetAi · Barcelona" -- the first impression the project made on anyone
it was sent to.

The figures on the card are READ from the same files the site reads -- the
Barcelona recording, the neural model's held-out test, the city catalogue --
so re-running this after a re-record or a retrain cannot leave the card
quoting an old result.
"""

import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WEB = Path(__file__).resolve().parent.parent
OUT = WEB / "public" / "og.png"
W, H = 1200, 630

BG = (11, 14, 21)
INK = (245, 241, 236)
INK_DIM = (155, 148, 140)
ACCENT = (217, 119, 87)
GOOD = (124, 196, 138)
ROAD = (40, 45, 56)


def font(names, size):
    for n in names:
        p = Path("C:/Windows/Fonts") / n
        if p.exists():
            return ImageFont.truetype(str(p), size)
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def _ascii(s):
    """Same accent stripping as citySlug() in cities.js."""
    import unicodedata
    return "".join(ch for ch in unicodedata.normalize("NFD", s) if unicodedata.category(ch) != "Mn")


def figures():
    m = json.loads((WEB / "public" / "replay" / "manifest.json").read_text(encoding="utf-8"))
    a, b = m["stats"]["ai"], m["stats"]["baseline"]
    bcn_speed = 100 * (a["avg_speed_kmh"] - b["avg_speed_kmh"]) / b["avg_speed_kmh"]

    model = json.loads((WEB / "public" / "models" / "signal-controller.json").read_text(encoding="utf-8"))
    t = model["meta"]["test"]["summary"]

    # "Ready to analyse" means baked: counted from public/cities/index.json,
    # not from the catalogue, which can list cities whose bake failed.
    src = (WEB / "src" / "city" / "cities.js").read_text(encoding="utf-8")
    latam_countries = {"Mexico", "Guatemala", "El Salvador", "Honduras", "Nicaragua", "Costa Rica",
                       "Panama", "Cuba", "Haiti", "Puerto Rico", "Dominican Rep.", "Venezuela",
                       "Colombia", "Ecuador", "Peru", "Bolivia", "Chile", "Argentina", "Uruguay",
                       "Paraguay", "Brazil"}
    country_of = {}
    for country, name in re.findall(r"country: '([^']+)',\s*flag: '[^']+', name: '([^']+)'", src):
        slug = re.sub(r"[^a-z0-9]+", "-", _ascii(name).lower()).strip("-")
        country_of[slug] = country
    ready = json.loads((WEB / "public" / "cities" / "index.json").read_text(encoding="utf-8"))["cities"]
    total = len(ready)
    latam = sum(1 for c in ready if country_of.get(c["slug"]) in latam_countries)
    return [
        (f"{t['nn_stopped_mean']:+.0f}%".replace("-", "−"), "time stopped at lights",
         f"neural controller, {t['cities']} unseen cities"),
        (f"{bcn_speed:+.0f}%", "average speed", "Barcelona digital twin"),
        (f"{total}", "cities ready to analyse", f"{latam} in Latin America"),
    ]


def main():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # A street grid fading in from the right: the product, abstracted.
    for i in range(9):
        x = 700 + i * 62
        d.line([(x, 0), (x - 120, H)], fill=ROAD, width=6)
    for j in range(8):
        y = 40 + j * 80
        d.line([(640, y), (W, y - 40)], fill=ROAD, width=6)
    for (x, y) in [(830, 182), (954, 258), (1078, 98), (892, 418), (1016, 498), (1140, 338)]:
        d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=ACCENT)
    # Fade the grid under the text.
    fade = Image.new("L", (W, H), 0)
    fd = ImageDraw.Draw(fade)
    for x in range(W):
        fd.line([(x, 0), (x, H)], fill=int(255 * max(0.0, min(1.0, (x - 560) / 420))))
    img = Image.composite(img, Image.new("RGB", (W, H), BG), fade)
    d = ImageDraw.Draw(img)

    bold = ["segoeuib.ttf", "arialbd.ttf"]
    semi = ["seguisb.ttf", "segoeuib.ttf", "arialbd.ttf"]
    mono = ["consola.ttf"]

    d.rounded_rectangle([64, 60, 88, 84], radius=5, fill=ACCENT)
    d.text((100, 56), "MainstreetAi", font=font(bold, 28), fill=INK)
    d.text((64, 128), "ADAPTIVE TRAFFIC SIGNALS · REAL CITIES · DIGITAL TWINS",
           font=font(mono, 20), fill=ACCENT)
    title = font(bold, 64)
    d.text((64, 166), "Same streets. Same traffic.", font=title, fill=INK)
    d.text((64, 242), "Smarter traffic lights.", font=title, fill=INK)

    x = 64
    for big, label, sub in figures():
        d.text((x, 370), big, font=font(bold, 60), fill=GOOD if big[0] in "+−" else INK)
        d.text((x, 446), label, font=font(semi, 24), fill=INK)
        d.text((x, 480), sub, font=font(semi, 20), fill=INK_DIM)
        x += 360

    d.text((64, 560), "yefry08.github.io/MainstreetAi", font=font(mono, 22), fill=INK_DIM)
    img.save(OUT, optimize=True)
    print(f"{OUT.relative_to(WEB)}: {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
