/**
 * Bilingual copy for the /about page. Kept local to this route rather than
 * wired into lib/i18n/{en,ko}.ts — folding it into the real dictionaries is
 * a reasonable follow-up once this copy is finalized.
 *
 * Voice: short, plain, declarative — matching the real shipped onboarding
 * copy (BetaSwipeFlow.tsx), not essay prose. Trust the reader; don't explain
 * a line after saying it.
 *
 * Curated 2026-09-02: cut the name-origin/etymology section entirely,
 * merged mélomane into the philosophy section (one flowing identity+values
 * beat instead of two), added a real product intro and a "how it actually
 * works" section naming two genuinely distinctive mechanics (the flower
 * drag-to-rate control, the taste-cluster recommender) instead of a generic
 * feature list.
 *
 * Korean tone pass 2026-09-02: rewritten against Watcha's actual shipped
 * brand copy (about.watcha.com / watcha.team — the closest domestic analog:
 * a Korean taste/rating app with an almost identical "취향이 존중받는 세상"
 * philosophy). Declarative 습니다체 throughout, not 해요체 imperative
 * commands (그건 온보딩 톤이지 브랜드 톤이 아님) — no em-dashes (a transplanted
 * English rhetorical device; connect clauses with -고/-며/-되 instead) —
 * brand refers to itself by name ("실라주쿠는") rather than "저희" — "당신"
 * dropped in favor of natural pro-drop subjects.
 *
 * Fact-check pass 2026-09-02: the "rankings weight critics/DJs over stream
 * counts" claim was checked against the actual chart RPCs
 * (supabase/migrations/20260706000002_charts_release_type.sql) and is false
 * — get_charts_most_rated/get_charts_trending are a plain Bayesian average
 * and a plain COUNT(*), with no join to any credibility/verification signal.
 * Removed the claim everywhere on this page (hero subhead, philosophy, the
 * "Ranking" mechanics item) rather than describe a mechanic that doesn't
 * exist yet.
 *
 * Fact-check pass 2 2026-09-02: two more found on a full re-audit.
 * (1) "let you dial how far outside [your clusters] you're willing to
 * wander" — `recommendation_adventurousness` is a real DB field the
 * recommender reads, but there is no UI anywhere (web or iOS) that lets a
 * user actually set it. Rewritten to not claim a control that doesn't
 * exist. (2) The founding-999 panel described a public numbered program;
 * the only real thing in the schema is `is_beta_tester`
 * (20260828000000_beta_tester_badge.sql) — a private flag manually granted
 * to hand-picked accounts, not a public counter. Cut the section entirely
 * rather than describe it as live. The closing beat now leads with the live
 * ratings count instead (verified real via /api/stats/public).
 */

export type AboutLang = 'en' | 'ko';

export const COPY = {
  tagline: {
    en: "Every record you've loved.",
    ko: '당신이 사랑했던 모든 음반.',
  },
  heroSubhead: {
    en: 'Rate what you hear. Build a taste profile that actually means something.',
    ko: '음악을 기록하면, 의미 있는 취향 프로필이 됩니다.',
  },
  philosophy: {
    label: { en: 'Who this is for', ko: '이곳은 누구를 위한 곳인가' },
    body: {
      en: "Cinephiles have a word for what they are. Music lovers never did — until now. Mélomane: someone who loves music the way a cinephile loves film — not casually, but as the thing they organize part of their life around. If your friends already ask your opinion before buying a ticket, this is where you keep score.",
      ko: '영화를 사랑하는 사람에게는 씨네필이라는 이름이 있습니다. 음악을 그만큼 사랑하는 사람에게는, 아직 마땅한 이름이 없었죠. 멜로마니아(mélomane)는 씨네필이 영화를 사랑하듯 음악을 사랑하는 사람을 뜻하는 프랑스어입니다. 가볍게 듣고 흘려보내는 게 아니라, 삶의 일부로 삼는 사람들이죠. 친구들이 티켓을 사기 전에 늘 의견을 물어보는 사람이라면, 여기서 그 기록을 남기면 됩니다.',
    },
  },
  mechanics: {
    label: { en: 'How it actually works', ko: '실제로 이렇게 작동합니다' },
    items: [
      {
        heading: { en: 'Rating', ko: '평가' },
        body: {
          en: 'Not a row of stars you tap. Press the flower and drag — the distance is the score, half a star at a time, live color and all.',
          ko: '탭 한 번으로 채우는 별점 줄이 아닙니다. 꽃을 누른 채 끌어당기면 그 거리만큼 점수가 되고, 색이 실시간으로 따라옵니다.',
        },
      },
      {
        heading: { en: 'Discovery', ko: '발견' },
        body: {
          en: "Your taste isn't one genre. We map it into clusters — a k-pop and shoegaze listener gets two, not one blurred average — and score what we recommend against whichever one fits closest.",
          ko: '취향은 하나의 장르로 설명되지 않습니다. 실라주쿠는 이를 여러 클러스터로 나누어 지도를 그립니다. k-pop과 슈게이즈를 함께 듣는 사람은 하나의 흐릿한 평균이 아니라 두 개의 클러스터를 갖게 되고, 추천은 그중 가장 가까운 클러스터를 기준으로 계산됩니다.',
        },
      },
    ],
  },
  liveStat: {
    label: { en: 'Right now', ko: '지금 이 순간' },
    caption: { en: 'ratings logged on sillajuku', ko: '실라주쿠에 기록된 평가' },
    closingLine: { en: 'Every one of them started with a single record.', ko: '그 시작은 늘 한 장의 음반이었습니다.' },
  },
  cta: { en: 'Start listening', ko: '지금 시작하기' },
} as const;
