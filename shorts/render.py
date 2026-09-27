#!/usr/bin/env python3
"""Render clips from cover + card, then chain them with beat-aligned crossfades.

Two passes on purpose: the per-card clips are cached, so re-rendering after a
copy edit only touches the card that changed.

    python render.py                       # uses timeline.json
    python render.py --only duster-stratosphere
    python render.py --force --out out/week12.mp4
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from common import CARDS, CLIPS, FPS, GROUND, H, INTRO, OUT, W, run

INTRO_SLUG = "__intro__"

OPEN_FADE = 0.6
CLOSE_FADE = 0.9

# Remaining-time gauge. A hairline, not a designed progress bar -- it sits above
# the tallest possible card (card_y floors at 110 in compose.py) and reads as a
# platform affordance rather than decoration.
GAUGE_X, GAUGE_Y, GAUGE_H = 60, 84, 4
GAUGE_STEP = 0.25          # seconds per gauge increment


def clip_filter(duration: float, drift: float, transition: float,
                first: bool, last: bool, card_pre: str = "") -> str:
    """One clip: drifting blurred cover, card overlaid with its own alpha ramp.

    The card is faded out over the FIRST half of the outgoing crossfade window
    and the next card faded in over the SECOND half, so the two cards are never
    on screen together -- during the handoff only the blurred backgrounds
    dissolve. A plain xfade double-exposes the body text into mush.
    """
    half = transition / 2.0

    fade_in = (f"fade=t=in:st={half:.3f}:d={half:.3f}:alpha=1" if not first
               else f"fade=t=in:st=0:d={OPEN_FADE}:alpha=1")
    out_st = (duration - transition) if not last else (duration - CLOSE_FADE)
    out_d = half if not last else CLOSE_FADE
    fade_out = f"fade=t=out:st={max(0.0, out_st):.3f}:d={out_d:.3f}:alpha=1"

    # The ground is already the finished 1080x1920 field -- flat colour derived
    # from the sleeve, not a blurred copy of it -- so there is nothing to blur,
    # darken or drift. It just gets held while the page fades over it.
    return (
        f"[0:v]scale={W}:{H},setsar=1[bg];"
        f"[1:v]format=rgba,{card_pre}{fade_in},{fade_out}[card];"
        f"[bg][card]overlay=0:0:format=auto,format=yuv420p[v]"
    )


def gauge_chain(tl: dict) -> str:
    """Depleting hairline showing how much of the current comment is left.

    Drawn here, over the assembled reel, rather than per clip: a per-clip gauge
    would be cross-dissolved by the xfade, so a nearly-empty bar would ghost
    through a full one at every cut. Built from the cut times, it just resets.

    Stepped rather than continuous because drawbox does NOT evaluate its w/h
    expressions per frame -- give it `w='960*(1-t/14)'` and it silently ignores
    the expression and falls back to full width. Its `enable` option *is*
    timeline-aware, so the bar is a run of fixed-width boxes each switched on for
    one GAUGE_STEP slice. At a quarter-second per step it reads as smooth.
    """
    width = W - 2 * GAUGE_X
    spans, prev = [], 0.0
    for cut in list(tl["cuts"]) + [tl["total"]]:
        spans.append((prev, cut))
        prev = cut

    box = f"x={GAUGE_X}:y={GAUGE_Y}:h={GAUGE_H}:t=fill"
    parts = [f"drawbox={box}:w={width}:color=white@0.16"]
    for start, end in spans:
        span = max(0.001, end - start)
        steps = max(1, math.ceil(span / GAUGE_STEP))
        for k in range(steps):
            a = start + k * span / steps
            b = start + (k + 1) * span / steps
            remaining = 1.0 - (k + 0.5) / steps
            parts.append(
                f"drawbox=enable='between(t,{a:.3f},{b:.3f})':{box}"
                f":w={max(1, round(width * remaining))}:color=white@0.75"
            )
    return ",".join(parts)


def render_clip(slug: str, duration: float, drift: float, crf: int,
                preset: str, force: bool, transition: float = 0.8,
                first: bool = True, last: bool = True,
                cover_slug: str | None = None) -> Path:
    # The cover belongs to the album, the card to the comment -- in a
    # single-album reel many comments share one cover.
    is_intro = slug == INTRO_SLUG
    cover = GROUND / f"{cover_slug or slug}.png"
    # The intro's overlay is a frame sequence, not a single card.
    card = (INTRO / "intro.json") if is_intro else (CARDS / f"{slug}.png")
    dest = CLIPS / f"{slug}.mp4"
    for f in (cover, card):
        if not f.exists():
            raise SystemExit(f"missing {f} — run fetch_art.py / compose.py first")

    stamp = CLIPS / f"{slug}.stamp"
    key = (f"{duration:.3f}|{drift}|{crf}|{transition}|{first}|{last}"
           f"|{card.stat().st_mtime_ns}|{cover.stat().st_mtime_ns}")
    if dest.exists() and not force and stamp.exists() and stamp.read_text() == key:
        print(f"  cached  {slug}")
        return dest

    if is_intro:
        # The sequence is exactly as long as the animation; if the timeline hands
        # this clip more time than that, hold the final frame rather than looping
        # back to a centred album that has already settled.
        card_in = ["-framerate", str(FPS), "-i", str(INTRO / "%05d.png")]
        card_pre = "tpad=stop_mode=clone:stop_duration=60,"
    else:
        card_in = ["-framerate", str(FPS), "-loop", "1",
                   "-t", f"{duration:.3f}", "-i", str(card)]
        card_pre = ""

    run([
        "ffmpeg", "-y",
        "-framerate", str(FPS), "-loop", "1", "-t", f"{duration:.3f}", "-i", str(cover),
        *card_in,
        "-filter_complex",
        clip_filter(duration, drift, transition, first, last, card_pre),
        "-map", "[v]", "-r", str(FPS), "-t", f"{duration:.3f}",
        "-c:v", "libx264", "-crf", str(crf), "-preset", preset,
        "-pix_fmt", "yuv420p", str(dest),
    ])
    stamp.write_text(key)
    print(f"  built   {slug}  {duration:.2f}s")
    return dest


def assemble(clips: list[Path], tl: dict, dest: Path, transition_type: str,
             crf: int, preset: str, gauge: bool = True) -> None:
    t = tl["transition"]
    total = tl["total"]
    music = tl.get("music")

    cmd = ["ffmpeg", "-y"]
    for c in clips:
        cmd += ["-i", str(c)]
    if music:
        cmd += ["-ss", str(music["start"]), "-t", f"{total:.3f}", "-i", music["path"]]

    xf = "[vx]"          # xfade chain output; the gauge is layered on after it
    parts, last = [], "[0:v]"
    for i, off in enumerate(tl["offsets"], start=1):
        label = xf if i == len(tl["offsets"]) else f"[x{i}]"
        parts.append(
            f"{last}[{i}:v]xfade=transition={transition_type}"
            f":duration={t}:offset={off:.3f}{label}"
        )
        last = label
    if not parts:
        parts.append(f"[0:v]null{xf}")

    parts.append(f"{xf}{gauge_chain(tl) if gauge else 'null'}[v]")

    maps = ["-map", "[v]"]
    if music:
        fade_out = max(0.1, total - 2.5)
        parts.append(
            f"[{len(clips)}:a]afade=t=in:st=0:d=1.0,"
            f"afade=t=out:st={fade_out:.3f}:d=2.5,"
            f"aresample=48000[a]"
        )
        maps += ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"]

    cmd += [
        "-filter_complex", ";".join(parts), *maps,
        "-c:v", "libx264", "-crf", str(crf), "-preset", preset,
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-movflags", "+faststart", str(dest),
    ]
    run(cmd)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeline", default="timeline.json")
    ap.add_argument("--out", default=str(OUT / "reel.mp4"))
    ap.add_argument("--drift", type=float, default=0.035,
                    help="background zoom over the whole clip; 0 disables")
    ap.add_argument("--transition-type", default="fade",
                    help="any ffmpeg xfade name: fade, dissolve, fadeblack, smoothup")
    ap.add_argument("--crf", type=int, default=19)
    ap.add_argument("--preset", default="medium")
    ap.add_argument("--only", help="render just this clip and stop")
    ap.add_argument("--no-gauge", action="store_true",
                    help="drop the remaining-time hairline")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    tl = json.loads(Path(args.timeline).read_text())

    if args.only:
        i = next(i for i, c in enumerate(tl["clips"]) if c["slug"] == args.only)
        entry = tl["clips"][i]
        print(render_clip(entry["slug"], entry["duration"], args.drift,
                          args.crf, args.preset, True, tl["transition"],
                          i == 0, i == len(tl["clips"]) - 1,
                          entry.get("cover_slug")))
        return

    print("clips:")
    n = len(tl["clips"])
    clips = [
        render_clip(c["slug"], c["duration"], args.drift, args.crf,
                    args.preset, args.force, tl["transition"], i == 0, i == n - 1,
                    c.get("cover_slug"))
        for i, c in enumerate(tl["clips"])
    ]

    dest = Path(args.out)
    dest.parent.mkdir(parents=True, exist_ok=True)
    print("assembling...")
    assemble(clips, tl, dest, args.transition_type, args.crf, args.preset,
             gauge=not args.no_gauge)
    print(f"{dest}  {tl['total']:.2f}s  {dest.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
