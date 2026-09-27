"""The three page layouts: title, tracklist, quote.

Every frame is a full 1080x1920 RGBA composited over a flat ground. There is no
floating card and no blurred wallpaper -- type sits on the page, hung off a
single left axis at MARGIN, the way a monograph spread works.

The title frame and the running head are the *same function* at t=0 and t=1, so
the opening animation and the resting state cannot drift apart.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

from design import (COL, H, MARGIN, SAFE_BOTTOM, SAFE_TOP, W, cover_square,
                    face, fit_lines, ground_layer, measure, palette, rule, text,
                    wrap)

# type scale
SZ_EYEBROW = 30
SZ_TITLE = 78
SZ_HEAD = 27
SZ_HEAD_SUB = 22
SZ_QUOTE_MAX, SZ_QUOTE_MIN = 78, 38
SZ_SCORE = 92
SZ_TRACK = 35
SZ_META = 25

TRACK_LABEL = 4.0        # letterspacing for uppercase labels
LEAD_QUOTE = 1.44
LEAD_TITLE = 1.06

HEAD_THUMB = 84
HEAD_RULE_Y = 212
COVER_BIG = COL          # 904, full measure


def _a(colour, alpha: float = 1.0):
    c = tuple(colour[:3])
    return (*c, round(255 * max(0.0, min(1.0, alpha))))


def _ease(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def _lerp(a, b, t):
    return a + (b - a) * t


# --------------------------------------------------------------------------
def album_page(album: dict, cover: Path, pal: dict, t: float = 0.0,
               canvas: Image.Image | None = None) -> Image.Image:
    """Album identity at `t`: 0 = full title page, 1 = running head.

    The cover travels and scales; the type cross-fades between its two settings
    rather than sliding, because the title starts *below* a 904px cover and ends
    beside an 84px one -- interpolating its position drags it through the art.
    """
    layer = canvas if canvas is not None else Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    e = _ease(t)
    swap = _ease(max(0.0, min(1.0, (t - 0.25) / 0.5)))

    size = round(_lerp(COVER_BIG, HEAD_THUMB, e))
    cx = MARGIN
    cy = round(_lerp(300, SAFE_TOP, e))
    if cover.exists():
        layer.alpha_composite(cover_square(cover, size), (cx, cy))

    artist = (album.get("artist") or "").upper()
    title = album.get("album") or ""

    # --- title page ---
    if swap < 1.0:
        a = 1.0 - swap
        rule(d, MARGIN, 186, MARGIN + 72, _a(pal["accent"], a), 3)
        text(d, (MARGIN, 214), artist, "label", SZ_EYEBROW,
             _a(pal["accent"], a), TRACK_LABEL)

        tsz, lines, lh = fit_lines(d, title, "display", SZ_TITLE, 44, COL,
                                   2 * round(SZ_TITLE * LEAD_TITLE), LEAD_TITLE)
        bits = [b for b in (album.get("year"),
                            f"{len(album.get('tracklist') or [])} TRACKS"
                            if album.get("tracklist") else None) if b]
        meta_h = (SZ_META + 22) if bits else 0

        # Hung off the bottom safe line rather than dropped under the cover.
        # Letting it fall where the artwork ends leaves a quarter of the frame
        # as dead air below it; anchoring turns that slack into a deliberate
        # gap between image and title.
        block_h = len(lines) * lh + meta_h
        ty = H - SAFE_BOTTOM - 40 - block_h
        for ln in lines:
            text(d, (MARGIN, ty), ln, "display", tsz, _a(pal["ink"], a))
            ty += lh
        if bits:
            text(d, (MARGIN, ty + 22), "  ·  ".join(bits).upper(), "label",
                 SZ_META, _a(pal["ink_mute"], a), TRACK_LABEL)

    # --- running head ---
    if swap > 0.0:
        hx = MARGIN + HEAD_THUMB + 24
        htitle = title if measure(d, title, "label", SZ_HEAD, TRACK_LABEL) \
            <= COL - HEAD_THUMB - 24 else title
        text(d, (hx, SAFE_TOP + 6), htitle.upper(), "label", SZ_HEAD,
             _a(pal["ink"], swap), TRACK_LABEL)
        text(d, (hx, SAFE_TOP + 44), artist, "label", SZ_HEAD_SUB,
             _a(pal["accent"], swap), TRACK_LABEL)
        rule(d, MARGIN, HEAD_RULE_Y, MARGIN + COL, _a(pal["ink"], 0.16 * swap), 1)

    return layer


# --------------------------------------------------------------------------
def tracklist_page(album: dict, pal: dict, selected: int | None,
                   revealed: int | None = None, fade: float = 1.0) -> Image.Image:
    """The record's contents, with one track picked out."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    tracks = album.get("tracklist") or []
    if not tracks or fade <= 0:
        return layer
    d = ImageDraw.Draw(layer)

    y0 = HEAD_RULE_Y + 52
    text(d, (MARGIN, y0), "TRACKLIST", "label", SZ_META,
         _a(pal["ink_mute"], 0.9 * fade), TRACK_LABEL)

    top = y0 + 56
    # Rows are distributed across the page rather than stacked at a fixed pitch,
    # so a 12-track record fills the frame instead of ending halfway down it.
    bottom = H - SAFE_BOTTOM - 40
    row_h = max(52, min(112, (bottom - top) // max(1, len(tracks))))
    num_col = 56
    n_show = len(tracks) if revealed is None else revealed

    for i, name in enumerate(tracks):
        if i >= n_show:
            break
        ry = top + i * row_h
        on = (i == selected)
        a = fade

        if on:
            rule(d, MARGIN - 22, ry + 4, MARGIN - 18, _a(pal["accent"], a), 1)
            bar = Image.new("RGBA", (5, row_h - 14), _a(pal["accent"], a))
            layer.alpha_composite(bar, (MARGIN - 24, ry + 2))

        num = f"{i + 1:02d}"
        text(d, (MARGIN, ry + 6), num, "label", SZ_META - 1,
             _a(pal["accent"] if on else pal["ink_mute"], a), 1.5)
        text(d, (MARGIN + num_col, ry), name,
             "serif_bold" if on else "serif", SZ_TRACK,
             _a(pal["ink"] if on else pal["ink_mute"], a if on else 0.95 * a))

        if i < len(tracks) - 1:
            # Centred in the gap. Sitting it a fixed distance below the text
            # makes every rule read as belonging to the track underneath it.
            gap_mid = ry + SZ_TRACK + (row_h - SZ_TRACK) // 2
            rule(d, MARGIN, gap_mid, MARGIN + COL, _a(pal["ink"], 0.10 * a), 1)
    return layer


# --------------------------------------------------------------------------
def quote_page(review: dict, album: dict, pal: dict, reveal: float = 1.0
               ) -> Image.Image:
    """One comment, set as a pull quote.

    The score sits top-right as a display numeral rather than a row of stars.
    Stars are a UI widget; a numeral is what a review page prints, and it holds
    up at thumbnail size where five small glyphs turn to mush.
    """
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    a = max(0.0, min(1.0, reveal))

    score = f"{float(review.get('rating', 0)):.1f}"
    sw = measure(d, score, "display", SZ_SCORE)
    text(d, (MARGIN + COL - sw, HEAD_RULE_Y + 44), score, "display", SZ_SCORE,
         _a(pal["accent"], a))
    text(d, (MARGIN + COL - sw, HEAD_RULE_Y + 44 + SZ_SCORE + 16), "OUT OF 5",
         "label", 20, _a(pal["ink_mute"], a), TRACK_LABEL)

    body_top = HEAD_RULE_Y + 118
    body_bottom = H - SAFE_BOTTOM - 150
    avail = body_bottom - body_top

    quote = review.get("text") or ""
    ko = review.get("text_ko") or ""

    # Reserve room for the translation before sizing the quote, so the two are
    # sized together rather than the translation being whatever fits after.
    ko_share = 0.34 if ko else 0.0
    qsz, qlines, qlh = fit_lines(d, quote, "serif", SZ_QUOTE_MAX, SZ_QUOTE_MIN,
                                 COL, round(avail * (1 - ko_share)), LEAD_QUOTE)
    ksz = max(24, round(qsz * 0.62))
    klines, klh = [], 0
    if ko:
        ksz, klines, klh = fit_lines(d, ko, "serif", ksz, 22, COL,
                                     round(avail * ko_share) - 40, 1.55)

    block_h = len(qlines) * qlh + (40 + len(klines) * klh if klines else 0)
    y = body_top + max(0, (avail - block_h) // 2)

    # The lead-in rule belongs to the quote, not to the top of the page. Parked
    # at a fixed y it just sits opposite the score as a stray mark.
    rule(d, MARGIN, y - 46, MARGIN + 72, _a(pal["accent"], a), 3)

    for ln in qlines:
        text(d, (MARGIN, y), ln, "serif", qsz, _a(pal["ink"], a))
        y += qlh
    if klines:
        y += 40
        for ln in klines:
            text(d, (MARGIN, y), ln, "serif", ksz, _a(pal["ink_mute"], a))
            y += klh

    # attribution
    ay = H - SAFE_BOTTOM - 76
    rule(d, MARGIN, ay - 34, MARGIN + COL, _a(pal["ink"], 0.16 * a), 1)
    user = (review.get("username") or "anonymous").upper()
    text(d, (MARGIN, ay), user, "label", SZ_META, _a(pal["accent"], a), TRACK_LABEL)
    date = (review.get("date") or "").upper()
    if date:
        dw = measure(d, date, "label", SZ_META, TRACK_LABEL)
        text(d, (MARGIN + COL - dw, ay), date, "label", SZ_META,
             _a(pal["ink_mute"], a), TRACK_LABEL)
    return layer


def page(pal: dict) -> Image.Image:
    return ground_layer(pal)
