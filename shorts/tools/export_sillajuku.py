#!/usr/bin/env python3
"""Export public Sillajuku reviews into the reviews.json the pipeline eats.

    python tools/export_sillajuku.py --artist Oasis --limit 3
    python tools/export_sillajuku.py --artist Oasis --dry-run
    python tools/export_sillajuku.py --release-id <uuid> --out reviews.json

Reads the Supabase REST API directly over stdlib urllib -- no new dependency,
and it stays a standalone stage that writes a file, like every other stage here.

Credentials come from the environment, never from source. It looks for
NEXT_PUBLIC_SUPABASE_URL plus one of SUPABASE_SERVICE_ROLE_KEY or
NEXT_PUBLIC_SUPABASE_ANON_KEY, falling back to parsing the repo's .env.local
so you don't have to export them by hand. Values are never printed.

Where the review text actually lives
-----------------------------------
Not in `reviews`. That table exists but is empty, and
`apps/web/app/api/reviews/route.ts` queries it on a `release_id` column that
doesn't exist -- so that endpoint returns [] for everything. The real text is
`ratings.review_text`, keyed by `release_group_id`, with the star value in
`ratings.score` on a 0-5 scale. This script reads that.

Two filters that are on by default, both about not publishing something that
isn't what it looks like:

  * `profiles.is_bot` accounts are excluded. The catalog is seeded with bot
    ratings; putting one on a card with a username and a star rating would be
    presenting generated text as somebody's review. `--include-bots` overrides,
    for previewing layout only.
  * `profiles.profile_visibility` must be Public.

Even then, the export puts a real user's words and username on a public post.
Worth a thought before publishing someone else's review.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from common import ROOT, slugify  # noqa: E402

TIMEOUT = 30
# apps/web is the app; .env.local sits at the monorepo root, two up from shorts/.
ENV_FILE = ROOT.parent / ".env.local"

# The card draws 5 stars. Sillajuku stores `ratings.score` on the same 0-5 scale
# (halves included), so it maps straight across -- but assert it rather than
# trust it, because a 0-10 or 0-100 column would silently draw 5 full stars.
RATING_MAX = 5.0


# --------------------------------------------------------------------------
# credentials
# --------------------------------------------------------------------------
def load_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def credentials(env_file: Path) -> tuple[str, str]:
    fallback = load_env_file(env_file)

    def get(name: str) -> str | None:
        return os.environ.get(name) or fallback.get(name)

    url = get("NEXT_PUBLIC_SUPABASE_URL")
    key = get("SUPABASE_SERVICE_ROLE_KEY") or get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise SystemExit(
            "missing Supabase credentials.\n"
            "  set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY\n"
            f"  (or NEXT_PUBLIC_SUPABASE_ANON_KEY), or put them in {env_file}"
        )
    return url.rstrip("/"), key


# --------------------------------------------------------------------------
# PostgREST
# --------------------------------------------------------------------------
def query(base: str, key: str, table: str, **params) -> list[dict]:
    qs = urllib.parse.urlencode(params, safe="().,*")
    req = urllib.request.Request(
        f"{base}/rest/v1/{table}?{qs}",
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:400]
        raise SystemExit(f"{table} query failed ({exc.code}): {body}")


def in_list(values) -> str:
    """PostgREST in.(...) -- quote each value so commas in ids can't split it."""
    return "(" + ",".join('"' + str(v).replace('"', '""') + '"' for v in values) + ")"


# --------------------------------------------------------------------------
def pick_release(group: list[dict]) -> dict:
    """One representative release per group -- prefer canonical, then one with art."""
    for r in group:
        if r.get("is_canonical") and r.get("cover_url"):
            return r
    for r in group:
        if r.get("cover_url"):
            return r
    return group[0]


