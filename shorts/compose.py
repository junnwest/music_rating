#!/usr/bin/env python3
"""Draw the pages: ground, comment pages, and the opening frame sequence.

    python compose.py --all --intro
    python compose.py --slug SLUG --preview /tmp/p.png

Two artefacts per reel, deliberately separated:

* `cache/ground/{album}.png` -- the flat ground, opaque, one per record.
* `cache/cards/{slug}.png`   -- page content, transparent.

They stay apart because the crossfade needs them apart. If the ground were baked
into each page, the xfade would cross-dissolve two pages of type into each other
and the body copy would double-expose into mush. Split, the transition dissolves
two identical grounds -- invisible -- while each page's own alpha ramp takes its
type out before the next one's comes in.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image

import frames
from common import (CARDS, COVERS, FPS, GROUND, INTRO, load_album, load_reviews,
                    slugify)
from design import H, W, palette

INTRO_SLUG = "__intro__"

# opening beats
INTRO_HOLD = 1.5       # title page, still
INTRO_SETTLE = 1.15    # cover travels up into the running head
INTRO_PAUSE = 0.4
INTRO_ROW = 0.075      # tracklist rows dealing in
INTRO_SCAN = 0.11      # per track, running the highlight down
INTRO_LAND = 1.8       # hold on the chosen track


def cover_for(album: dict) -> Path:
    return COVERS / f"{slugify(album.get('artist',''), album.get('album',''))}.jpg"


def intro_duration(album: dict) -> float:
    n = len(album.get("tracklist") or [])
    return (INTRO_HOLD + INTRO_SETTLE + INTRO_PAUSE
            + n * INTRO_ROW + n * INTRO_SCAN + INTRO_LAND)


def intro_state(album: dict, t: float):
    """(album position 0..1, rows revealed, selected track, list opacity)."""
    tracks = album.get("tracklist") or []
    n = len(tracks)
    if t < INTRO_HOLD:
        return 0.0, 0, None, 0.0
    t -= INTRO_HOLD
    if t < INTRO_SETTLE:
        return t / INTRO_SETTLE, 0, None, 0.0
    t -= INTRO_SETTLE
    if t < INTRO_PAUSE:
        return 1.0, 0, None, 0.0
    t -= INTRO_PAUSE
    if t < n * INTRO_ROW:                       # rows deal in one at a time
        return 1.0, min(n, int(t / INTRO_ROW) + 1), None, 1.0
    t -= n * INTRO_ROW
    if t < n * INTRO_SCAN:                      # highlight runs the list
        return 1.0, n, min(n - 1, int(t / INTRO_SCAN)), 1.0
    target = album.get("highlight")
    return 1.0, n, (tracks.index(target) if target in tracks else n - 1), 1.0


def build_ground(album: dict) -> Path:
    cover = cover_for(album)
    pal = palette(cover)
    dest = GROUND / f"{slugify(album.get('artist',''), album.get('album',''))}.png"
    frames.page(pal).convert("RGB").save(dest)
    return dest


def build_intro(album: dict) -> tuple[int, float]:
    """Write cache/intro/%05d.png for the opening, transparent over the ground."""
    import shutil

    for old in INTRO.glob("*.png"):
        old.unlink()

    cover = cover_for(album)
    pal = palette(cover)
    dur = intro_duration(album)
    n_frames = max(1, round(dur * FPS))
    seen: dict[tuple, Path] = {}

    for i in range(n_frames):
        pos, revealed, sel, fade = intro_state(album, i / FPS)
        key = (round(pos, 3), revealed, sel, round(fade, 2))
        dest = INTRO / f"{i:05d}.png"
        if key in seen:                        # long holds cost a file copy
            shutil.copyfile(seen[key], dest)
            continue
        layer = frames.album_page(album, cover, pal, pos)
        if revealed:
            layer.alpha_composite(
                frames.tracklist_page(album, pal, sel, revealed, fade))
        layer.save(dest, compress_level=1)
        seen[key] = dest

    (INTRO / "intro.json").write_text(json.dumps(
        {"frames": n_frames, "duration": round(dur, 3), "fps": FPS,
         "slug": INTRO_SLUG}, indent=2))
    return n_frames, dur


def build_page(review: dict, album: dict | None) -> Image.Image:
    cover = cover_for(album) if album else COVERS / f"{review['cover_slug']}.jpg"
    pal = palette(cover)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if album:
        frames.album_page(album, cover, pal, 1.0, layer)
    layer.alpha_composite(frames.quote_page(review, album or {}, pal))
    return layer


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--intro", action="store_true")
    ap.add_argument("--theme", default="dark")     # kept for CLI compatibility
    ap.add_argument("--preview", help="flattened still, for eyeballing")
    ap.add_argument("--reviews", default="reviews.json")
    args = ap.parse_args()

    reviews = load_reviews(args.reviews)
    album = load_album(args.reviews)

    if album:
        print(f"ground -> {build_ground(album).name}")
    if args.intro and album:
        n, dur = build_intro(album)
        print(f"intro: {n} frames, {dur:.2f}s")

    targets = reviews if args.all else [r for r in reviews if r["slug"] == args.slug]
    if not targets and not args.intro:
        raise SystemExit(f"no review matching --slug {args.slug!r}")

    for r in targets:
        page = build_page(r, album)
        dest = CARDS / f"{r['slug']}.png"
        page.save(dest)
        print(f"{dest.name}")

        if args.preview:
            cover = cover_for(album) if album else COVERS / f"{r['cover_slug']}.jpg"
            flat = frames.page(palette(cover))
            flat.alpha_composite(page)
            flat.convert("RGB").save(args.preview, quality=95)
            print(f"preview -> {args.preview}")


if __name__ == "__main__":
    main()
