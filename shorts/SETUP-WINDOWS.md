# Local setup (this machine)

The README's `pip install -r requirements.txt` assumes a global Python. This
install uses a venv inside `shorts/` instead, so nothing leaks into the system
interpreter and the JS monorepo around it is unaffected.

## What's installed

| | |
|---|---|
| Python | 3.14.0 (`C:\Users\redx1\AppData\Local\Programs\Python\Python314`) |
| venv | `shorts\.venv` (gitignored) |
| pillow | 12.3.0 |
| librosa | 1.0.0 (+ numpy 2.5.2, numba 0.67.0, scipy 1.18.1, soundfile 0.14.0) |
| ffmpeg / ffprobe | 2025-10-16 gyan.dev full build, on PATH |

librosa is optional — it's only used when you leave `--bpm` off and want tempo
detected from the track. It installed fine on 3.14, so both paths work.

## Running it

Always use the venv interpreter, not bare `python`:

```powershell
cd C:\Users\redx1\Documents\music_rating\music_rating\shorts
.\.venv\Scripts\python.exe pipeline.py --music assets\music.mp3 --bpm 92 --out out\reel.mp4
```

Or activate once per shell:

```powershell
.\.venv\Scripts\Activate.ps1
python pipeline.py --no-music --bpm 100 --out out\reel.mp4
```

Set `$env:PYTHONIOENCODING="utf-8"` before running if a review contains Korean
or any non-cp1252 character — otherwise the *console print* dies with a
`UnicodeEncodeError` (the PNG itself is fine).

Test renders go to the scratchpad or `%TEMP%`, never `out\` — see CLAUDE.md.

## Verified on this machine

A full end-to-end run against the sample `reviews.json` (placeholder covers,
`--no-music --bpm 100`) produced a 39.6s 1080x1920 30fps H.264 reel. Checked
visually: card layout correct on the longest review with no truncation, and the
frame at the exact cut time shows only the blurred backgrounds dissolving —
no card ghosting. Those artifacts were then deleted, so the caches are empty
and a real run starts clean.

## Changes made for bilingual (KO + EN) content

Sillajuku is bilingual (`apps/web/lib/i18n/ko.ts`), and the pipeline as shipped
could not render Korean at all. Four changes, all verified against a mixed
KO/EN fixture:

1. **Per-script fonts** (`common.py`, `compose.py`). `_FONT_CANDIDATES` is now
   keyed by script — `latin` (Inter → Liberation Sans → Arial, unchanged) and
   `ko` (Pretendard → Noto Sans KR → Malgun Gothic). `compose.py` splits every
   string into runs by script and draws each run in its own face on one shared
   baseline, so "Radiohead의 OK Computer" keeps Arial for the latin words and
   Malgun for the Hangul, on the same line, without a vertical step. Spaces and
   ASCII punctuation are neutral and join the preceding run.

   Baselines are explicit because the two faces disagree: at 40px Malgun's
   ascent is 44 against Arial's 37, so drawing both from the same top edge
   would kick the Korean up off the line. Cap heights happen to match exactly
   (29px each), so the mixed runs sit together without any size fudging.

   Drop `Pretendard-Regular.ttf` / `-Bold.ttf` into `assets/fonts/` if you want
   the app's own face on the cards instead of Malgun.

2. **Slugs keep non-latin scripts** (`common.py`). `slugify` used to NFKD then
   drop everything non-ascii, so a Korean artist and album slugged to
   `untitled` — and every Korean review in a batch would have collided on one
   cover, one card and one clip. It now folds combining accents only
   (`café` → `cafe`) and recomposes with NFC. Pure-ascii input round-trips
   unchanged, so existing latin slugs and their caches are unaffected.

3. **ffmpeg output decoding** (`common.py`). `run()` and `probe_duration()` used
   `text=True` with no encoding, which decodes ffmpeg's stderr with the Windows
   locale codec (cp1252). ffmpeg echoes input filenames back in stderr, so any
   Hangul slug killed the reader thread with a `UnicodeDecodeError` — noisy on
   success, and worse on failure, where `proc.stderr` came back `None` and the
   error path raised `AttributeError` instead of showing what ffmpeg said.
   Both now pin `encoding="utf-8", errors="replace"`.

4. **`pipeline.py` defaults to silent.** Omitting both `--music` and
   `--no-music` used to be an error; it now renders silent and only asks for a
   `--bpm` to snap the cuts to. Pass `--music` when you have a cleared track.

Verified: a full `pipeline.py` run over a KO/EN fixture produced a 42.0s reel
with correct Hangul, aligned mixed-script baselines, no truncation on a 9-line
Korean review, and no card ghosting at the cut. The English card renders
identically to before the refactor.

## Translated cards

A review may carry an optional `text_ko` alongside `text`. When present it is
drawn under the original, a little smaller and in the muted tone, so the card
still reads as one comment with a translation beneath it rather than as two
competing reviews. Omit the field and the card is exactly as it was.

```json
{ "artist": "Oasis", "album": "Definitely Maybe", "username": "…",
  "rating": 4.5, "date": "12 Mar 2019",
  "text": "…", "text_ko": "…" }
