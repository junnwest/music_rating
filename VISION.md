# sillajuku — Strategic Vision

---

## Product

Music rating app for Korean listeners who take their listening seriously.

The name comes from *sillage* and *juke*. Just as a perfume becomes something uniquely yours the moment it meets your skin, your music taste is a scent only you carry — a quiet, powerful expression of identity.

Core insight: mass trend culture in Korea creates a counter-current of people who actively cultivate personal taste. sillajuku is built for that counter-current.

Web app live at sillajuku.com. iOS app in development as a native Swift/SwiftUI app (`apps/ios/`). Launch target: mid-2026.

### What it does

- **Rate and review albums** — 0.5–5 star scale, comments with visibility control (public / friends / private), likes
- **Profile as identity** — ratings grid, score distribution, Essentials (6 defining albums), Taste DNA badges, genre breakdown
- **Social layer** — follow friends, activity feed, see what people you follow are hearing in real time
- **Taste Collisions** — albums where you and a friend rated wildly differently
- **Taste Contradictions** — your score vs. the community average; the albums you loved that nobody else did, and vice versa
- **Community Rankings** — vote on leaderboards (Greatest Album of All Time, Best K-Hip-Hop, etc.); seeded baseline so rankings are meaningful from day one
- **Listen Later** — frictionless save queue
- **Yearly Wrapped** — annual summary: albums rated, top genre, highest/lowest scores, most active month

---

## The Problem

Korean mass culture moves in waves, and those waves hit everywhere — not just what trends online, but what plays in cafés, what dominates playlists, what everyone around you is listening to. The pull toward whatever is current is constant and often invisible.

But there is a growing counter-current: people who recognise this, resist it, and place real value on cultivating a taste that is genuinely their own. These are the listeners sillajuku is built for.

The global appetite for Korean music has never been higher. But the tools for engaging with it seriously still lag far behind. Streaming platforms are great for listening, not for reflecting. You cannot see what your friends actually think of an album, you cannot compare tastes meaningfully, and there is no way to build a lasting record of your listening history.

---

## Why Now

The K-wave is a cultural moment, not a trend. Korean music's global reach continues to expand, and a generation of listeners is maturing alongside it — listeners who have grown up with opinions, who want to document and compare their taste, and who have no dedicated platform to do it on. sillajuku is being built at exactly the right moment to become the infrastructure for this community.

---

## Market

Korea's music streaming base is 15–20M MAU. The subset who engage critically — people who have opinions, not just listening habits — is estimated at 10–15%, or roughly 1.5–3M. Of those, the subset motivated to actually maintain a rating profile is smaller still.

- Realistic MAU ceiling in Korea: **300K–600K** at maturity; passionate core of 50K–100K
- Comparable acquisition target: **₩20–50B (~$15–37M USD)** at 300K+ engaged users
- With pan-Asian expansion: **3–8M MAU** ceiling, acquisition range ₩150–500B
- With taste graph licensing added: up to **₩300B–1T+**

A focused Korean community of 200–500K engaged users is a legitimate acquisition target on its own. Likely buyers: Kakao Entertainment, Melon, Weverse. The pan-Asia and global upside is real but not needed to justify the first exit. This is a valid strategic outcome worth designing toward, not a fallback.

---

## Competitive Landscape

**RateYourMusic** is the most feature-complete music rating platform globally. It is text-heavy, intimidating to new users, skews heavily Western in both catalog and community, and feels dated. There is no meaningful social layer.

**Watchapedia** is the closest structural analog in Korea — a social rating platform with strong domestic adoption. It covers film and drama only. No music equivalent exists in the Korean market.

**Streaming platforms** (Melon, Spotify, Apple Music) are optimised for listening, not reflection or community opinion. They offer no way to express, compare, or build on taste.

**sillajuku's position:** the only product that combines Watchapedia-style social rating with a catalog and community built specifically around Korean music. That gap is the entire opportunity.

| | sillajuku | RateYourMusic | Melon / Bugs | Watchapedia |
|---|---|---|---|---|
| Korean catalog depth | ✓ native | weak | strong | film only |
| Social / community layer | ✓ | minimal | minimal | ✓ |
| Taste profile / identity | ✓ | basic | none | basic |
| Design quality | ✓ | poor | dated | decent |
| Mobile app | in dev | poor | ✓ | ✓ |
| Target audience | taste-forward | Western enthusiasts | mass market | film fans |

---

## Expansion Strategy

**Korea → pan-Asia → global.**

Korea first to establish brand identity and community density. Pan-Asia (Japan, Taiwan, diaspora communities) is the natural second ring — shared appreciation for Korean music, adjacent taste communities, and a bridge to Western audiences. Going straight global risks diluting the brand before it's earned the positioning.

Pan-Asia is not a ceiling. It's a launchpad.

---

## Go-to-Market

**Phase 1 — Open launch, Instagram-first**

The app launches open to the public. Primary acquisition channel is Instagram, with editorial content modeled on references like Glow Magazine — card news, magazine-style layouts, album-focused articles. The brand should feel like something people with good taste follow, not a product announcement feed. Consistency and visual discipline are the execution priority.

A well-curated public sillajuku profile should itself be worth sharing. The community is a marketing surface.

**Phase 2 — Creator outreach**

Once a baseline MAU is established, outreach to Korean music creators — YouTubers, reviewers, playlist curators — who already have the audience sillajuku is targeting. The pitch at that point is simple: here is a platform your audience already wants to exist.

---

## Marketing & Brand

Core brand positioning: **sillajuku is what people with good taste use.**