def collect(base: str, key: str, artist: str | None, release_ids: list[str],
            limit: int, min_words: int, include_bots: bool) -> list[dict]:
    cols = "id,release_group_id,title,artist,cover_url,is_canonical"
    if artist:
        releases = query(base, key, "releases", select=cols,
                         artist=f"ilike.*{artist}*", limit="1000")
    else:
        releases = query(base, key, "releases", select=cols,
                         id=f"in.{in_list(release_ids)}")
    releases = [r for r in releases if r.get("release_group_id")]
    if not releases:
        raise SystemExit(f"no releases matched {artist or release_ids}")

    groups: dict[str, list[dict]] = {}
    for r in releases:
        groups.setdefault(r["release_group_id"], []).append(r)
    by_group = {gid: pick_release(g) for gid, g in groups.items()}
    print(f"releases:  {len(releases)} in {len(by_group)} release groups")

    rated = query(base, key, "ratings",
                  select="user_id,release_group_id,score,review_text,created_at",
                  release_group_id=f"in.{in_list(by_group)}",
                  review_text="not.is.null",
                  order="created_at.desc", limit="1000")
    print(f"ratings:   {len(rated)} carry review_text")

    long_enough = [r for r in rated
                   if len((r["review_text"] or "").split()) >= min_words]
    print(f"           {len(long_enough)} of those are >= {min_words} words")
    if not long_enough:
        lengths = sorted(len((r["review_text"] or "").split()) for r in rated)
        longest = lengths[-1] if lengths else 0
        raise SystemExit(
            f"nothing to export: the longest review here is {longest} words, "
            f"under the {min_words}-word floor.\nSillajuku review_text runs to "
            "one-liners; the card is built for 30-90 words. Lower --min-words to "
            "see them, but a 5-word review leaves the card looking empty."
        )

    user_ids = {r["user_id"] for r in long_enough}
    profiles = query(base, key, "profiles",
                     select="id,username,is_bot,profile_visibility",
                     id=f"in.{in_list(user_ids)}")
    prof = {p["id"]: p for p in profiles}

    bots = sum(1 for r in long_enough if prof.get(r["user_id"], {}).get("is_bot"))
    if bots:
        print(f"           {bots} written by bot accounts"
              f"{' (kept: --include-bots)' if include_bots else ' -- excluded'}")

    usable = []
    for r in long_enough:
        p = prof.get(r["user_id"], {})
        if p.get("is_bot") and not include_bots:
            continue
        if (p.get("profile_visibility") or "").lower() != "public":
            continue
        usable.append(r)
    if not usable:
        raise SystemExit(
            "nothing to export: every review that was long enough came from a bot "
            "account or a non-public profile.\nThese are seeded ratings, not "
            "somebody's review -- putting one on a card with a username and stars "
            "would present generated text as genuine. Use --include-bots only to "
            "preview layout, never to publish."
        )
    print(f"           {len(usable)} publishable")

    out = []
    for r in usable[:limit]:
        rel = by_group[r["release_group_id"]]
        raw = r.get("score")
        if raw is not None and not 0 <= float(raw) <= RATING_MAX:
            raise SystemExit(
                f"ratings.score {raw} is outside 0-{RATING_MAX:g}; the card draws "
                f"5 stars, so fix RATING_MAX and rescale before exporting."
            )
        out.append({
            "artist": rel.get("artist") or "",
            "album": rel.get("title") or "",
            "username": prof.get(r["user_id"], {}).get("username") or "anonymous",
            "rating": float(raw) if raw is not None else 0.0,
            "date": (r.get("created_at") or "")[:10],
            "text": " ".join((r["review_text"] or "").split()),
            # Filled in by hand or in-session; the pipeline draws it under the
            # original when present, and omits the block entirely when absent.
            "text_ko": "",
            "cover_url": rel.get("cover_url") or None,
            "slug": slugify(rel.get("artist") or "", rel.get("title") or ""),
        })
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--artist", help="match releases by artist, case-insensitive")
    src.add_argument("--release-id", action="append", default=[],
                     help="repeatable; exact release ids instead of an artist match")
    ap.add_argument("--limit", type=int, default=3)
    ap.add_argument("--min-words", type=int, default=25,
                    help="skip one-liners that would leave the card looking empty")
    ap.add_argument("--include-bots", action="store_true",
                    help="layout previews only -- never publish a bot's rating "
                         "as somebody's review")
    ap.add_argument("--out", default=str(ROOT / "reviews.json"))
    ap.add_argument("--env-file", default=str(ENV_FILE))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    base, key = credentials(Path(args.env_file))
    rows = collect(base, key, args.artist, args.release_id,
                   args.limit, args.min_words, args.include_bots)

    print()
    for r in rows:
        words = len(r["text"].split())
        print(f"  {r['username']:<18} {r['rating']:>4.1f}  {r['album'][:34]:<34} "
              f"{words:>3}w  {'cover' if r['cover_url'] else 'NO COVER'}")

    if args.dry_run:
        print(f"\ndry run -- would write {len(rows)} reviews to {args.out}")
        return

    Path(args.out).write_text(
        json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"\n{len(rows)} reviews -> {args.out}")
    print("text_ko is empty on every row; fill it before rendering a bilingual reel.")


if __name__ == "__main__":
    main()