```

Both blocks are driven off one base size, so `fit_body` still has a single
number to search; if the pair won't fit even at `SZ_BODY_MIN`, it keeps whole
lines in order and ellipsizes the line that runs out. Tune the pairing with
`SZ_TRANS_RATIO` and `TRANS_GAP` at the top of `compose.py`.

`beats.py` needed a matching change. Hold time is now
`max(english, korean)`, not the sum: a translated card shows the same review
twice, and a viewer reads one block or the other, so summing them would hold
every bilingual card for about twice as long as anyone needs. Korean is timed
by character (`KO_CPM`) rather than by word, because an eojeol carries far more
than an English word and `split()` under-counts it badly.

Verified with real Oasis covers over a placeholder-text fixture: a 39.6s reel,
the longest card at 1408px against the 1560 cap with no truncation, translation
legible at thumbnail size, and no ghosting at the cut.

## Pacing

Each card is held for `LEAD_IN + reading time`, clamped to `[MIN_HOLD, MAX_HOLD]`
(3.5s–18s), so the hold tracks the length of the review rather than being uniform.

The thing that used to break that was **beat snapping**. Cuts were quantised to
the nearest bar line, which at 100bpm meant 2.4s granularity — enough to add or
remove a second of reading time per card for no reason, since a silent render
has no music to align to in the first place. Snapping is now a strategy:

| | |
|---|---|
| `--music track.mp3` | snap to the track's beat grid |
| `--no-music` (default) | snap to a nominal 100bpm grid (`SILENT_BPM`), so cuts still land evenly |
| `--no-snap` | never snap — every cut lands exactly where reading time says |

Snapping is **tolerance-gated**, which is the part that matters. A beat only
wins if it is within `--snap-tolerance` (default 1.0s) of where reading time
wanted the cut anyway; past that the exact time is used and that one cut sits
off the grid. The grid is absolute, so later cuts snap again as normal. Measured
on the current `reviews.json`: every cut moves ≤0.55s to reach its beat, so all
three snap; at `--snap-tolerance 0.1` all three fall back to exact.

## Remaining-time gauge

A hairline at the top of the frame (`GAUGE_*` in `render.py`) depletes across
each comment and resets at the cut. `--no-gauge` removes it.

It is drawn in `assemble()` over the finished reel, not per clip — a per-clip
gauge gets cross-dissolved by the xfade, so a nearly-empty bar would ghost
through a full one at every cut.

It is also **stepped, not continuous**, and that is not a stylistic choice:
`drawbox` does not evaluate its `w`/`h` expressions per frame. Give it
`w='960*(1-t/14)'` and it silently ignores the expression and falls back to full
width — no error, no warning. Its `enable` option *is* timeline-aware, so the
bar is a run of fixed-width boxes each switched on for one `GAUGE_STEP` (0.25s)
slice. Verified against the render: fill width tracks expected to within ±8px of
960 (±0.8%), which is exactly the half-step lag.

`MAX_HOLD` is a content signal, not just a clamp. A card that hits the 18s
ceiling is being under-held — the viewer gets the text at well over 200wpm and
won't finish it. The fix is to edit the review down, not to raise the ceiling
and hand a 25-second static card to a feed that rewards the opposite. In
practice **cards should stay under about 45 words**; the first Oasis draft had a
66-word card that clamped, and trimming it to 44 fixed it.

Measured on the current `reviews.json` — 37w → 15.0s, 44w → 17.5s, 19w → 9.6s,
a consistent ~165wpm across all three with nothing clamped.

## Single-album reels

`reviews.json` may carry a top-level `album` block. When it does, the reel is
about one record: the comments inherit artist/album/cover from it and carry only
what differs between them.

```json
{ "album": { "artist": "Oasis", "album": "…", "year": "1995",
             "tracklist": ["Hello", "…"], "highlight": "Champagne Supernova" },
  "reviews": [ { "username": "…", "rating": 4.0, "text": "…", "text_ko": "…" } ] }
