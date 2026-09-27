# rym-shorts

Turns music reviews into 1080x1920 vertical videos: a clean, screenshot-style
card over a blurred album cover, held for a beat-aligned duration, crossfading
into the next.

## Output contract

1080x1920, 30fps, H.264 `yuv420p`, AAC 192k, `+faststart`. Do not change these.

## Stage boundaries — do not merge them

    reviews.json -> fetch_art.py -> compose.py -> beats.py -> render.py
                    cache/covers/   cache/cards/  timeline.json  out/*.mp4

Each stage is a standalone script that reads files and writes files. Keep them
that way — the whole point is that a copy edit re-renders one card, not the reel.
`pipeline.py` chains them; it must not grow logic of its own.

## Rules that will bite you if broken

- **All text is drawn in Pillow, never ffmpeg `drawtext`.** drawtext has no word
  wrap and no auto-fit. `compose.py` measures, wraps, and shrinks to fit.
- **Never `paste()` a canvas-sized layer with a mask in compose.py.** `paste`
  replaces alpha, so it erases everything already drawn in the masked region.
  Use a small local layer plus `alpha_composite`. (This bug ate the card
  background once already.)
- **Cards never overlap during a transition.** Each card's alpha fades out over
  the first half of the crossfade window and the next fades in over the second
  half; only the blurred backgrounds dissolve. A plain `xfade` on two text cards
  double-exposes the body copy into unreadable mush. Verify any transition change
  by extracting the frame at the exact cut time.
- **Crossfades are centred on the beat:** `offset = cut - transition/2`. If you
  touch the timeline maths, re-derive it — clip durations and xfade offsets are
  coupled (`o_k = sum(d_0..d_k-1) - k*T`).
- Covers and clips are cached by slug. Re-fetching in a loop is never correct.
- Test renders go to `/tmp`, never `out/`.

## Verify visually, always

Do not report a render as working without looking at it.

    python compose.py --slug SLUG --preview /tmp/preview.png   # then view it
    ffmpeg -y -v error -ss T -i out/reel.mp4 -frames:v 1 /tmp/f.png

Check at minimum: one frame mid-card, and one at the exact cut time from
`timeline.json`. Longest review in `reviews.json` is the layout stress test.

## Design intent

Deliberately plain — it should read as a screenshot of a real comment, not a
designed graphic. Liberation Sans / Arial, RYM-ish link blue, hairline rules,
one soft shadow. Don't add gradients, accent colours, emoji, kinetic text, or
"01 / 02 / 03" markers. If a change makes it look more designed, it's wrong.

## Content rules

RYM has no public API and blocks scrapers; `reviews.json` is curated by hand.
Do not write a scraper for it. Always keep the username and the
`rateyourmusic.com` attribution on the card. Backing music must be something
the user has cleared — never rip audio from the album being reviewed.
