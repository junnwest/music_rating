"""Editorial design system: palette, type scale, grid.

The look is a music monograph page rather than a screenshot of a comment. Three
decisions carry it:

* **Colour comes from the record, not from a blur.** A flat ground and one accent
  are extracted from the cover, so every album gets a bespoke palette out of the
  same rules. Gaussian-blurring the artwork behind everything is the default move
  in music graphics precisely because it needs no decisions; it also muddies
  contrast unpredictably, which is why type on it always has to be shadowed.
* **The artwork is reproduced sharp, on the grid.** It is the best image we have;
  wallpapering with it out of focus wastes it.
* **A serif carries the words.** Georgia for latin, Noto Serif KR for Hangul --
  a real pairing, both high-contrast oldstyle-ish faces, so a bilingual card
  reads as one voice. Metadata is Bahnschrift, uppercase and letterspaced.
"""
from __future__ import annotations

import colorsys
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw

W, H = 1080, 1920

# --------------------------------------------------------------------------
# grid
# --------------------------------------------------------------------------
MARGIN = 88                    # the left axis everything hangs from
COL = W - 2 * MARGIN           # 904
SAFE_TOP = 96                  # platform chrome
SAFE_BOTTOM = 260              # caption / UI furniture on the feed

# --------------------------------------------------------------------------
# type
# --------------------------------------------------------------------------
FACES = {
    # display: a newspaper grotesque, set large and tight
    ("display", "latin"): "C:/Windows/Fonts/framd.ttf",
    ("display", "ko"): "C:/Windows/Fonts/malgunbd.ttf",
    # serif: the voice of the piece
    ("serif", "latin"): "C:/Windows/Fonts/georgia.ttf",
    ("serif", "ko"): "C:/Windows/Fonts/NotoSerifKR-VF.ttf",
    ("serif_italic", "latin"): "C:/Windows/Fonts/georgiai.ttf",
    ("serif_italic", "ko"): "C:/Windows/Fonts/NotoSerifKR-VF.ttf",
    ("serif_bold", "latin"): "C:/Windows/Fonts/georgiab.ttf",
    ("serif_bold", "ko"): "C:/Windows/Fonts/NotoSerifKR-VF.ttf",
    # label: technical, uppercase, letterspaced
    ("label", "latin"): "C:/Windows/Fonts/bahnschrift.ttf",
    ("label", "ko"): "C:/Windows/Fonts/malgun.ttf",
}


@lru_cache(maxsize=None)
def face(role: str, size: int, script: str = "latin"):
    from PIL import ImageFont

    path = FACES.get((role, script)) or FACES[(role, "latin")]
    if not Path(path).exists():                       # graceful, not silent
        path = FACES[("serif", "latin")]
    return ImageFont.truetype(path, size)


# --------------------------------------------------------------------------
# palette
# --------------------------------------------------------------------------
def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def _hsv(rgb):
    r, g, b = (c / 255 for c in rgb[:3])
    return colorsys.rgb_to_hsv(r, g, b)


def _rgb(h, s, v):
    return tuple(round(c * 255) for c in colorsys.hsv_to_rgb(h, _clamp(s), _clamp(v)))


@lru_cache(maxsize=32)
def palette(cover: Path | str, dark: bool = True) -> dict:
    """Ground, accent and ink derived from one cover.

    Quantising to a small palette and weighting by area finds what the sleeve is
    actually *made of*; picking the single most saturated pixel would hand you a
    stray highlight. The accent is then pushed to a usable chroma and the ground
    pulled far enough down that body copy clears contrast without a shadow.
    """
    img = Image.open(cover).convert("RGB").resize((96, 96), Image.LANCZOS)
    quant = img.quantize(colors=12, method=Image.MEDIANCUT).convert("RGB")
    counts = sorted(quant.getcolors(96 * 96) or [], reverse=True)

    entries = [(n, c) for n, c in counts if n]
    if not entries:
        entries = [(1, (40, 40, 44))]

    # accent: best trade-off of area and chroma, ignoring near-greys
    def score(item):
        n, c = item
        h, s, v = _hsv(c)
        if s < 0.18 or v < 0.12:
            return -1.0
        return (n ** 0.5) * (s ** 1.2) * (0.35 + v)

    ranked = sorted(entries, key=score, reverse=True)
    accent_src = ranked[0][1] if score(ranked[0]) > 0 else entries[0][1]
    ah, asat, av = _hsv(accent_src)
    # Floors, not just a multiplier: photographic sleeves are mostly low-chroma,
    # so a faithful sample comes back as mud that dies on a near-black ground.
    # These push it to somewhere it can actually carry a label.
    accent = _rgb(ah, max(0.52, min(0.86, asat * 1.4)),
                  max(0.74, min(0.95, av * 1.35)))

    # ground: the dominant tone, taken right down (or up) and desaturated
    gh, gs, gv = _hsv(entries[0][1])
    if dark:
        # Keep a little of the sleeve's hue so the ground isn't dead grey.
        ground = _rgb(gh, min(gs * 0.7, 0.34), 0.10 + 0.055 * gv)
        ground2 = _rgb(gh, min(gs * 0.62, 0.28), 0.058 + 0.04 * gv)
        ink = (247, 245, 242)
        ink_mute = (150, 146, 140)
        rule = (255, 255, 255, 38)
    else:
        ground = _rgb(gh, min(gs * 0.10, 0.05), 0.965)
        ground2 = _rgb(gh, min(gs * 0.14, 0.07), 0.925)
        ink = (22, 21, 20)
        ink_mute = (122, 118, 112)
        rule = (0, 0, 0, 34)

    return {
        "ground": ground, "ground2": ground2,
        "accent": accent, "ink": ink, "ink_mute": ink_mute, "rule": rule,
    }


