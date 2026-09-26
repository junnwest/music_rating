/*
 * App Store screenshot set — Korean (ko) listing.
 *
 * Same renderer, frame, and design system as the English set in ../slides.config.js;
 * see that file for every option. Only the copy, labels, and screenshot paths differ.
 * In-phone UI strings switch to Korean automatically (lang: 'ko'), using the app's own
 * translations from Localizable.xcstrings.
 *
 *   node export.mjs --lang=ko          → ko/out/01-home.png … + ko/out/showcase.png
 *   node export.mjs --lang=ko --serve  → preview at index.html?lang=ko
 *
 * Real captures: run the simulator in Korean and save them as ko/screens/*.png.
 *
 * Copy follows the app's Korean voice (ko.ts / Localizable.xcstrings): polite 해요체,
 * short two-line headlines ending in a period, the tagline "당신이 사랑한 모든 음반."
 */
window.APPSHOTS = {
  lang: 'ko',

  brand: {
    name: 'sillajuku',
    showcaseTitle: '당신이 사랑한<br><em>모든 음반.</em>',
    showcaseMeta: 'App Store 스크린샷 · iPhone 17 Pro Max · 2026',
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
      label: '프로필',
      theme: 'cream',
      copy: {
        align: 'center', top: 150,
        logo: true,
        headline: '당신이 사랑한<br><em>모든 음반.</em>',
        sub: '듣는 음악을 평가하고, 모두 한곳에 남겨 두세요.',
      },
      devices: [
        { screen: 'profile', shot: 'ko/screens/profile.png', x: 210, y: 950, w: 900 },
      ],
    },
    {
      id: 'rate',
      label: '평가',
      theme: 'cream',
      copy: {
        eyebrow: '평가',
        headline: '드래그 한 번이면<br><em>평가 끝.</em>',
        sub: '꽃을 누른 채 원하는 점수까지 끌어당기세요.',
      },
      devices: [
        { screen: 'album', state: { gauge: 4.5 }, shot: 'ko/screens/album.png', x: 180, y: 800, w: 960 },
      ],
      cards: [
        { kind: 'badge', x: 70, y: 2330, album: 0, value: 4.5 },
      ],
    },
    {
      id: 'rankings',
      label: '차트',
      theme: 'soft',
      copy: {
        eyebrow: '차트',
        headline: '리스너가 만드는<br><em>차트.</em>',
        sub: '장르와 국가별 커뮤니티 랭킹에, 이번 주 트렌딩까지.',
      },
      devices: [
        { screen: 'charts', shot: 'ko/screens/charts.png', x: 180, y: 800, w: 960 },
      ],
    },
    {
      id: 'feed',
      label: '피드',
      theme: 'cream',
      copy: {
        eyebrow: '피드',
        headline: '친구의 평가를<br><em>한눈에.</em>',
        sub: '취향이 맞는 사람을 팔로우하고, 좋아요와 댓글을 남기고, 믹스에 저장하세요.',
      },
      devices: [
        { screen: 'feed', shot: 'ko/screens/feed.png', x: 180, y: 800, w: 960 },
      ],
      cards: [
        { kind: 'chip', x: 600, y: 1408, icon: 'bookmark-filled', text: '나중에 듣기에 저장됨' },
      ],
    },
    {
      id: 'taste',
      label: '취향',
      theme: 'dark',
      copy: {
        eyebrow: '취향',
        headline: '내 취향을<br><em>한 장의 지도로.</em>',
        sub: '테이스트 리포트가 내 장르와 시대, 점수 습관을 보여줘요.',
      },
      devices: [
        { screen: 'taste', dark: true, shot: 'ko/screens/taste.png', x: 180, y: 800, w: 960, finish: 'blue' },
      ],
    },
    {
      id: 'discover',
      label: '탐색',
      theme: 'cream',
      copy: {
        align: 'center', top: 170,
        mark: true,
        headline: '다음 인생 앨범을<br><em>만나보세요.</em>',
      },
      devices: [
        { screen: 'add', shot: 'ko/screens/add.png', x: 140, y: 930, w: 1040 },
      ],
    },
  ],
};
