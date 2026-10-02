/*
 * Instagram Reels — Korean, 1080 x 1920, ~11.5s. Full-bleed app, kinetic type, visible touch.
 *
 *   node render-frames.mjs --lang=reels
 *   node make-reel.mjs --frames=reels/frames --out=reels/out/reels.mp4
 *
 * THE STRUCTURE IS BORROWED, NOT INVENTED. Earlier cuts of this were my own layout re-proportioned
 * three times, which is why each one still read like a store screenshot. This follows what app demo
 * videos that work actually do:
 *
 *   SHOW END FIRST. One of the highest-performing hook types on the platform (~22% of top hooks), and
 *   the opposite of what the earlier cuts did - they opened on step one of a process and asked the
 *   viewer to wait for the point. Beat 1 is the finished taste map: the result, before the method. The
 *   question "how?" is what carries someone into beat 2.
 *
 *   MOTION IN THE FIRST FRAME. Cited as the single most reliable hook enhancer. Nothing here fades up
 *   from a still: the first frame is already mid-scroll with the caption arriving.
 *
 *   VISIBLE TAP POINTS. Apple's own Journal walkthrough highlights where it touches, and Duolingo
 *   layers motion over real screens with on-screen text and no narration. A screen that changes by
 *   itself reads as a video OF a UI; a finger pressing and dragging reads as someone using one. This
 *   is the piece every earlier cut was missing.
 *
 *   GROUPED BY USER LOGIC, NOT MENU ORDER (Klarna, Traveloka). Result -> how -> it accumulates -> other
 *   people, which is the order a stranger's questions actually arrive in.
 *
 * MUTE-READABLE THROUGHOUT: every claim is type, nothing depends on audio. BUILT TO LOOP: the end card
 * is quiet so a replay reads as a breath. SAFE AREA: captions sit clear of Instagram's chrome.
 */
window.APPSHOTS = {
  lang: 'ko',
  mode: 'reels',

  brand: {
    name: 'sillajuku',
    showcaseTitle: '1년 치 음악 취향,<br><em>한 장으로.</em>',
    showcaseMeta: 'Instagram Reels · 1080 × 1920 · 2026',
  },

  canvas: { width: 1080, height: 1920 },
  output: { naming: 'index' },
  device: { model: 'iPhone 17 Pro Max', finish: 'silver' },

  reel: { fps: 30 },

  slides: [
    {
      /* 1 — THE RESULT, FIRST. Dark, dense, and unlike anything else in a feed, which is the point: it
         has to look like something before it has to mean something. The claim is the payoff of the whole
         app, stated before any method. */
      id: 'end-first',
      theme: 'dark',
      dur: 2.5,
      capTop: 300,
      shiftY: 250,
      caption: '1년 치 음악 취향,<br><em>한 장으로.</em>',
      devices: [{ screen: 'taste', dark: true, w: 440 }],
    },
    {
      /* 2 — "HOW?" The method, with a finger doing it. The touch arrives, presses the control, drags,
         and lifts; the gauge tracks it. Longest beat, because this is the thing people have to
         understand, and the only one where the gesture has to be legible. */
      id: 'drag',
      theme: 'cream',
      dur: 3.1,
      capTop: 300,
      shiftY: 300,
      caption: '꽃을 끌어당기면<br><em>평가 끝.</em>',
      // Canvas coordinates, on the rate control. at/dur line the press up with the gauge sweep below.
      // Ends ON the badge: this control keeps the badge in place and fills the arc, so a finger that
      // trails below it reads as dragging empty space rather than holding the thing that is moving.
      touch: { x1: 1002, y1: 1300, x2: 1002, y2: 1190, at: 0.5, dur: 1.15 },
      devices: [{ screen: 'album', state: { gauge: 4.5 }, w: 440 }],
    },
    {
      /* 3 — IT ACCUMULATES. The list, already full. Short: it is a fact, not an argument. */
      id: 'stack',
      theme: 'cream',
      dur: 2.1,
      capTop: 300,
      shiftY: 180,
      caption: '한 장씩 쌓이고.',
      sub: '앨범도, 곡도, 0.5점 단위로.',
      devices: [{ screen: 'profile', w: 440 }],
    },
    {
      /* 4 — OTHER PEOPLE. The reason to come back rather than to try. */
      id: 'charts',
      theme: 'soft',
      dur: 2.1,
      capTop: 300,
      shiftY: 260,
      caption: '차트는<br><em>리스너가 만들어요.</em>',
      devices: [{ screen: 'charts', w: 440 }],
    },
    {
      /* 5 — CTA last, on someone who has now watched the app work. Back to cream and quiet so the loop
         to beat 1 reads as a breath rather than a cut. */
      id: 'end',
      theme: 'cream',
      dur: 2.0,
      end: true,
      caption: '지금<br><em>기록을 시작하세요.</em>',
      sub: 'App Store · sillajuku.com',
      devices: [{ screen: 'profile', w: 440 }],
    },
  ],
};
