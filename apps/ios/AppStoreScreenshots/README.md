# App Store screenshots — sillajuku

A code-driven template for the App Store preview images, built for the iPhone 17 Pro Max frame and styled to double as a designer-portfolio piece. One config file drives six 1320 × 2868 screenshots plus a 4800 × 2700 portfolio board.

```
AppStoreScreenshots/
├── slides.config.js   ← edit this: copy, layout, devices, cards, panorama
├── index.html         ← renderer: gallery · 1:1 slide · portfolio board
├── export.mjs         ← pixel-exact PNG export (headless Chrome, no npm deps)
├── sync-assets.mjs    ← copies icons + logos out of Assets.xcassets (export runs it)
├── assets/            ← synced brand assets (generated, don't edit by hand)
├── screens/           ← drop real app screenshots here (1320 × 2868)
├── out/               ← generated PNGs (git-ignored)
└── ko/                ← Korean listing: its own slides.config.js, screens/, out/
```

## Quick start

```bash
cd apps/ios/AppStoreScreenshots
node export.mjs --serve     # open the printed URL to preview + tweak
node export.mjs             # write out/01-home.png … out/06-discover.png + out/showcase.png
node export.mjs --lang=ko   # the Korean set → ko/out/ (preview: --serve, then index.html?lang=ko)
```

Options: `--only=1,3` (just those slides), `--no-showcase`, `--out=dir`, `--port=5173`.
The browser is auto-detected (Chrome/Edge on Windows, macOS, Linux); set `CHROME_PATH` to override.
Opening `index.html` directly also works for previewing, but `--serve` is more reliable for loading `screens/*.png`.

The export checks every PNG's size and exits non-zero on a mismatch. App Store Connect rejects screenshots with the wrong dimensions.

## The set

| # | id | Theme | Screen | Headline |
|---|----|-------|--------|----------|
| 01 | home | cream | Profile + logo lockup | Every record you’ve **loved.** |
| 02 | rate | cream | Album detail mid-drag (rate gauge) + score badge card | Rate it in **one drag.** |
| 03 | rankings | soft | Charts | Charts made by **listeners.** |
| 04 | feed | cream | Home feed (Following) + "Saved to Listen Later" toast | See what your friends **rate.** |
| 05 | taste | dark | Taste Report (dark mode) | Your taste, **mapped.** |
| 06 | discover | cream | Add tab + real app icon | Find your **next favorite.** |

The first three slides carry the story. In search results the App Store shows only the first three portrait screenshots, so 01–03 have to sell the app on their own.

## Design system

The slides follow the design language the web app and the iOS app already share, so the listing reads as the same product.

- **Type.** Plus Jakarta Sans only, the brand typeface on both platforms. Headlines are 800 weight at 124 px with −3.5% tracking and 1.06 leading, like the web's display headings. The accent word in `<em>` changes color, not typeface.
- **Eyebrows.** Each feature slide gets a small uppercase label in deep blue with a section number, the same pattern as the Taste Report's numbered sections. Numbers come from slide order.
- **Color.** Three themes map to the web palette in `globals.css`. `cream` is the page color `#F8F8F5`. `soft` is the accent-soft panel `#E9F1F8`. `dark` is the dark-mode page `#050505`. The soft and dark themes add the aurora washes the Taste hero uses. Blue `#2979B7` is the only accent.
- **Motif.** The halftone flower logo sits at about 9% opacity and bleeds off the edges, the way `AuthView` and the web login use it. Placed on the seams, it carries across slides when someone swipes the listing.
- **Layout.** Copy is left-aligned on a 110 px margin. The first and last slides are centered, like the sign-in screen. Phones stand upright and sit fully in frame, with at most one floating card that breaks the edge.
- **Voice.** Copy follows the app's own strings. It's plain second person in sentence case, with a period at the end. Headlines are two short lines. Subheads say what the feature does, using the app's own words such as Taste Report and Listen Later.
- **Cards.** Floating callouts are real app surfaces, a feed card, a score badge, or a toast, scaled up with one soft shadow.

## Mock screens and brand assets

Each mock is ported from its SwiftUI view, so the placeholders read as the real app.

| `screen:` | Mirrors | Notable details |
|---|---|---|
| `feed` | `HomeView` | Explore / Following glass switcher, bell, `FeedCard`s with the flower rate button and `ScoreBadge` |
| `profile` | `ProfileView` | @handle nav, stats header, Edit / Share buttons, icon tabs, `RatingListRow`s |
| `album` | `AlbumDetailView` | blurred cover hero, community line, Your Rating, tracklist; `state: { gauge: 4.5 }` draws the drag-to-rate overlay |
| `charts` | `ChartsView` | Albums / Songs switcher, expanded Ranking block, Trending card |
| `taste` | `TasteView` | taste-map rows and By the numbers; `state: { hero: true }` scrolls up to the Taste Report hero |
| `add` | `SearchView` | search field, artist circles, `DiscoveryAlbumCard`s |

Every screen uses the app's real tab bar: Home, Charts, the punched-out Add tile, Taste, and Profile. Colors come from the `sj*` color sets, fonts and sizes from `Font.jakarta` calls, and score colors from a port of the OKLCh `ScoreSpectrum`.

**Assets.** `sync-assets.mjs` copies the Lucide icon set, the `logo-text` wordmark, the halftone `logo-flower`, and both `AppIcon` PNGs into `assets/`. `export.mjs` runs it on every export, so new icons in the catalog show up automatically. The marketing copy uses them too: `copy.logo` shows the flower and wordmark lockup, `copy.mark` shows the real App Store icon, and the portfolio board header uses the lockup.

## The device frame

The frame is a pure-CSS **iPhone 17 Pro Max** built to real proportions.

