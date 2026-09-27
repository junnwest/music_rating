# rym-shorts

Music reviews → vertical videos. A plain screenshot-style card over a blurred
album cover, held for a beat-aligned duration, crossfading into the next.

1080×1920, 30fps, H.264 + AAC. Pillow draws the cards, ffmpeg does everything else.

## Setup

```bash
pip install -r requirements.txt      # pillow required, librosa optional
ffmpeg -version                      # 6.x or newer
```

Optionally drop `Inter-Regular.ttf` / `Inter-Bold.ttf` into `assets/fonts/`.
Without them it falls back to Liberation Sans (Arial metrics), which is what
RYM itself renders in — so the fallback is arguably the more authentic choice.

## Run it

```bash
# one shot
python pipeline.py --music assets/music.mp3 --bpm 92 --out out/week12.mp4

# or stage by stage, which is how you'll actually work
python fetch_art.py
python compose.py --all --preview /tmp/p.png
python beats.py --music assets/music.mp3 --bpm 92
python render.py --preset veryfast --out /tmp/test.mp4
```

Leave `--bpm` off to have librosa detect the tempo. Use `--no-music --bpm 100`
to check timing before you've picked a track.

## reviews.json

```json
[{
  "artist": "Slint",
  "album": "Spiderland",
  "username": "quietcopy",
  "rating": 4.5,
  "date": "12 Mar 2019",
  "text": "Six songs that sound like they were recorded in an empty house…"
}]
```

`rating` takes halves. Add `"cover_url"` or `"cover"` (local path) to override
art lookup. `slug` is derived automatically and is the key for every cache.

## How the timing works

Each card's hold is estimated from its word count at ~165wpm plus a 1.5s
settle, then **snapped to the nearest bar line** (`--snap-every 4` beats). Each
crossfade is *centred* on its beat — `offset = cut - transition/2` — so the
midpoint of the dissolve lands on the hit rather than the start of it.

During that window the card fades out over the first half and the next fades in
over the second half, so the two are never on screen together. Only the blurred
backgrounds cross-dissolve. A plain `xfade` over two text cards double-exposes
the body copy into unreadable mush — this was the first thing that had to be
fixed, don't undo it.

## Tuning

| What | Where |
|---|---|
| Card geometry, type sizes, colours | constants at the top of `compose.py` |
| Reading speed, min/max hold | `WPM`, `MIN_HOLD`, `MAX_HOLD` in `beats.py` |
| Blur, darkness, background drift | `clip_filter()` in `render.py`, `--drift` |
| Transition style | `--transition-type` (any ffmpeg xfade name) |
| Light/dark card | `--theme light\|dark` |

`--theme` is baked into the card PNG, so always recompose **all** cards after
changing it or you'll get a mixed reel. `pipeline.py` does that for you.

## Iterating on the look

```bash
python tools/placeholder_covers.py                      # fake art, works offline
python compose.py --slug SLUG --preview /tmp/p.png      # then look at it
ffmpeg -y -ss 10.43 -i out/reel.mp4 -frames:v 1 /tmp/f.png   # cut times: timeline.json
```

In Claude Code, `/design-pass` and `/newvideo <music> <bpm>` wrap these loops
and force a visual check at each step.

## Caching

Covers, cards and clips are keyed by slug; clips also key on a stamp of the
card/cover mtimes and render settings. Fix a typo in one review and only that
clip re-renders. `--force` overrides.

## Constraints worth knowing

- **RYM has no public API and blocks scrapers.** `reviews.json` is curated by
  hand. It's a handful of entries a week, which is fine; a scraper will get the
  IP banned and breaks their ToS. The username and `rateyourmusic.com`
  attribution stay on the card.
- **Don't use the reviewed album as backing audio** unless you enjoy copyright
  claims. Use a cleared track, or add music at upload time from the platform's
  own library — in which case render with `--no-music` and a nominal `--bpm`.
- iTunes/Deezer occasionally return the wrong pressing. `fetch_art.py --dry-run`
  prints the URLs it would use before committing.
