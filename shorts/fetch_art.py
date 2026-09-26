#!/usr/bin/env python3
"""Fetch album art into cache/covers/{slug}.jpg.

Sources, in order: an explicit `cover` path or `cover_url` in reviews.json, then
the iTunes Search API (free, no key), then Deezer (also free, no key).

Cached by slug -- reruns are free and no service gets hammered.

    python fetch_art.py
    python fetch_art.py --slug spiderland --force
    python fetch_art.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import time
import urllib.parse
import urllib.request
from pathlib import Path

from common import COVERS, load_reviews

UA = "rym-shorts/1.0 (personal video pipeline)"
TIMEOUT = 20


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read()


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def itunes(artist: str, album: str) -> str | None:
    q = urllib.parse.urlencode(
        {"term": f"{artist} {album}", "entity": "album", "limit": 5}
    )
    data = json.loads(_get(f"https://itunes.apple.com/search?{q}"))
    for r in data.get("results", []):
        if _norm(album) in _norm(r.get("collectionName", "")) or \
           _norm(r.get("collectionName", "")) in _norm(album):
            art = r.get("artworkUrl100")
            if art:
                # 100x100bb.jpg is the default crop; ask for the big one.
                return re.sub(r"/\d+x\d+bb", "/1400x1400bb", art)
    return None


def deezer(artist: str, album: str) -> str | None:
    q = urllib.parse.quote(f'artist:"{artist}" album:"{album}"')
    data = json.loads(_get(f"https://api.deezer.com/search/album?q={q}&limit=5"))
    for r in data.get("data", []):
        if _norm(album) in _norm(r.get("title", "")):
            return r.get("cover_xl") or r.get("cover_big")
    return None


def fetch_one(review: dict, force: bool, dry: bool) -> bool:
    dest = COVERS / f"{review['cover_slug']}.jpg"
    if dest.exists() and not force:
        print(f"  cached  {review['cover_slug']}")
        return True

    if review.get("cover"):
        src = Path(review["cover"])
        if not src.exists():
            print(f"  MISSING local cover {src}")
            return False
        if not dry:
            shutil.copy(src, dest)
        print(f"  local   {review['cover_slug']}  <- {src}")
        return True

    url = review.get("cover_url")
    source = "manual"
    if not url:
        for name, fn in (("itunes", itunes), ("deezer", deezer)):
            try:
                url = fn(review["artist"], review["album"])
            except Exception as exc:
                print(f"  {name} error for {review['cover_slug']}: {exc}")
                url = None
            if url:
                source = name
                break
            time.sleep(0.4)

    if not url:
        print(f"  NOT FOUND {review['artist']} - {review['album']}"
              f"   (add \"cover_url\" or \"cover\" to reviews.json)")
        return False

    if dry:
        print(f"  would fetch {review['cover_slug']} from {source}: {url}")
        return True

    dest.write_bytes(_get(url))
    print(f"  {source:<7} {review['cover_slug']}  {dest.stat().st_size // 1024} KB")
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--reviews", default="reviews.json")
    args = ap.parse_args()

    reviews = load_reviews(args.reviews)
    if args.slug:
        reviews = [r for r in reviews if args.slug in (r["slug"], r["cover_slug"])]

    # One album, many comments -> one cover, not one per comment.
    seen, unique = set(), []
    for r in reviews:
        if r["cover_slug"] not in seen:
            seen.add(r["cover_slug"])
            unique.append(r)

    print("covers:")
    missing = [r["cover_slug"] for r in unique
               if not fetch_one(r, args.force, args.dry_run)]
    if missing:
        raise SystemExit(f"\ncould not resolve art for: {', '.join(missing)}")


if __name__ == "__main__":
    main()