- **Body.** The body is 78 × 163.4 mm, so its aspect ratio is 1 : 2.095.
- **Screen.** The screen is inset 3.3% of the body width. That makes it exactly the 1320 : 2868 display ratio, so a real screenshot fills it with no cropping.
- **Details.** The frame has a Dynamic Island with a lens, and an Action button with volume buttons on the left. The right side has the side button and Camera Control.
- **Finishes.** The rim is a metallic gradient in `silver`, `orange` (Cosmic Orange), `blue` (Deep Blue), or `black`. Set a finish per device in the config, or preview all devices in one finish with the **Finish** menu.

The whole frame scales with one number, the device's `w` in the config. Rotation is `rot` in degrees. The frame has no glare overlay, so the UI reads cleanly, which matches Apple's own marketing renders.

## Using real screenshots

The mocks are placeholders with an invented catalog: made-up artists, releases and reviews, with cover art drawn as vector scenes in `index.html` (`COVER_SVG`). Nothing is a real record, so there are no licensing problems for a portfolio. To swap in the real app:

1. Run the app in the **iPhone 17 Pro Max** simulator and set up each screen with good data.
2. Clean up the status bar before capturing:
   ```bash
   xcrun simctl status_bar booted override --time "9:41" --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
   ```
3. Capture with ⌘S in Simulator, or run `xcrun simctl io booted screenshot home.png`. Both give 1320 × 2868.
4. Save the files as `screens/profile.png`, `album.png`, `charts.png`, `feed.png`, `taste.png`, and `add.png`, the names referenced by `shot:` in the config.
5. Run `node export.mjs`. A device shows the real screenshot when that file exists and falls back to the mock when it doesn't.

If the real UI uses real album covers, check that you're comfortable showing them publicly before posting the portfolio board.

## Editing the config

```js
{
  id: 'rate',                 // output filename: 02-rate.png
  label: 'Rate',              // caption in the gallery and the portfolio board
  theme: 'cream',             // cream | soft | dark
  copy: {
    align: 'left', top: 200,  // left | center
    eyebrow: 'Rate',
    headline: 'Rate it in<br><em>one drag.</em>',
    sub: 'Press the flower and pull out to your score.',
    // mark: true            // show the app-mark tile above the copy
  },
  devices: [                  // 0..n phones; later entries paint on top
    { screen: 'album', state: { gauge: 4.5 }, shot: 'screens/album.png', x: 180, y: 800,
      w: 960, finish: 'silver', dark: false },
  ],
  cards: [                    // floating callouts drawn over the devices
    { kind: 'badge', x: 70, y: 2330, album: 0, value: 4.5, label: 'Your rating' },
    // { kind: 'post', x, y, rot, scale: 2.35, user: 'felix', album: 12, rating: 4.5, review: '…', likes: 18 }
    // { kind: 'chip', x, y, rot, icon: 'bookmark', text: 'Saved to Listen Later' }
  ],
}
```

- **Coordinates.** Positions are canvas pixels on the 1320 × 2868 slide. A device's x and y are its top-left corner before rotation. A device with `w` 1000 is 2095 px tall, so an x of 160 centers it horizontally.
- **Bleed.** Let phones run off the bottom or sides. A cropped device reads as intentional and gives the headline room.
- **Mock screens.** The `screen:` values are `feed`, `profile`, `album`, `charts`, `taste`, and `add`. The older names `home` and `rankings` still work. Add `dark: true` for dark mode.
- **Panorama.** Panorama x-coordinates run across the whole strip, so slide *n* covers x = 1320·(n−1) to 1320·n.
- **Adding a slide.** Append a slide to the list. The gallery, export, and portfolio board pick it up automatically. The board is laid out for six slides, so resize `.sc-frame` in `index.html` if you change the count.

## App Store Connect notes

- **Size.** Upload the 6.9" set at 1320 × 2868. Apple scales it down for smaller iPhones, so this one set is enough.
- **Count.** You can upload 1–10 screenshots per locale. Six is a solid default.
- **Format.** Upload PNG or JPEG in RGB with no transparency. The export already produces opaque PNGs.
- **Localization.** The Korean listing lives in `ko/` and renders with `--lang=ko`. See the section below.

## Portfolio use

- **The board.** `out/showcase.png` is a 4800 × 2700 (16:9) board with the title, the six frames, and numbered captions. It fits case-study headers, Behance and Dribbble covers, and slides.
- **Case-study images.** The individual PNGs work as detail shots.
- **Live demo.** In the gallery, **Panorama** plus a wide window makes a good screen recording of the swipe-through.
- **Other finishes.** Re-export with a different finish for variety.

## Korean listing (`ko/`)

The Korean set uses the same renderer, frame, and layout as the English set. Only `ko/slides.config.js` differs, and it sets `lang: 'ko'`.

- **Headlines.** Copy follows the app's Korean voice, polite 해요체 in two short lines ending in a period. Slide 01 uses the app's own tagline, 당신이 사랑한 모든 음반.
- **In-phone UI.** Mock strings switch to Korean through the `L10N.ko` table in `index.html`. Values come from the app's `Localizable.xcstrings`, or from the web's `ko.ts` where iOS has no Korean yet. Genre and country chips on Charts stay in English, because the app hardcodes them too.
- **Mock content.** Names and reviews are Korean, and a few releases have Korean titles so the catalog reads local.
- **Type.** Plus Jakarta Sans has no Hangul, so Hangul falls back to Pretendard, the closest match to iOS's Apple SD Gothic Neo. Korean headlines get looser leading and whole-word wrapping.
- **Real captures.** Run the simulator in Korean and save the shots to `ko/screens/`, using the same file names as the English set.

To add another language, copy `ko/` to a new folder, set its `lang`, add a table to `L10N`, and export with `--lang=<code>`.
