/*
 * Instagram Reels — Korean, 1080 x 1920, ~13s. Full-bleed app, kinetic type over it.
 *
 *   node render-frames.mjs --lang=reels
 *   node make-reel.mjs --frames=reels/frames --out=reels/out/reels.mp4
 *
 * THIS IS NOT THE STORE TEMPLATE RESIZED. `../promo` was, and that is why it still read like a store
 * screenshot in a feed: a headline band on top, a phone standing below, cream margins around it. The
 * composition itself was the problem, not its proportions. This config drives `?reels`, a different
 * renderer (see index.html) whose rules are the format's, not the listing's:
 *
 *   the app fills the frame      no device chrome, no margin - you are looking at the app, not a photo of a phone
 *   type sits ON the app         captions ride the UI with a scrim, the way the format actually captions things
 *   cuts are hard                a dissolve between two full-frame UIs is mush; beats change on a cut with a punch
 *   beats are short              1.9-2.6s, not 4
 *
 * THREE FEATURES, in the order that answers a stranger's questions: what do I do (drag), what do I get
 * (my taste), why come back (other people). Profile, feed and discover are gone.
 *
 * NO LOGO UNTIL THE END. A wordmark on frame one asks for brand recall from someone with no reason to
 * give it; it is the most-skipped opening in the format. It lands last, on someone who just watched the
 * app work.
 *
 * SOUND OFF IS THE DEFAULT - every claim is type. BUILT TO LOOP - the end card is quiet and cream, so a
 * replay reads as a breath. SAFE AREA - captions sit between y 300 and y 1250, clear of Instagram's own
 * chrome top and bottom.
 */
window.APPSHOTS = {
  lang: 'ko',
  mode: 'reels',

  brand: {
    name: 'sillajuku',
    showcaseTitle: '드래그 한 번이면<br><em>평가 끝.</em>',
    showcaseMeta: 'Instagram Reels · 1080 × 1920 · 2026',
  },

  canvas: { width: 1080, height: 1920 },
  output: { naming: 'index' },
  device: { model: 'iPhone 17 Pro Max', finish: 'silver' },

  // The drag starts almost immediately: the gesture is the hook, so it cannot wait for a caption.
  reel: { fps: 30, rateAt: 0.35, rateDur: 1.1 },

  slides: [
    {
      /* 1 — COLD OPEN ON THE GESTURE. No logo, no setup. The album page fills the frame and the flower
         is already being dragged by the time a thumb could decide to move. */
      id: 'drag',
      theme: 'cream',
      dur: 2.6,
      capTop: 300,
      // Push the album page down so its own title clears the caption band; the gauge then sits
      // mid-frame, which is where the eye goes.
      shiftY: 300,
      caption: '앨범 하나에<br><em>드래그 한 번.</em>',
      devices: [{ screen: 'album', state: { gauge: 4.5 }, w: 440 }],
    },
    {
      /* 2 — THE SAME SCREEN, SCORED. A cut back to the album with the rating in place: the payoff of
         beat one, stated in two words so it reads in a glance. */
      id: 'done',
      theme: 'cream',
      dur: 1.9,
      capTop: 300,
      shiftY: 300,
      caption: '<em>평가 끝.</em>',
      sub: '0.5점 단위로, 5초 안에.',
      devices: [{ screen: 'album', state: { gauge: 4.5, score: 4.5 }, w: 440 }],
    },
    {
      /* 3 — WHAT IT ADDS UP TO. The taste map, dark, full frame. This is the reason to rate anything,
         so it gets the longest beat of the three features. */
      id: 'taste',
      theme: 'dark',
      dur: 2.8,
      capTop: 300,
      shiftY: 250,
      caption: '쌓이면<br><em>내 취향이 보여요.</em>',
      sub: '장르도, 시대도, 점수 습관까지.',
      devices: [{ screen: 'taste', dark: true, w: 440 }],
    },
    {
      /* 4 — WHY COME BACK. Other people. Shortest of the three: it is the supporting argument. */
      id: 'charts',
      theme: 'soft',
      dur: 2.4,
      capTop: 300,
      shiftY: 260,
      caption: '차트는<br><em>리스너가 만들어요.</em>',
      devices: [{ screen: 'charts', w: 440 }],
    },
    {
      /* 5 — BRAND AND CTA, last, on someone who has now seen the app work. Type only, centred, quiet,
         and back on cream so the loop to beat one is a breath rather than a cut. */
      id: 'end',
      theme: 'cream',
      dur: 2.3,
      end: true,
      caption: '지금<br><em>기록을 시작하세요.</em>',
      sub: 'App Store · sillajuku.com',
      devices: [{ screen: 'profile', w: 440 }],
    },
  ],
};
