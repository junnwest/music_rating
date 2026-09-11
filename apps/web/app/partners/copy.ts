/**
 * Bilingual copy for /partners — the corporate/technical counterpart to
 * /about. Kept separate rather than merged into the consumer page: the
 * audience and register are different (credibility/depth vs. identity/
 * warmth), and mixing them undermines both. See app/about/page.tsx for the
 * consumer-facing version.
 *
 * Korean tone pass 2026-09-02: same fix as app/about/copy.ts — 습니다체
 * throughout instead of translated-English em-dash constructions, brand
 * self-reference ("실라주쿠는") instead of "저희".
 *
 * Fact-check pass 2026-09-02: dropped the "Critical-weighted rankings" item
 * — checked against the actual chart RPCs (get_charts_most_rated /
 * get_charts_trending in supabase/migrations/20260706000002_charts_release_
 * type.sql) and it's false; those are a plain Bayesian average and a plain
 * COUNT(*), not a Top-10-submission aggregate. See app/about/copy.ts for the
 * same fix on the consumer page.
 *
 * Fact-check pass 2 2026-09-02: dropped the founding-999 stat (no public
 * numbered program exists in the schema — see app/about/copy.ts for detail)
 * and reworded the audience section from an unverifiable factual claim
 * ("our users are critics/DJs") to a design-intent statement, since there's
 * no user-composition data to back the former as fact on a page meant to be
 * read by investors/partners.
 */

export const PARTNERS_COPY = {
  heroTitle: {
    en: 'The technology and data behind sillajuku.',
    ko: '실라주쿠를 만드는 기술과 데이터.',
  },
  heroSubhead: {
    en: 'Built for Korea first. Japan and Taiwan next.',
    ko: '한국을 시작으로, 다음은 일본과 대만입니다.',
  },
  stats: {
    label: { en: 'Right now', ko: '지금 이 순간' },
    ratingsCaption: { en: 'ratings logged', ko: '기록된 평가' },
  },
  technology: {
    label: { en: 'The technology', ko: '기술' },
    items: [
      {
        heading: { en: 'Perceptually-uniform scoring', ko: '지각적으로 균일한 점수 체계' },
        body: {
          en: 'Every score maps to color through an OKLCh ramp tuned for equal perceived brightness at every point — not the blown-out yellows and muddy blues of a typical HSL hue sweep.',
          ko: '모든 점수는 OKLCh 색공간 기반 램프를 통해 색으로 변환됩니다. 지점마다 지각 밝기가 동일하도록 조정되어 있어, 일반적인 HSL 색상 스윕에서 흔한 노랑 번짐이나 탁한 파랑이 없습니다.',
        },
      },
      {
        heading: { en: 'Multi-modal taste modeling', ko: '다중 취향 클러스터링' },
        body: {
          en: "We don't collapse a listener into one mean genre vector. Ratings cluster into distinct taste worlds — a k-pop and shoegaze listener gets two clusters, not one blurred average — and recommendations score against the nearest one.",
          ko: '청취자를 하나의 평균 장르 벡터로 뭉뚱그리지 않습니다. 평점은 서로 다른 취향 클러스터로 나뉘어, k-pop과 슈게이즈를 함께 듣는 사람은 하나의 흐릿한 평균이 아니라 두 개의 클러스터를 갖게 됩니다. 추천은 그중 가장 가까운 클러스터를 기준으로 계산됩니다.',
        },
      },
      {
        heading: { en: 'Bilingual from the ground up', ko: '처음부터 이중언어' },
        body: {
          en: 'Every surface — including this one — ships in Korean and English, with interface language and content language decoupled: a Latin artist name stays Latin in Korean mode unless the native title is genuinely Hangul.',
          ko: '이 페이지를 포함한 모든 화면이 한국어와 영어로 제공됩니다. 인터페이스 언어와 콘텐츠 언어는 분리되어 있어, 아티스트명이 실제로 한글 표기일 때만 한글로 표시되고 그렇지 않으면 한국어 모드에서도 로마자 그대로 유지됩니다.',
        },
      },
    ],
  },
  audience: {
    label: { en: 'Who\'s already here', ko: '이미 여기 있는 사람들' },
    body: {
      en: "sillajuku isn't designed to chase volume. It's built for the people whose taste the people around them already defer to — critics, DJs, the friend everyone asks before buying a ticket. Small, dense, high-signal by design — not a mass audience, a taste-leading one.",
      ko: '실라주쿠는 양을 좇도록 설계되지 않았습니다. 주변 사람들이 이미 그 취향을 신뢰하는 사람들을 위해 만들어졌습니다. 평론가, DJ, 티켓을 사기 전에 다들 먼저 의견을 물어보는 친구 같은 사람들 말이죠. 대중이 아니라, 취향을 이끄는 소수를 위한 설계입니다.',
    },
  },
  contact: {
    heading: { en: 'Get in touch', ko: '문의하기' },
    body: {
      en: 'Press, partnerships, data licensing, or anything else — reach out directly.',
      ko: '언론, 파트너십, 데이터 라이선스, 그 밖의 문의는 아래로 직접 연락해 주세요.',
    },
    email: 'admin@sillajuku.com',
    button: { en: 'Email us', ko: '이메일 보내기' },
  },
} as const;
