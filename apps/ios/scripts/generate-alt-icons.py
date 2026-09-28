#!/usr/bin/env python3
"""Generate sillajuku's alternate app icons (Settings > App Icon).

Each icon is the shipped halftone flower (AppIcon.icon/Assets/
foreground-flower-original.png -- the dotted CMYK look is the brand logo,
never flatten it) composited over a background. The flower's size and
position match the original seven hand-exported icons (checked by
rebuilding AppIcon-Sand and diffing).

Writes, for every design below, the three files Info.plist expects:
  AppIcon-<Name>@2x.png (120), @3x.png (180), @2x~ipad.png (152)
plus IconPreview-Default@3x.png, the default icon's picker thumbnail.

Only the NEW designs are listed here; the original seven PNGs were
exported by hand and are left alone.

Usage (from apps/ios):  python3 scripts/generate-alt-icons.py
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "sillajuku")
FLOWER = os.path.join(ROOT, "AppIcon.icon", "Assets", "foreground-flower-original.png")
OUT = os.path.join(ROOT, "sillajuku", "AlternateIcons")

SIZES = {"@2x": 120, "@3x": 180, "@2x~ipad": 152}
SS = 4  # backgrounds are drawn at 4x and downsampled, for smooth edges


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size, stops, angle_deg=90):
    """Linear gradient; angle 90 = top to bottom, 45 = top-left to bottom-right."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    a = math.radians(angle_deg)
    dx, dy = math.cos(a), math.sin(a)
    # project corners to normalise t into 0...1
    proj = [x * dx + y * dy for x in (0, size) for y in (0, size)]
    lo, hi = min(proj), max(proj)
    for y in range(size):
        for x in range(size):
            t = ((x * dx + y * dy) - lo) / (hi - lo)
            for i in range(len(stops) - 1):
                (t0, c0), (t1, c1) = stops[i], stops[i + 1]
                if t <= t1 or i == len(stops) - 2:
                    u = 0 if t1 == t0 else min(max((t - t0) / (t1 - t0), 0), 1)
                    px[x, y] = lerp(c0, c1, u)
                    break
    return img


def bg_midnight(s):
    img = gradient(s, [(0, (31, 45, 82)), (1, (9, 14, 32))])
    d = ImageDraw.Draw(img, "RGBA")
    rnd = random.Random(7)
    for _ in range(26):
        x, y = rnd.uniform(0, s), rnd.uniform(0, s)
        # keep the flower's middle clear
        if abs(x - s / 2) < s * 0.28 and abs(y - s / 2) < s * 0.28:
            continue
        r = rnd.uniform(0.004, 0.009) * s
        d.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255, rnd.randint(110, 220)))
    return img


def bg_gold(s):
    img = gradient(s, [
        (0.00, (250, 234, 176)),
        (0.35, (214, 170, 78)),
        (0.55, (246, 222, 146)),
        (0.80, (190, 140, 52)),
        (1.00, (232, 200, 120)),
    ], angle_deg=45)
    # soft diagonal sheen
    sheen = Image.new("L", (s, s), 0)
    ImageDraw.Draw(sheen).polygon([(0, s * 0.30), (s * 0.30, 0), (s * 0.45, 0), (0, s * 0.45)], fill=90)
    sheen = sheen.filter(ImageFilter.GaussianBlur(s * 0.04))
    img.paste((255, 250, 225), (0, 0), sheen)
    return img


def bg_gingham(s):
    # Vertical and horizontal bands on separate layers, so where they cross
    # the colour stacks darker -- that's what makes it read as gingham.
    img = Image.new("RGB", (s, s), (250, 247, 240)).convert("RGBA")
    band = (110, 150, 200, 78)
    n = 8
    w = s / n
    for horizontal in (False, True):
        layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        for i in range(0, n, 2):
            box = (0, i * w, s, (i + 1) * w) if horizontal else (i * w, 0, (i + 1) * w, s)
            d.rectangle(box, fill=band)
        img.alpha_composite(layer)
    return img.convert("RGB")


def bg_polka(s):
    img = Image.new("RGB", (s, s), (251, 243, 234))
    d = ImageDraw.Draw(img)
    n = 5
    step = s / n
    r = step * 0.12
    for row in range(-1, n + 2):
        for col in range(-1, n + 2):
            x = col * step + (step / 2 if row % 2 else 0)
            y = row * step * 0.87
            d.ellipse((x - r, y - r, x + r, y + r), fill=(236, 160, 150))
    return img


def bg_sunset(s):
    return gradient(s, [(0, (255, 214, 165)), (0.5, (250, 160, 160)), (1, (196, 168, 232))])


def bg_holo(s):
    img = gradient(s, [
        (0.00, (196, 238, 250)),
        (0.25, (246, 200, 236)),
        (0.50, (220, 206, 250)),
        (0.75, (196, 244, 222)),
        (1.00, (250, 226, 196)),
    ], angle_deg=35)
    return img.filter(ImageFilter.GaussianBlur(s * 0.01))


DESIGNS = {
    "Midnight": bg_midnight,
    "Gold": bg_gold,
    "Gingham": bg_gingham,
    "PolkaDot": bg_polka,
    "Sunset": bg_sunset,
    "Holo": bg_holo,
}


def compose(bg, flower, size):
    k = 0.1925 * size / 180
    f = flower.resize((round(flower.width * k), round(flower.height * k)), Image.LANCZOS)
    icon = bg.resize((size, size), Image.LANCZOS).convert("RGBA")
    ox = round(48 * size / 180 - 145 * k)
    oy = round(45 * size / 180 - 147 * k)
    icon.alpha_composite(f, (ox, oy))
    return icon.convert("RGB")  # app icons must be opaque


def main():
    flower = Image.open(FLOWER).convert("RGBA")
    for name, make_bg in DESIGNS.items():
        big = make_bg(180 * SS)
        for suffix, size in SIZES.items():
            path = os.path.join(OUT, f"AppIcon-{name}{suffix}.png")
            compose(big, flower, size).save(path)
            print("wrote", os.path.relpath(path, ROOT))
    # Picker thumbnail for the default icon (not an alternate icon).
    default = Image.new("RGB", (180 * SS, 180 * SS), (244, 241, 233))
    path = os.path.join(OUT, "IconPreview-Default@3x.png")
    compose(default, flower, 180).save(path)
    print("wrote", os.path.relpath(path, ROOT))


if __name__ == "__main__":
    main()
