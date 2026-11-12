# insta_posts

Instagram carousel generator for the music-education account (sillajuku).

## Setup (new machine)

This folder lives in the `music_rating` repo. Git holds code and data only (scripts, `albums.csv`,
`graded.json` / `reel.json`, captions). Media is gitignored: renders, photos, covers and audio. Re-create it by
running the scripts.

```
git pull                                   # from music_rating/
cd insta_posts
npm install && npx playwright install chromium
pip install numpy                          # reels/teammate/retime.py
# ffmpeg must be on PATH (reels/add-audio.mjs, retime.py)
# ../apps/web/.env.local needs LASTFM_API_KEY (ask Jun; never commit it)
```

Then run every command from `insta_posts/`, e.g. `node --env-file=../apps/web/.env.local reels/grade-batch.mjs kma-hiphop`
(re-fetches the covers), then `node reels/render-reel.mjs kma-hiphop countdown`.

```
posts/<NNN-slug>/        ← upload folder: only what goes to Instagram
  01.png … NN.png        1080×1350 slides
  caption.txt            [본문] main caption + hashtags + photo credits
                         [장별 본문] one long text per slide (per-photo caption)
work/<NNN-slug>/         ← source for that post
  post.json              caption, hashtags, slides (title / text / photo / credit …)
  sources.md             claim → source URLs (✅ verified / ⚠️ legend or unconfirmed)
  assets/                photos (Commons, license-checked)
brand/                   wordmark.svg, flower.png, icon-flower.svg (web/public); icon-rocket-filled.svg (iOS assets);
                         appstore-badge-kr.svg / -en.svg (official, developer.apple.com)
themes/b-label.mjs       the slide template
config.mjs               theme, last-slide background ('white' | 'black')
topics.md                topic backlog with status; /insta-post picks from here
shelved/work|posts/       posts taken out of the queue (not deleted; `[-]` in topics.md). Move both folders back to revive one
tools/commons.mjs        Wikimedia Commons search + download with license check
tools/art.mjs            album cover art (Cover Art Archive) for the `art` field
render.mjs               work/<slug> → posts/<slug>
```

## Posts not rendered here

`posts/app-tour/` (carousel), `posts/app-tour-reel/` (video) and `posts/app-promo-reel/` (Reels-first promo) are product posts rendered by the App Store screenshot generator
(`music_rating/apps/ios/AppStoreScreenshots`, config `ig/slides.config.js`), which already owns the phone
frame, the mock app screens and the shared design system. They have no `post.json` and `render.mjs` does not
build them — see `work/<slug>/SOURCE.md` for the re-render commands. Editorial topic posts all still come
from `work/<slug>/post.json` as below.

## Render

```
npm install
node render.mjs 001-lp-ep-single
```

## Slides (`work/<slug>/post.json`)

Every editorial post now uses `"captionInImage": true` (title + body on the image, wordmark centered at the bottom).
Without it, slides show only the title and each `text` goes to `caption.txt` as a per-photo caption.

| type | fields | graphic |
|---|---|---|
| `cover` | title, photo, credit, text | full-bleed photo |
| `photo` | title, photo, credit, text | photo on top |
| `text` | title, big, text | vinyl disc with `big` on the label (number or ≤3 chars; `\n` = two lines) |
| `grid` | items `[{art, label, name, credit, focus?}]` (2–4), optional `title` | closing slide of album covers: listen-next or pick-one. 2 side by side, 3 as rows, 4 as 2×2 |
| `table` | rows `[[label, value], …]`, (style: `timeline` \| `facts`) | full-page summary diagram, no photo/title/text: label column + value, hairline rules, like record back-cover credits. Both styles render the same (no dots, no accent colour — the dot timeline read as AI-made) |
| `path` | items `[{art, label, name, credit}, …]`, (title, text) | album covers in a column joined by arrows (listening order / lineage); without title and text the diagram fills the slide |
| `closing` | title, text | brand end card with the flower logo (title is forced to one line) |
| `promo-logo` | web | white launch card: flower + wordmark + official App Store badge + `web` (Plus Jakarta Sans) |
| `promo-badge` | title | white card: big title + the app's rocket icon in launch orange |

