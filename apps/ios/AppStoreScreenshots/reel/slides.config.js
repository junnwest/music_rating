/*
 * Instagram reel / story — Korean, 1080 x 1920.
 *
 * Same renderer and design system as the App Store sets; see ../slides.config.js for every option and
 * ../README.md for the format notes.
 *
 *   node export.mjs --lang=reel --no-showcase   → reel/out/01.png … (1080 x 1920)
 *   node make-reel.mjs                          → reel/out/reel.mp4
 *
 * SAFE AREA IS THE WHOLE CONSTRAINT HERE, and it is what makes this different from the 4:5 post.
 * Instagram draws its own chrome over a reel: the caption, the account row and the action rail cover
 * roughly the bottom third, and the top ~200px sits under the status bar and the close button. So the
 * headline cannot sit wherever it looks best on a flat canvas — it has to live in the upper middle,
 * between about y=260 and y=1250, or the platform crops the message rather than the picture.
 *
 * The phone therefore starts lower than the extra height would suggest and still bleeds off the bottom:
 * the part of it that falls under Instagram's chrome is the part nobody needed to read. Copy sits above
 * the fold, where it survives.
 *
 * Type is not re-tuned: --s = canvas.width / 1320 keeps the design system's proportions at 1080 wide.
 */
window.APPSHOTS = {
  lang: 'ko',

  brand: {
    name: 'sillajuku',
    showcaseTitle: '당신이 사랑한<br><em>모든 음반.</em>',
    showcaseMeta: 'Instagram 릴스 · 1080 × 1920 · 2026',
  },

  canvas: { width: 1080, height: 1920 },

  output: { naming: 'index' },

  device: { model: 'iPhone 17 Pro Max', finish: 'silver' },

  // Seams of a six-card strip at 1080 wide; the flower carries across cuts in the video too.
  panorama: [
    { x: 1080, y: -60,  size: 1000, rot: 12 },
    { x: 2160, y: 1840, size: 960,  rot: -8 },
    { x: 4320, y: 1820, size: 1040, rot: 18 },
    { x: 5400, y: 120,  size: 1040, rot: -14 },
  ],

  slides: [
    {
      id: 'home',
      label: '프로필',
      theme: 'cream',
      copy: {
        align: 'center', top: 300,
        logo: true,
        headline: '당신이 사랑한<br><em>모든 음반.</em>',
        sub: '듣는 음악을 평가하고, 모두 한곳에 남겨 두세요.',
      },
      devices: [
        { screen: 'profile', x: 190, y: 1130, w: 700 },
      ],
    },
    {
      id: 'rate',
      label: '평가',
      theme: 'cream',
      copy: {
        top: 300,
        eyebrow: '평가',
        headline: '드래그 한 번이면<br><em>평가 끝.</em>',
        sub: '꽃을 누른 채 원하는 점수까지 끌어당기세요.',
      },
      devices: [
        { screen: 'album', state: { gauge: 4.5 }, x: 170, y: 980, w: 740 },
      ],
    },
    {
      id: 'rankings',
      label: '차트',
      theme: 'soft',
      copy: {
        top: 300,
        eyebrow: '차트',
        headline: '리스너가 만드는<br><em>차트.</em>',
        sub: '장르와 국가별 커뮤니티 랭킹에, 이번 주 트렌딩까지.',
      },
      devices: [
        { screen: 'charts', x: 170, y: 1010, w: 740 },
      ],
    },
    {
      id: 'feed',
      label: '피드',
      theme: 'cream',
      copy: {
        top: 300,
        eyebrow: '피드',
        headline: '친구의 평가를<br><em>한눈에.</em>',
        sub: '취향이 맞는 사람을 팔로우하고, 믹스에 저장하세요.',
      },
      devices: [
        { screen: 'feed', x: 170, y: 980, w: 740 },
      ],
    },
    {
      id: 'taste',
      label: '취향',
      theme: 'dark',
      copy: {
        top: 300,
        eyebrow: '취향',
        headline: '내 취향을<br><em>한 장의 지도로.</em>',
        sub: '테이스트 리포트가 내 장르와 시대, 점수 습관을 보여줘요.',
      },
      devices: [
        { screen: 'taste', dark: true, x: 170, y: 1020, w: 740, finish: 'blue' },
      ],
    },
    {
      id: 'discover',
      label: '탐색',
      theme: 'cream',
      copy: {
        align: 'center', top: 320,
        mark: true,
        headline: '다음 인생 앨범을<br><em>만나보세요.</em>',
      },
      devices: [
        { screen: 'add', x: 205, y: 1120, w: 670 },
      ],
    },
  ],
};