# --------------------------------------------------------------------------
# drawing primitives
# --------------------------------------------------------------------------
def ground_layer(pal: dict) -> Image.Image:
    """Flat ground with a long vertical gradient -- enough to stop 1080x1920 of
    single colour reading as flat dead space, not enough to be a 'gradient'."""
    top, bottom = pal["ground"], pal["ground2"]
    base = Image.new("RGB", (1, H))
    px = base.load()
    for y in range(H):
        t = y / (H - 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return base.resize((W, H), Image.BILINEAR).convert("RGBA")


def tracked(d: ImageDraw.ImageDraw, xy, text: str, fnt, fill, track: float = 0.0):
    """Draw with letterspacing. Pillow has no tracking, and uppercase labels are
    unreadable without it -- that spacing is most of what makes them read as
    editorial furniture rather than shouting."""
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=fnt, fill=fill)
        x += d.textlength(ch, font=fnt) + track
    return x


def tracked_len(d: ImageDraw.ImageDraw, text: str, fnt, track: float = 0.0) -> float:
    if not text:
        return 0.0
    return sum(d.textlength(c, font=fnt) for c in text) + track * (len(text) - 1)


def cover_square(path: Path, size: int, radius: int = 0) -> Image.Image:
    """Sharp, centre-cropped square. No blur, no rounding unless asked."""
    img = Image.open(path).convert("RGB")
    side = min(img.size)
    left, top = (img.width - side) // 2, (img.height - side) // 2
    img = img.crop((left, top, left + side, top + side)).resize(
        (size, size), Image.LANCZOS)
    out = img.convert("RGBA")
    if radius:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1],
                                               radius, fill=255)
        out.putalpha(mask)
    return out


def rule(d: ImageDraw.ImageDraw, x0: int, y: int, x1: int, colour, weight: int = 1):
    d.rectangle([x0, y, x1, y + weight - 1], fill=colour)


# --------------------------------------------------------------------------
# mixed-script type
# --------------------------------------------------------------------------
# Same reasoning as before: the latin faces carry no Hangul, and the Korean
# faces set latin in a hand that isn't Georgia. Runs are drawn per script on a
# shared baseline. Neutrals (space, ascii punctuation) join the run they follow.
_KO = ((0x1100, 0x11FF), (0x3000, 0x303F), (0x3130, 0x318F), (0x3400, 0x4DBF),
       (0x4E00, 0x9FFF), (0xA960, 0xA97F), (0xAC00, 0xD7A3), (0xD7B0, 0xD7FF),
       (0xF900, 0xFAFF), (0xFF00, 0xFFEF))


def script_of(ch: str):
    if ch.isspace() or (ch.isascii() and not ch.isalnum()):
        return None
    cp = ord(ch)
    return "ko" if any(lo <= cp <= hi for lo, hi in _KO) else "latin"


def runs(text: str):
    out = []
    for ch in text:
        s = script_of(ch)
        if s is None and out:
            out[-1][1] += ch
        elif out and out[-1][0] == (s or "latin"):
            out[-1][1] += ch
        else:
            out.append([s or "latin", ch])
    return [(s, t) for s, t in out]


def measure(d, text: str, role: str, size: int, track: float = 0.0) -> float:
    total = 0.0
    for s, t in runs(text):
        f = face(role, size, s)
        total += (sum(d.textlength(c, font=f) for c in t) + track * len(t)
                  if track else d.textlength(t, font=f))
    return max(0.0, total - (track if track else 0.0))


def text(d, xy, s: str, role: str, size: int, fill, track: float = 0.0):
    """Draw one line, per-script faces, one baseline. `xy` is the ascender line."""
    x, y = xy
    baseline = y + face(role, size, "latin").getmetrics()[0]
    for script, chunk in runs(s):
        f = face(role, size, script)
        if track:
            for ch in chunk:
                d.text((x, baseline), ch, font=f, fill=fill, anchor="ls")
                x += d.textlength(ch, font=f) + track
        else:
            d.text((x, baseline), chunk, font=f, fill=fill, anchor="ls")
            x += d.textlength(chunk, font=f)
    return x


def wrap(d, s: str, role: str, size: int, max_w: int, track: float = 0.0):
    lines, cur = [], ""
    for word in s.split():
        trial = f"{cur} {word}".strip()
        if measure(d, trial, role, size, track) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def fit_lines(d, s: str, role: str, hi: int, lo: int, max_w: int, max_h: int,
              leading: float):
    """Largest size in [lo, hi] whose wrapped block fits max_h."""
    for size in range(hi, lo - 1, -1):
        lines = wrap(d, s, role, size, max_w)
        lh = round(size * leading)
        if len(lines) * lh <= max_h:
            return size, lines, lh
    size = lo
    lines = wrap(d, s, role, size, max_w)
    lh = round(size * leading)
    keep = max(1, max_h // lh)
    if len(lines) > keep:
        lines = lines[:keep]
        lines[-1] = lines[-1].rstrip(" ,.;:") + "\u2026"
    return size, lines, lh