Not gatekeeping — but the kind of signal that certain things carry. The goal is for someone to encounter a friend's sillajuku profile, or a card on Instagram, and feel: *I want to be someone who uses this.* The product's aesthetic and the brand's aesthetic should reinforce each other.

Social media content stays editorial. No programmatic display ads on the product itself — when advertising becomes relevant, the format should be native: sponsored rankings, curated editorial, brand-aligned content. Banner ads are incompatible with the positioning.

- Instagram: editorial and brand-deal-based, not paid placements. Quality over frequency.
- The community itself is a marketing surface. Design every shareable moment intentionally.
- Keep the brand tight before scaling reach. Identity first, distribution second.

---

## Monetization

Not a current priority. Focus is entirely on user growth and brand equity.

**Infrastructure cost vs. ad revenue (conservative estimates: $0.75 RPM, 25% ad block rate)**

| MAU | Monthly infra cost | Ad revenue | Net |
|---|---|---|---|
| 10,000 | $200 | $170 | -$30 |
| 50,000 | $1,000 | $840 | -$160 |
| 200,000 | $4,000 | $3,375 | -$625 |

At conservative estimates, a small net loss persists even with ads running. The gap is manageable. The priority is reaching the MAU threshold where monetization options are meaningful.

**Revenue paths in order of brand compatibility:**

1. **Label and brand partnerships** — sponsored rankings, curated editorial, early release features. Korean labels (HYBE, SM, YG, Kakao Entertainment) spend real money on fan engagement. The entry point is independent labels and music media who move faster and build credibility before approaching the majors. Realistic once MAU exceeds 50K.
2. **Premium subscription** — ₩3,000–5,000/month for enhanced analytics, ad-free experience, deeper profile features. 5–10% conversion on engaged users is a realistic target.
3. **Taste graph data licensing** — longer-term, as the dataset matures. Requires scale and legal groundwork.
4. **Acquisition** — a focused, engaged Korean music community is strategically valuable to the right buyer.

---

## Data & Taste Graph

What sillajuku quietly builds as users rate albums is something streaming platforms are structurally bad at creating: a high-quality, human-curated taste graph. Not algorithmic signals — actual opinions, expressed with friction, by people who care.

PostHog captures behavioral analytics. The Supabase ratings table is the real asset.

Key signals captured per rating:
- Score, status (Listened / ReListening / WantToListen), personal note
- Listening sequence (via `created_at` — preserved across edits)
- Early adopter timing (`ratings.created_at` vs `releases.release_date`)
- Genre and artist clustering (via `releases.genres`, `artists.genres`)
- Revision history — `updated_at` + `rating_history` table + Postgres trigger, in place from launch

This data layer has long-term commercial value: licensing taste signals to streaming platforms, partnering with labels for targeted early release promotion, white-labeling community infrastructure to music publications. The schema is designed with this in mind from day one.

**Demographic metadata gap:** No country, age, or gender is currently collected. PostHog captures IP-derived country at the session level but it's not tied to the Supabase user record. To answer questions like "70% of users are Korean, 18–28" for label pitches or investor decks, options are:
- Add a country field to the onboarding flow (one migration, one extra step) — do this before launch since it can't be backfilled retroactively
- Age range and gender are optional and more friction, but worth considering for the data licensing story
- Korean language selection (once i18n ships) will also serve as a soft proxy for Korean users

---

## Technical

**Stack:** Next.js 14 (App Router, web) · Swift/SwiftUI (native iOS) · Supabase (auth + Postgres, Seoul region) · Spotify API · Tailwind CSS · PostHog

**Spotify dependency** is metadata only — not content streaming. Risk is real but manageable. Every album passing through the platform gets stored locally in Supabase, reducing dependency over time. MusicBrainz and Last.fm serve as fallback layers. Reduce Spotify dependency before due diligence becomes relevant.

**Supabase latency** for Western users (~180–220ms round-trip from Seoul region) is a non-issue while Korea-focused. Address with read replicas when Western expansion becomes real.

**Taste graph schema** is designed from day one with future analysis in mind. See Data section above.

---

## Current Status

| Milestone | Status |
|---|---|
| Core product (rating, profile, social, rankings) | ✓ done |
| Auth (email, Google, Spotify OAuth, password reset) | ✓ done |
| Dark mode | ✓ done |
| Transactional email (Resend + Supabase SMTP) | ✓ done |
| Security hardening (auth guards, headers, image allowlist) | ✓ done |
| Brand identity (amber accent, flower mark, copy voice) | ✓ done |
| DB indexes + full-text search | ✓ done |
| Rating history schema | ✓ done |
| Rate limiting (Upstash Redis) | in progress |
| Korean i18n (next-intl) | in progress |
| Native iOS (Swift/SwiftUI) build | in progress |
| App Store / Play Store submission | in active review (build 14 pending, submission `16d56cd0`) — rejected 3x so far (Sign in with Apple UX, Apple Music permission flow, Age Rating accuracy, then a Sign-in-with-Apple bug on iPad); Play Store not started |
| Pre-launch catalog seeding (Phase 2–4) | in progress |
| Production QA | not started |

---

## Investor / Collaborator Notes

*Develop this section as conversations happen. Questions to think through:*

- What does the ideal early investor look like? (Strategic > financial — someone with Korean media/entertainment network)
- What's the ask, if any? (Bootstrap vs. small angel round to fund App Store fees, marketing, infrastructure)
- Cap table: keep it simple. No unusual dependencies.
- IP: keep it clean. No third-party code that complicates acquisition.
- KakaoTalk login is post-launch (requires 사업자등록); 사업자등록 (개인사업자) is a near-term step regardless — covers tax obligations and unlocks Kakao partnerships
