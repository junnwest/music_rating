#!/usr/bin/env python3
"""Generate stand-in cover art so the layout can be iterated on offline.

    python tools/placeholder_covers.py

Writes cache/covers/{slug}.jpg for any review that doesn't have one yet.
Real art comes from fetch_art.py; this is only for design passes.
"""
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

from common import COVERS, load_reviews  # noqa: E402

for r in load_reviews():
    dest = COVERS / f"{r['slug']}.jpg"
    if dest.exists():
        continue
    random.seed(r["slug"])
    a = tuple(random.randint(20, 70) for _ in range(3))
    b = tuple(min(255, c + random.randint(50, 130)) for c in a)
    img = Image.new("RGB", (1200, 1200), a)
    d = ImageDraw.Draw(img)
    for i in range(1200):
        t = i / 1200
        d.line([(0, i), (1200, i)],
               fill=tuple(int(a[k] + (b[k] - a[k]) * t) for k in range(3)))
    for _ in range(28):
        x, y = random.randint(0, 1200), random.randint(0, 1200)
        rad = random.randint(60, 320)
        d.ellipse([x - rad, y - rad, x + rad, y + rad],
                  outline=tuple(min(255, c + 40) for c in b),
                  width=random.randint(1, 6))
    img.filter(ImageFilter.GaussianBlur(1.2)).save(dest, quality=90)
    print(dest)
