/*
 * App Store screenshot set — the only file you normally edit.
 *
 * Coordinates are in canvas pixels (1320 × 2868, the 6.9" iPhone size App Store
 * Connect requires). x/y place the top-left corner of a device *before* rotation;
 * w is the device body width (1000 ≈ the classic "phone fills the frame" look).
 *
 * label          → caption in the gallery + portfolio board
 *
 * device.screen  → built-in mock UI, each ported from its SwiftUI view:
 *                    feed     HomeView (Explore / Following feed of FeedCards)
 *                    profile  ProfileView (stats header + rated list)
 *                    album    AlbumDetailView (blurred hero, Your Rating, tracklist)
 *                    charts   ChartsView (Ranking block + Trending)
 *                    taste    TasteView (Taste Report hero + taste map)
 *                    add      SearchView (search + discovery rows)
 * device.state   → per-screen options, e.g. album { gauge: 4.5 } shows the drag-to-rate
 *                  overlay at that score; feed { explore: true } selects Explore.
 * device.shot    → a real screenshot (screens/*.png, 1320×2868 from the iPhone 17
 *                  Pro Max simulator). If the file is missing, the mock shows instead.
 * device.finish  → silver | orange | blue | black (iPhone 17 Pro finishes + black)
 *
 * theme          → cream (page) | soft (accent-soft + aurora) | dark (near-black + aurora)
 * copy.eyebrow   → tiny uppercase label; numbered automatically by slide order (override with copy.no)
 * copy.headline  → two short lines, sentence case, ends with a period; <em> = accent color
 * copy.logo      → halftone flower + wordmark lockup (from Assets.xcassets)
 * copy.mark      → the real App Store icon tile ('dark' for the dark variant)
 *
 * cards[]        → floating callouts drawn over the devices:
 *                    { kind: 'post',  user, album, rating, review, likes, comments, liked, scale }  a real FeedCard
 *                    { kind: 'badge', album, value, label }                                         a poster-size ScoreBadge
 *                    { kind: 'chip',  text, icon }
 *
 * panorama[] items live on one continuous strip that spans every slide
 * (strip x = slideIndex × 1320 + local x), so a flower placed on a seam
 * flows across two screenshots — the "swipe-through" look in the App Store.
 * They use the halftone logo at ~9% (the AuthView / login treatment); style: 'glyph' for the flat mark.
 */
window.APPSHOTS = {
  brand: {
    name: 'sillajuku',
    showcaseTitle: 'Every record<br>you’ve <em>loved.</em>',
    showcaseMeta: 'App Store screenshots · iPhone 17 Pro Max · 2026',
  },

  canvas: { width: 1320, height: 2868 },

  device: { model: 'iPhone 17 Pro Max', finish: 'silver' },

  panorama: [
    { x: 1320, y: -120, size: 1250, rot: 12 },   // 01 | 02, top corner
    { x: 2640, y: 2660, size: 1200, rot: -8 },   // 02 | 03, bottom
    { x: 5280, y: 2640, size: 1300, rot: 18 },   // 04 | 05, bottom
    { x: 6720, y: 140,  size: 1300, rot: -14 },  // 05 | 06, top
  ],

  slides: [
    {
      id: 'home',
      label: 'Profile',
      theme: 'cream',
      copy: {
        align: 'center', top: 150,
        logo: true,
        headline: 'Every record<br>you’ve <em>loved.</em>',
        sub: 'Rate what you listen to, and keep all of it in one place.',
      },
      devices: [
        { screen: 'profile', shot: 'screens/profile.png', x: 210, y: 950, w: 900 },
      ],
    },
    {
      id: 'rate',
      label: 'Rate',
      theme: 'cream',
      copy: {
        eyebrow: 'Rate',
        headline: 'Rate it in<br><em>one drag.</em>',
        sub: 'Press the flower and pull out to your score.',
      },
      devices: [
        { screen: 'album', state: { gauge: 4.5 }, shot: 'screens/album.png', x: 180, y: 800, w: 960 },
      ],
      cards: [
        { kind: 'badge', x: 70, y: 2330, album: 0, value: 4.5, label: 'Your rating' },
      ],
    },
    {
      id: 'rankings',
      label: 'Charts',
      theme: 'soft',
      copy: {
        eyebrow: 'Charts',
        headline: 'Charts made<br>by <em>listeners.</em>',
        sub: 'Community rankings for every genre and country, plus what’s trending this week.',
      },
      devices: [
        { screen: 'charts', shot: 'screens/charts.png', x: 180, y: 800, w: 960 },
      ],
    },
    {
      id: 'feed',
      label: 'Feed',
      theme: 'cream',
      copy: {
        eyebrow: 'Feed',
        headline: 'See what your<br>friends <em>rate.</em>',
        sub: 'Follow people whose taste you trust. Like, comment, and save to a mix.',
      },
      devices: [
        { screen: 'feed', shot: 'screens/feed.png', x: 180, y: 800, w: 960 },
      ],
      cards: [
        { kind: 'chip', x: 620, y: 1480, icon: 'bookmark-filled', text: 'Saved to Listen Later' },
      ],
    },
    {
      id: 'taste',
      label: 'Taste',
      theme: 'dark',
      copy: {
        eyebrow: 'Taste',
        headline: 'Your taste,<br><em>mapped.</em>',
        sub: 'Your Taste Report shows the genres, the eras, and the scores that make up your taste.',
      },
      devices: [
        { screen: 'taste', dark: true, shot: 'screens/taste.png', x: 180, y: 800, w: 960, finish: 'blue' },
      ],
    },
    {
      id: 'discover',
      label: 'Discover',
      theme: 'cream',
      copy: {
        align: 'center', top: 170,
        mark: true,
        headline: 'Find your<br><em>next favorite.</em>',
      },
      devices: [
        { screen: 'add', shot: 'screens/add.png', x: 140, y: 930, w: 1040 },
      ],
    },
  ],
};
