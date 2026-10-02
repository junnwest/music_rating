/*
 * Instagram feed carousel — Korean.
 *
 * Same renderer, frame, and design system as the App Store sets; only the canvas and the layout
 * differ. See ../slides.config.js for every option and ../README.md for the format notes.
 *
 *   node export.mjs --lang=ig          → ig/out/01-home.png … (1080 x 1350)
 *   node export.mjs --lang=ig --serve  → preview at index.html?lang=ig
 *
 * WHY THE LAYOUT CHANGES, not just the canvas. The App Store slide is 1320 x 2868, a tall column
 * with the whole phone standing inside it. A feed post is 1080 x 1350 — relatively much wider —
 * so a full phone would have to shrink until the screen content is unreadable, which is the one
 * thing these slides exist to show. Instead the phone keeps a legible size and BLEEDS off the
 * bottom edge: the top half of the screen, where the content actually is, stays in frame. That is
 * also how the format is normally used, so it reads as native rather than as a resized store asset.
 *
 * Type is not re-tuned here. The renderer derives --s from canvas.width / 1320, so every size in
 * the design system keeps its proportion at 1080 wide (headline 124 -> ~101, margins 110 -> 90).
 *
 * The panorama strip spans slides.length * canvas.width, so the seams sit at 1080, 2160, 3240 …
 * and the flower still carries from one card to the next as someone swipes the carousel.
 */
window.APPSHOTS = {
  lang: 'ko',

  brand: {
    name: 'sillajuku',
    showcaseTitle: '당신이 사랑한<br><em>모든 음반.</em>',
    showcaseMeta: 'Instagram 캐러셀 · 1080 × 1350 · 2026',
  },

  // 4:5, the tallest ratio the feed renders without cropping.
  canvas: { width: 1080, height: 1350 },

  device: { model: 'iPhone 17 Pro Max', finish: 'silver' },

  // Seams of a six-card carousel at 1080 wide.
  panorama: [
    { x: 1080, y: -80,  size: 980, rot: 12 },
    { x: 2160, y: 1280, size: 940, rot: -8 },
    { x: 4320, y: 1270, size: 1020, rot: 18 },
    { x: 5400, y: 90,   size: 1020, rot: -14 },
  ],

  slides: [
    {
      id: 'home',
      label: '프로필',
      theme: 'cream',
      copy: {
        align: 'center', top: 92,
        logo: true,
        headline: '당신이 사랑한<br><em>모든 음반.</em>',
        sub: '듣는 음악을 평가하고, 모두 한곳에 남겨 두세요.',
      },
      devices: [
        { screen: 'profile', x: 240, y: 790, w: 600 },
      ],
    },
    {
      id: 'rate',
      label: '평가',
      theme: 'cream',
      copy: {
        top: 96,
        eyebrow: '평가',
        headline: '드래그 한 번이면<br><em>평가 끝.</em>',
        sub: '꽃을 누른 채 원하는 점수까지 끌어당기세요.',
      },
      devices: [
        { screen: 'album', state: { gauge: 4.5 }, x: 200, y: 600, w: 680 },
      ],
      cards: [
        { kind: 'badge', x: 56, y: 1086, album: 0, value: 4.5 },
      ],
    },
    {
      id: 'rankings',
      label: '차트',
      theme: 'soft',
      copy: {
        top: 96,
        eyebrow: '차트',
        headline: '리스너가 만드는<br><em>차트.</em>',
        sub: '장르와 국가별 커뮤니티 랭킹에, 이번 주 트렌딩까지.',
      },
      devices: [
        { screen: 'charts', x: 200, y: 630, w: 680 },
      ],
    },
    {
      id: 'feed',
      label: '피드',
      theme: 'cream',
      copy: {
        top: 96,
        eyebrow: '피드',
        headline: '친구의 평가를<br><em>한눈에.</em>',
        sub: '취향이 맞는 사람을 팔로우하고, 믹스에 저장하세요.',
      },
      devices: [
        { screen: 'feed', x: 200, y: 600, w: 680 },
      ],
    },
    {
      id: 'taste',
      label: '취향',
      theme: 'dark',
      copy: {
        top: 96,
        eyebrow: '취향',
        headline: '내 취향을<br><em>한 장의 지도로.</em>',
        sub: '테이스트 리포트가 내 장르와 시대, 점수 습관을 보여줘요.',
      },
      devices: [
        { screen: 'taste', dark: true, x: 200, y: 640, w: 680, finish: 'blue' },
      ],
    },
    {
      id: 'discover',
      label: '탐색',
      theme: 'cream',
      copy: {
        align: 'center', top: 104,
        mark: true,
        headline: '다음 인생 앨범을<br><em>만나보세요.</em>',
      },
      devices: [
        { screen: 'add', x: 215, y: 700, w: 650 },
      ],
    },
  ],
};
