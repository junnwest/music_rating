#!/usr/bin/env python3
"""Run the whole thing: art -> cards -> timeline -> video.

    python pipeline.py --music assets/music.mp3 --bpm 92 --out out/week12.mp4

Every stage is still runnable on its own; this just chains them with one theme
so cards can't end up half light and half dark from separate runs.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def stage(name: str, argv: list[str]) -> None:
    print(f"\n=== {name} ===")
    if subprocess.run([sys.executable, *argv], cwd=ROOT).returncode != 0:
        raise SystemExit(f"{name} failed")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reviews", default="reviews.json")
    ap.add_argument("--music")
    ap.add_argument("--no-music", action="store_true")
    ap.add_argument("--bpm", type=float)
    ap.add_argument("--music-start", type=float, default=0.0)
    ap.add_argument("--snap-every", type=int, default=4)
    ap.add_argument("--no-snap", action="store_true")
    ap.add_argument("--no-gauge", action="store_true")
    ap.add_argument("--transition", type=float, default=0.8)
    ap.add_argument("--theme", default="light")
    ap.add_argument("--drift", type=float, default=0.035)
    ap.add_argument("--preset", default="medium")
    ap.add_argument("--out", default="out/reel.mp4")
    ap.add_argument("--skip-art", action="store_true")
    args = ap.parse_args()

    if not args.skip_art:
        stage("art", ["fetch_art.py", "--reviews", args.reviews])

    stage("cards", ["compose.py", "--all", "--intro", "--theme", args.theme,
                    "--reviews", args.reviews])

    beats = ["beats.py", "--reviews", args.reviews,
             "--transition", str(args.transition),
             "--snap-every", str(args.snap_every),
             "--music-start", str(args.music_start)]
    if args.no_snap:
        beats.append("--no-snap")
    if args.music and not args.no_music:
        beats += ["--music", args.music]
    else:
        # Silent is the default: music gets added at upload time from the
        # platform's own library, which is both cleared and what the feed
        # favours. beats.py still snaps the silent cuts to a nominal grid so
        # they land evenly -- pass --bpm to set it, or --no-snap to hold each
        # card exactly as long as its review takes to read.
        beats.append("--no-music")
    if args.bpm:
        beats += ["--bpm", str(args.bpm)]
    stage("timeline", beats)

    render = ["render.py", "--drift", str(args.drift),
              "--preset", args.preset, "--out", args.out]
    if args.no_gauge:
        render.append("--no-gauge")
    stage("render", render)

    print(f"\ndone -> {args.out}")


if __name__ == "__main__":
    main()