Any photo slide can take `"focus": "50% 70%"` (CSS object-position) to move the crop.
`cover`, `photo` and `table` slides can take `"art": "assets/art-x.jpg"` instead of `photo`: a square album cover shown
uncropped and in full colour over a blurred copy of itself. Fetch it with `node tools/art.mjs` (Cover Art Archive);
credit it as `"Album cover: …"`, which `caption.txt` lists on its own line.

Top-level: `series`, `number`, `caption`, `hashtags`. `\n` in `title` forces a line break.

`"captionInImage": true` (top-level) prints each slide's `text` on the image under the title, with smaller
photos/discs to make room; `caption.txt` then contains only the main caption. Example: `work/001-2-lp-ep-single`.
Photo credits are not on the slides; `render.mjs` collects them into `caption.txt` (CC BY / BY-SA require attribution).

## Roadmap

- [x] Renderer + template drafts → theme B (label) chosen
- [x] `/insta-post [n|topic]` skill (~/.claude/skills/insta-post)
- [x] Title-only slides, wordmark, brand end card, per-slide captions, posts/ vs work/ split
- [x] Text-in-image format for all posts, ~입니다 voice, ≤ 4 body lines (renderer warns), one-line titles
- [x] Summary slide redesigned (photo band + fact box), real photos everywhere
- [x] 001–041 editorial posts + `launch-promo` (⚠️ check the badge promise against the app before posting — see `music_rating` README)
- [ ] Publish via Instagram Graph API (needs Business/Creator account + Meta app)
- [ ] Scheduled weekly drafts with review/approve

## Reels

`reels/work/<slug>/reel.json` (+ `assets/`) → `node reels/render-reel.mjs <slug>` → `reels/out/<slug>/reel.mp4`
(1080×1920, 30fps, H.264, **no audio**: add music in the Instagram app from its licensed library), `cover.png`
(last frame, for the Reels cover) and `caption.txt` (caption, hashtags, album-cover credits).
Content stays clear of Instagram's overlays (top ~220px, bottom ~380px, right ~140px).

| type | fields | what it does |
|---|---|---|
| `tier` | `title`, `sub`, `end`, `tiers` (top first), `items [{tier, art, name, artist, year, credit}]` in reveal order | covers pop up big one by one (lowest tier first, S last) and fly into their row; ends on the comment question |
| `countdown` / `barrace` | `data: "graded.json"`, `top`, `title`, `sub`, `source`, `end` | ranking reels from `reels/grade.mjs`. Render one with `node reels/render-reel.mjs <slug> countdown` (10→1, score counts up, recap grid) or `… barrace` (bars build in three stages: ratings, + listeners, + awards; rows reorder). Output `reel-<type>.mp4`. Shows a DRAFT tag until every album has its hand-entered ratings |

### Grading (neutral rankings)

The account doesn't rank music by its own taste. Ranking reels use one published formula:
**score = 60% ratings (RYM×20, AOTY critic, AOTY user) + 15% popularity "인기" (Last.fm listeners, log scale 10→0 / 100k→100,
summed over Last.fm's duplicate spellings of the album) + 25% recognition (25 × award wins, max 100)**.

1. Make `reels/work/<slug>/albums.csv` with a pool picked by an outside rule (e.g. every winner of an award).
2. **Hand-enter** `rym`, `aoty_critic`, `aoty_user` by reading the sites: RYM and AOTY forbid automated access.
3. `node --env-file=../apps/web/.env.local reels/grade.mjs <slug>` → `graded.json` + printed table
   (API results cached in `auto.json`; `--refresh` to refetch). Check the Last.fm matches in the table.
4. Render the reels.

### Batch (2026-11-06)

`reels/data/build_master.py` builds the shared sheet `reels/data/albums.csv` (pools: KMA winner lists, 한국힙합어워즈,
artist discographies). Fill `rym`, `aoty_user`, `award_wins` by hand, then
`node --env-file=../apps/web/.env.local reels/grade-batch.mjs` writes every `reels/work/<tag>/`
(graded.json + reel.json + covers); render each with `render-reel.mjs <tag> countdown|barrace`.
Batch rules: only albums with a public rating are ranked; AOTY user scores from <10 ratings are ignored;
packaging awards don't count.