```

Two cache keys, deliberately: `cover_slug` is the record, `slug` is the comment.
Collapsing them would make every comment in a single-album reel overwrite the
others' card and clip. Art is fetched once per album, not once per comment.

**Shape of the reel:** intro (album centred) → settles into a header strip →
tracklist appears and a track is picked → tracklist goes, comments cycle under
the header, which stays for the rest of the reel.

The header is baked into every comment card and is literally
`album_layer(t=1.0)` — the same call the intro's last frame makes — so the
handoff from intro to first comment has nothing to line up.

### Why the intro is a frame sequence

`compose.py --intro` writes `cache/intro/%05d.png` plus `intro.json`, which
`beats.py` and `render.py` read (they don't import compose — stages stay
file-in/file-out). Frames are rendered per distinct state and copied for the
repeats, so 180 frames is a few dozen composites.

It's Pillow frames rather than an ffmpeg filter because neither filter can do
it: `drawbox` ignores per-frame `w`/`h` expressions entirely, and while
`overlay` *does* track `t` (verified to ±1px), it can only move a layer, not
shrink one. The cover has to travel and scale at once.

The type **cross-fades** between its two positions rather than sliding, and that
is load-bearing: the title starts centred *below* a 560px cover and ends beside
a 96px one, so any straight interpolation drags it straight through the artwork.
The cover travels; the words swap.

If the timeline grants the intro clip more time than the animation runs,
`tpad=stop_mode=clone` holds the final frame rather than looping back to a
centred album that has already settled.

`cache/intro/` is gitignored — 180 frames is ~80MB.

## Pulling reviews from Sillajuku

`tools/export_sillajuku.py` writes `reviews.json` straight from the database.
Stdlib only, credentials from the environment (falling back to the repo's
`.env.local`), never printed.

```bash
.venv\Scripts\python.exe tools\export_sillajuku.py --artist Oasis --dry-run
.venv\Scripts\python.exe tools\export_sillajuku.py --artist Oasis --limit 3
```

**The review text is not in the `reviews` table.** That table exists but is
empty, and `apps/web/app/api/reviews/route.ts` queries it filtering on
`release_id`, a column it doesn't have — PostgREST 400s, supabase-js turns that
into `data: null`, and the endpoint returns `{ reviews: [] }` for every album,
silently. The real text is `ratings.review_text`, keyed by `release_group_id`,
with the star value in `ratings.score` on a 0–5 scale that maps straight onto
the card's five stars. The exporter reads that; the app's endpoint is a separate
bug and is not touched here.

Two filters are on by default, both about not publishing something that isn't
what it looks like: `profiles.is_bot` accounts are excluded, and
`profile_visibility` must be Public. `--include-bots` overrides the first, for
previewing layout only.

### What's actually in there today

Verified against the live database:

| | |
|---|---|
| Ratings carrying `review_text` | 300+ |
| Median length | **5 words** (max seen: 14) |
| Oasis reviews | **5, all from bot accounts**, 4–13 words |

So no Oasis reel can be built from real data right now. The card is designed for
30–90 words; a 5-word review leaves it looking empty, and a seeded bot rating
presented with a username and stars would read as somebody's review when it
isn't. The exporter refuses both cases by default rather than producing a card
that misrepresents itself.

## Still open

1. **Attribution is hardcoded to `rateyourmusic.com`.** It's a default argument
   in `compose.compose()` with no CLI flag, and `compose.main()` never passes it.
   Left alone pending your decision on the wording.

2. **Cover lookup misses long album titles.** `fetch_art.py --dry-run` resolved
   2 of the 3 sample albums via iTunes; "Lift Your Skinny Fists Like Antennas to
   Heaven" failed. Sillajuku already stores cover URLs for its own catalog, so
   emitting `cover_url` straight from the database is more reliable than the
   iTunes/Deezer lookup — and it will matter more for Korean releases, which
   iTunes indexes under romanised names the search won't match.

3. **The bundled slash commands aren't discoverable from the repo root.**
   `shorts\.claude\commands\{newvideo,design-pass}.md` are only picked up when
   Claude Code runs with `shorts\` as the working directory. Run it from there,
   or move them to a repo-root `.claude\commands\`.

4. **`reviews.json` is still the shipped sample** (Slint / Duster / Godspeed).
   Replace it with real Sillajuku reviews before the first real run. Real Oasis
   covers for `Definitely Maybe`, `(What's the Story) Morning Glory?` and
   `Be Here Now` are already in `cache/covers/`, fetched from iTunes, so a real
   Oasis reel only needs the review text.

   No RYM scraper. RYM has no public API, blocks scrapers, and prohibits it in
   their ToS -- this project's own CLAUDE.md already says so and warns it gets
   the IP banned. The reviews are also third-party copyrighted writing, and
   translating them for a public post makes a derivative work rather than a
   quote. Review text comes from Sillajuku's own database or is written by hand.

5. **Container tags `yuvj420p`, not `yuv420p`** as CLAUDE.md's output contract
   states. It comes from the JPEG covers being full-range and that propagating
   through the clips. Harmless on every mainstream player, but it is a contract
   deviation, and it predates any of the changes above.
