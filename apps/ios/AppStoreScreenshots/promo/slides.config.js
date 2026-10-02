/*
 * Instagram Reels promo — Korean, 1080 x 1920, ~14s.
 *
 *   node render-frames.mjs --lang=promo
 *   node make-reel.mjs --frames=promo/frames --out=promo/out/promo.mp4
 *
 * THIS IS NOT THE APP STORE SET RE-CUT. The store listing and a reel are opposite problems. Someone on
 * a store page has already decided to look; someone on Reels is deciding whether to keep scrolling, and
 * decides in about a second, usually with the sound off. Three things follow, and they are why this
 * config is shaped the way it is rather than mirroring ../reel:
 *
 *   1. NO LOGO AT THE START. A wordmark and a tagline is the most-skipped opening in the format: it
 *      asks for brand recall from someone who has no reason to give it yet. The brand moved to the END,
 *      where it lands on someone who has already watched the thing. The reel opens cold on the gesture.
 *   2. THREE FEATURES, NOT SIX. Six features in fifteen seconds is 2.5s each - long enough to register
 *      that something happened, too short for any of it to mean anything. Rate / taste / charts: the
 *      signature interaction, the payoff for doing it, and the reason to come back.
 *   3. THE HOOK IS A GESTURE, NOT A SENTENCE. Dragging a flower to score an album is strange enough to
 *      stop a thumb and obvious enough to need no caption, so beat one is the control being used, shot
 *      close. Text supports it; it does not carry it.
 *
 * SOUND OFF IS THE DEFAULT. Every claim is on screen as type. Nothing depends on audio.
 *
 * BUILT TO LOOP. The last beat returns to the cream background and the quiet of the first, so a replay
 * does not feel like a cut - and replays are counted.
 *
 * SAFE AREA. Instagram's caption, account row and action rail cover roughly the bottom third, and the
 * top ~220px sits under the status bar and close button. All copy lives between those lines; the phone
 * is allowed to run under the bottom chrome because the part it covers is the part nobody reads.
 */
window.APPSHOTS = {
  lang: 'ko',

  brand: {
    name: 'sillajuku',
    showcaseTitle: '드래그 한 번이면<br><em>평가 끝.</em>',
    showcaseMeta: 'Instagram Reels · 1080 × 1920 · 2026',
  },

  canvas: { width: 1080, height: 1920 },
  output: { naming: 'index' },
  device: { model: 'iPhone 17 Pro Max', finish: 'silver' },

  // transition is the handover between beats; each beat sets its own `dur`.
  // rateAt/rateDur place the drag inside the hook beat: it starts almost at once, because the gesture
  // is the hook, and takes long enough to read as a hand moving rather than a number jumping.
  reel: { transition: 0.55, fps: 30, rateAt: 0.45, rateDur: 1.05 },

  // Four flowers across a four-beat strip. Kept sparse: in motion this is background texture, and the
  // moment it becomes the most moving thing on screen it is wrong.
  panorama: [
    { x: 1080, y: -40,  size: 900, rot: 12 },
    { x: 2160, y: 1880, size: 880, rot: -8 },
    { x: 3240, y: 80,   size: 940, rot: -14 },
  ],

  slides: [
    {
      /* BEAT 1 — the hook. Cold open on the rate control, camera pushed in so the flower and the
         climbing number fill the frame. No eyebrow, no logo, no preamble: by the time a viewer could
         decide to scroll, the gesture has already started. */
      id: 'rate',
      label: '평가',
      theme: 'cream',
      dur: 4.6,
      // Pushed in on the control, but only as far as keeps the phone's top edge clear of the
      // headline: at w 790 the device is 1655 tall with its origin at 42%, so scale 1.2 puts the top
      // at y~500 and the two-line headline ends at ~413.
      camera: { scale: 1.2, x: -40, y: -130 },
      copy: {
        top: 170,
        headline: '앨범 하나에<br><em>드래그 한 번.</em>',
      },
      devices: [
        { screen: 'album', state: { gauge: 4.5 }, x: 150, y: 820, w: 790 },
      ],
    },
    {
      /* BEAT 2 — the payoff. Answers the question beat 1 raises: why score anything at all. The camera
         pulls back to let the whole screen be read, because this beat is about what you GET, and that
         has to be legible rather than close. */
      id: 'taste',
      label: '취향',
      theme: 'dark',
      dur: 4.0,
      camera: { scale: 1.0, x: 0, y: 0 },
      copy: {
        top: 250,
        headline: '쌓이면<br><em>내 취향이 보여요.</em>',
        sub: '장르도, 시대도, 점수 습관까지.',
      },
      devices: [
        { screen: 'taste', dark: true, x: 150, y: 820, w: 790, finish: 'blue' },
      ],
    },
    {
      /* BEAT 3 — the reason to come back. Other people. Kept shortest: it is the supporting argument,
         not the sell. */
      id: 'charts',
      label: '차트',
      theme: 'soft',
      dur: 3.4,
      camera: { scale: 1.04, x: 0, y: -40 },
      copy: {
        top: 250,
        headline: '차트는<br><em>리스너가 만들어요.</em>',
      },
      devices: [
        { screen: 'charts', x: 150, y: 820, w: 790 },
      ],
    },
    {
      /* BEAT 4 — brand and CTA, at the end where it belongs, on someone who has now watched the app
         work. Returns to cream and to stillness so the loop back to beat 1 reads as a breath rather
         than a cut. */
      id: 'brand',
      label: '시작',
      theme: 'cream',
      dur: 2.2,
      camera: { scale: 1.1, x: 0, y: 260 },
      copy: {
        align: 'center', top: 360,
        logo: true,
        headline: '지금<br><em>기록을 시작하세요.</em>',
        sub: 'App Store · sillajuku.com',
      },
      devices: [
        { screen: 'profile', x: 190, y: 1240, w: 700 },
      ],
    },
  ],
};
