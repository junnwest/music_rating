#!/usr/bin/env python3
"""Build timeline.json: how long each card is held, and where the crossfades land.

Cuts are snapped to the music's beat grid (every Nth beat, so they land on bar
lines rather than anywhere), and each crossfade is *centred* on its beat so the
midpoint of the dissolve coincides with the hit rather than starting on it.

    python beats.py --music assets/music.mp3                 # librosa tempo detect
    python beats.py --music assets/music.mp3 --bpm 92        # known tempo
    python beats.py --no-music --bpm 100                     # silent timing test
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from common import INTRO, ROOT, load_album, load_reviews, probe_duration

WPM = 165.0          # assumed silent reading speed, latin
KO_CPM = 400.0       # ditto for Korean, in characters -- see read_seconds()
LEAD_IN = 1.5        # seconds of "settle" before the eye starts reading
MIN_HOLD = 3.5       # even a one-liner needs long enough to register
MAX_HOLD = 18.0      # a card that hits this ceiling should be edited, not held

SILENT_BPM = 100.0   # nominal grid for silent renders, so cuts still land evenly
SNAP_TOLERANCE = 1.0 # how far a cut may be dragged to reach a beat -- see grid_snap


def read_seconds(text: str) -> float:
    """Rough silent reading time, counting Hangul by character and the rest by word.

    Korean doesn't come out right on a word count: an eojeol carries a lot more
    than an English word, so `split()` badly under-counts it. Characters are the
    more stable unit. KO_CPM is deliberately conservative -- silent reading of
    Korean prose is usually put higher than 400 cpm, and a card held slightly too
    long is a much cheaper mistake than one that cuts mid-sentence.
    """
    ko = sum(1 for ch in text if 0xAC00 <= ord(ch) <= 0xD7A3)
    latin_words = len([w for w in text.split() if not any(
        0xAC00 <= ord(ch) <= 0xD7A3 for ch in w)])
    return latin_words / WPM * 60.0 + ko / KO_CPM * 60.0


def target_hold(review: dict) -> float:
    """Hold long enough for whichever language the viewer is actually reading.

    A translated card shows the same review twice, so a viewer reads one block
    or the other -- never both. Summing the two would hold every bilingual card
    for roughly double the time anyone needs.
    """
    longest = max(read_seconds(review["text"]),
                  read_seconds(review.get("text_ko") or ""))
    return min(MAX_HOLD, max(MIN_HOLD, LEAD_IN + longest))


def beat_grid(music: Path | None, bpm: float | None, duration: float,
              offset: float) -> tuple[list[float], float]:
    """Return (beat times relative to the trim point, bpm)."""
    if bpm is None:
        try:
            import librosa
        except ImportError:
            raise SystemExit(
                "librosa not installed and no --bpm given.\n"
                "  pip install librosa    (or pass --bpm 120)"
            )
        y, sr = librosa.load(str(music), sr=22050, offset=offset)
        tempo, frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
        times = librosa.frames_to_time(frames, sr=sr).tolist()
        bpm = float(tempo if not hasattr(tempo, "__len__") else tempo[0])
        if len(times) > 4:
            return times, bpm

    period = 60.0 / bpm
    n = int(duration / period) + 1
    return [i * period for i in range(n)], bpm


def grid_snap(grid: list[float], tolerance: float):
    """Snap each cut to the nearest beat at or after `floor` -- when it's cheap.

    Snapping unconditionally is what used to wreck the pacing: at 100bpm the bar
    lines are 2.4s apart, so a cut could be dragged more than a second away from
    the point where the viewer has actually finished reading. Reading time is the
    thing the viewer notices; landing on a beat is the thing they don't.

    So the beat only wins if it's within `tolerance` of where reading time wanted
    the cut anyway. Past that the exact time is used and this one cut sits off the
    grid -- the grid is absolute, so the cuts after it snap again as normal.
    """
    def snap(want: float, floor: float) -> float:
        options = [g for g in grid if g >= floor]
        if not options:
            raise SystemExit(
                "music is too short: ran out of snap points before the last card. "
                "Use a longer track, lower --snap-every, or shorten the reviews."
            )
        best = min(options, key=lambda g: abs(g - want))
        return best if abs(best - want) <= tolerance else max(want, floor)
    return snap


def exact_snap(want: float, floor: float) -> float:
    """No snapping: the cut lands exactly where reading time says it should.

    Silent renders have nothing to align to, so quantising to a nominal tempo
    only pads or clips the reading time for no benefit. This is what makes the
    hold track the length of the review instead of the nearest bar line.
    """
    return max(want, floor)


def build(holds, snap, transition, tail):
    """Pick a cut for each segment boundary, then derive clip lengths.

    `holds` is how long each segment wants to be on screen -- reading time for a
    comment, a fixed length for the intro. `snap(want, floor)` decides where the
    cut may actually land; `floor` keeps cuts strictly increasing.
    """
    half = transition / 2.0
    cuts: list[float] = []
    cursor = 0.0
    floor = MIN_HOLD
    for h in holds[:-1]:
        cursor += h
        cut = snap(cursor, floor)
        cuts.append(cut)
        cursor = cut
        floor = cut + MIN_HOLD

    total = snap(cursor + holds[-1], floor) + tail

    offsets = [c - half for c in cuts]
    if offsets and offsets[0] <= transition:
        raise SystemExit("first cut lands too early for the crossfade; raise MIN_HOLD.")

    durations: list[float] = []
    if len(holds) == 1:
        durations = [total]
    else:
        durations.append(offsets[0] + transition)
        for k in range(1, len(offsets)):
            durations.append(offsets[k] - offsets[k - 1] + transition)
        durations.append(total - offsets[-1])

    bad = [round(d, 2) for d in durations if d <= transition + 0.3]
    if bad:
        raise SystemExit(f"clip durations too short for the transition: {bad}")

    return cuts, offsets, durations, total


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--music", help="path to the backing track")
    ap.add_argument("--no-music", action="store_true")
    ap.add_argument("--bpm", type=float, help="skip detection and use this tempo")
    ap.add_argument("--music-start", type=float, default=0.0,
                    help="trim this many seconds off the front of the track")
    ap.add_argument("--transition", type=float, default=0.8)
    ap.add_argument("--snap-every", type=int, default=4,
                    help="cut every Nth beat (4 = once per bar in 4/4)")
    ap.add_argument("--tail", type=float, default=1.2,
                    help="extra hold on the final card")
    ap.add_argument("--no-snap", action="store_true",
                    help="never snap; hold each card exactly as long as it reads")
    ap.add_argument("--snap-tolerance", type=float, default=SNAP_TOLERANCE,
                    help="how far (s) a cut may move to reach a beat before the "
                         "exact reading time wins instead")
    ap.add_argument("--reviews", default="reviews.json")
    ap.add_argument("--out", default="timeline.json")
    args = ap.parse_args()

    reviews = load_reviews(args.reviews)
    if not reviews:
        raise SystemExit("reviews.json is empty")

    if args.no_music:
        music, music_len = None, None
        # Silent renders still snap by default, on a nominal grid, so the cuts
        # land evenly rather than at whatever second the word count happens to
        # produce -- and so a track dropped on at upload time lines up. The
        # tolerance in grid_snap is what keeps that from costing reading time.
        bpm = None if args.no_snap else (args.bpm or SILENT_BPM)
        snap = (exact_snap if bpm is None else
                grid_snap(beat_grid(None, bpm, 3600.0, 0.0)[0][::args.snap_every],
                          args.snap_tolerance))
    else:
        if not args.music:
            raise SystemExit("pass --music PATH or --no-music")
        music = Path(args.music)
        if not music.exists():
            raise SystemExit(f"no such file: {music}")
        music_len = probe_duration(music) - args.music_start
        beats, bpm = beat_grid(music, args.bpm, music_len, args.music_start)
        snap = (exact_snap if args.no_snap
                else grid_snap(beats[::args.snap_every], args.snap_tolerance))
        if args.no_snap:
            bpm = None

    album = load_album(args.reviews)
    manifest = INTRO / "intro.json"
    intro = json.loads(manifest.read_text()) if (album and manifest.exists()) else None

    segments = list(reviews)
    holds = [target_hold(r) for r in reviews]
    if intro:
        segments.insert(0, {"slug": intro["slug"],
                            "cover_slug": reviews[0]["cover_slug"],
                            "text": ""})
        holds.insert(0, intro["duration"])

    cuts, offsets, durations, total = build(
        holds, snap, args.transition, args.tail
    )

    if music_len is not None and total > music_len:
        raise SystemExit(f"timeline ({total:.1f}s) is longer than the music "
                         f"({music_len:.1f}s) — trim fewer seconds or add cards.")

    timeline = {
        "total": round(total, 3),
        "transition": args.transition,
        "bpm": round(bpm, 2) if bpm else None,
        "snap_every": args.snap_every,
        "music": None if music is None else {
            "path": str(music), "start": args.music_start
        },
        "clips": [
            {"slug": r["slug"], "cover_slug": r["cover_slug"],
             "duration": round(d, 3)}
            for r, d in zip(segments, durations)
        ],
        "offsets": [round(o, 3) for o in offsets],
        "cuts": [round(c, 3) for c in cuts],
    }
    Path(args.out).write_text(json.dumps(timeline, indent=2))

    if bpm:
        print(f"{bpm:.1f} bpm, cut every {args.snap_every} beats "
              f"({args.snap_every * 60 / bpm:.2f}s per bar)")
    else:
        print("unsnapped: each card held exactly as long as it takes to read")

    marks = [f"cut@{c:>6.2f}" for c in cuts] + [f"end@{total:>6.2f}"]
    prev = 0.0
    for i, (r, clip, mark) in enumerate(zip(segments, timeline["clips"], marks)):
        cut = cuts[i] if i < len(cuts) else total
        onscreen = cut - prev
        prev = cut
        words = len(r["text"].split())
        print(f"  {clip['slug'][:34]:<34} {words:>3}w  "
              f"{onscreen:>5.1f}s on screen  {mark}")
    print(f"total {total:.2f}s -> {args.out}")


if __name__ == "__main__":
    main()
