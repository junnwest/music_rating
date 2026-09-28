# Home feed v4

Web and iOS now consume `/api/feed/home`. The server owns candidate selection,
ranking, ordering, counts, and pagination. The old `/api/feed` stays available
for older web bundles; its old ranking is no longer used by the current clients.

## Explore

Candidate retrieval (`get_home_feed_candidates`) combines recent activity,
written reviews, and the viewer's artists/genres/follows. Author caps apply
before hydration. Only public, active, explicitly human authors qualify; the
viewer's own posts are excluded. Mixes must still be public and visible under
the requesting viewer's RLS.

Normalized score: musical relevance 35%, author relevance 20%, modest text/context
value 15%, freshness 15%, distinct human response 10%, novelty 5%. Freshness has
a 48-hour half-life. Follower count, verification, and the post's star score
do not buy placement. Text value saturates; it is a proxy, not a quality model.

Taste uses the existing genre embeddings and separate taste clusters, canonical
artist IDs, era and scene. The viewer's rating baseline shrinks toward 3 for
small histories. Established/recent profiles mix 80/20; the recent profile needs
five ratings. Low scores do not ban an entire artist. Already-rated albums stay
eligible for discussion. Mix affinity averages a bounded sample of album/song
contexts; repeated albums and large collections do not increase their weight.

Default source proportions are 40% taste / 25% adjacent / 15% social /
10% community / 10% exploration. Adventurousness moves these linearly from
55/15/15/10/5 to 25/35/15/10/15. A smooth weighted scheduler distributes these
slots through each page. Sources overlap, but posts are deduplicated.

The ordering pass uses a rolling 20-post window (including page boundaries):
two posts per author, one rating per album, three posts per artist, no consecutive
author when alternatives exist. It softly favors 55% reviews / 25% mixes /
20% bare ratings. All these constraints relax for sparse supply. It exhausts
unseen candidates before seen posts; ranking never manufactures bot supply.

## Following and pagination

Following remains strictly chronological, only followed accounts, with approved
private-account access. Cursor ordering is `(created_at DESC, kind:id ASC)` so
equal timestamps cannot skip or duplicate entries. Older activity is fetched
on demand. There are no discovery insertions or content-format quotas here.

Explore freezes an ordered list of IDs for 30 minutes in a viewer-owned session.
Pages contain 20 posts. Cached sessions contain IDs/reasons, not post bodies.
Every page rehydrates under the request JWT and rechecks blocks, dismissals,
follows, deletion, deactivation and mix visibility. Revoked items leave gaps;
they never reorder the remaining posts. Responses are private/no-store. Expired
sessions refresh explicitly. Web preserves sessions when switching tabs.

Redis shares sessions across instances; a bounded in-process fallback supports
local development. Losing a fallback instance expires its cursors safely.

## Observation and calibration

Authenticated clients report a post after approximately one second of visible
exposure. Browser background tabs and inactive iOS apps do not count. The API
validates session ownership and post membership and derives position/source
itself. Observations are idempotent per viewer/session/post, used for seven-day
repeat suppression, and expire after 30 days via an indexed sweep on new writes.

Engagement uses distinct human participants (excluding the author), bounded
to 0–1. UI counts still count individual comments. This first version deliberately
does not fit impression-normalized response predictions on sparse data. It also
does not claim to attribute later listening/saves to a feed impression yet.
Author affinity uses follows and the viewer's likes within the candidate pool;
cross-user collaborative similarity is a future calibration input.

Initial weights and ratios are configurable hypotheses. Compare save/mix-add
and lasting-follow outcomes, hides, author concentration and repeat exposure
before increasing engagement weight. Following burst grouping and a separate
Highlights mode remain optional product work, not hidden changes to chronology.

## Rollout and checks

Apply `apps/web/supabase/migrations/20260928000002_home_feed.sql` before deploying
the web clients/server. It only adds feed RPCs, indexes and an RLS-protected
impression table. iOS needs a new build to adopt the shared service.

`npm test` covers ordering, quotas, sparse supply, session validation and taste.
`npx tsx --env-file=.env.local scripts/verify-home-feed.ts` exercises the live
anonymous feed, visibility, deterministic pagination and anonymous Following.
Authenticated SQL checks should run in a rolled-back transaction with the
authenticated role and a real viewer claim. An iOS build/device check still
requires Xcode; the Windows host cannot perform it.
