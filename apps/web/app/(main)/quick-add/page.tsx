'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Compass, ExternalLink, Heart } from 'lucide-react';
import Cover from '../../../components/sj/Cover';
import CandidateRow from '../../../components/sj/CandidateRow';
import FlowerRateControl from '../../../components/sj/FlowerRateControl';
import AlbumBookmarkButton from '../../../components/sj/AlbumBookmarkButton';
import AlbumOverflowMenu, { NotInterestedButton } from '../../../components/sj/AlbumOverflowMenu';
import AlbumPeek from '../../../components/sj/AlbumPeek';
import FlowerGlyph from '../../../components/sj/FlowerGlyph';
import { useContextMenu, openInNewTab } from '../../../components/sj/ContextMenu';
import ManualRateModal from '../../../components/sj/ManualRateModal';
import Modal from '../../../components/sj/Modal';
import { Skeleton, SkeletonLine, SkeletonRows } from '../../../components/sj/Loading';
import { useSession } from '../../../components/sj/SessionContext';
import { useRatings } from '../../../components/sj/RatingsStore';
import { supabase } from '../../../lib/supabaseClient';
import { useLanguage } from '../../../lib/i18n';
import { displayName } from '../../../lib/sj/display';
import { fetchNotInterestedIds } from '../../../lib/sj/notInterested';
import type { SJRelease } from '../../../lib/sj/data';

const ROW_SIZE = 12; // candidates fetched per shelf
const GRID_PAGE = 24; // candidates per "See more" page
const SEED_PAGE = 4; // artist shelves revealed at a time
const SONG_PAGE = 20;

type Mode = 'albums' | 'songs';

/**
 * The genres offered by "Explore other genres". Slugs are matched by
 * `_rg_primary_matches` (primary_genre first, raw genres array as fallback),
 * the same predicate the charts genre filter uses — so anything that works as a
 * chart filter works here. Deliberately a short, recognisable list rather than
 * the full 30-category taxonomy: this is a browse affordance, not a directory.
 */
const GENRES: string[] = [
  'K-Pop',
  'K-Indie',
  'Hip Hop',
  'R&B',
  'Rock',
  'Pop',
  'Indie',
  'Electronic',
  'Jazz',
  'Metal',
  'Classical',
  'Folk',
  'Soul',
  'Punk',
  'City Pop',
  'J-Pop',
];

interface AlbumCandidate {
  id: string;
  title: string;
  artist_display: string;
  cover_url: string | null;
  native_title: string | null;
  release_group_type: string | null;
}

interface SongCandidate {
  id: string; // recording id
  title: string;
  artist_display: string;
  cover_url: string | null;
  album_title: string;
}

/** One shelf: a seed artist or a genre, plus its own paging state. */
interface Shelf {
  key: string;
  kind: 'artist' | 'genre';
  /** Artist name or genre slug — whatever the RPC is keyed on. */
  seed: string;
  items: AlbumCandidate[];
  done: boolean;
}

/** A precise-rating target handed to ManualRateModal (drag = quick; tap = precise). */
type Target =
  | { kind: 'album'; release: SJRelease }
  | { kind: 'song'; recordingId: string; title: string; release: SJRelease };

/**
 * Quick Add — the web counterpart of iOS's QuickAddView. Its whole purpose is
 * albums (and songs) the user has *probably already heard* — seeded from their
 * Spotify top/recent artists and their own highly-rated artists — so they can
 * rate fast from memory. Rate by dragging the flower; tap it for the precise
 * slider.
 *
 * Albums are grouped into horizontal shelves, one per seed artist, instead of
 * one flat list: a flat prestige-ordered feed buries every artist after the
 * first behind a scroll, and "do I remember this record" is a question you
 * answer per artist. Each shelf is its own `get_quick_add_candidates` call with
 * a single-name seed array, so the RPC's existing ordering and its rated /
 * not-interested exclusions apply per shelf with no new SQL.
 *
 * Below the seeded shelves, "Explore other genres" does the opposite job —
 * candidates from genres the user does *not* already listen to, via
 * `get_quick_add_genre_candidates`. Liked genres persist to
 * `profiles.preferred_genres`, the same column the homepage category resolver
 * reads, so a like here also reshapes the home rows.
 */
export default function QuickAddPage() {
  const { t } = useLanguage();
  const { userId, ready, profile } = useSession();
  const { setRating } = useRatings();
  const ratingStep = profile?.manual_rating_step ?? 0.5;

  const [seeds, setSeeds] = useState<string[] | null>(null);
  const [mode, setMode] = useState<Mode>('albums');
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [seedsShown, setSeedsShown] = useState(SEED_PAGE);
  const [songs, setSongs] = useState<SongCandidate[]>([]);
  const [songDone, setSongDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [held, setHeld] = useState<Record<string, number>>({});
  const [target, setTarget] = useState<Target | null>(null);
  const [expanded, setExpanded] = useState<Shelf | null>(null);
  // "Not interested" albums. The RPCs already exclude them, so this only covers
  // the ones dismissed during this session (and any environment where the
  // migration hasn't landed). Filtered at render, never spliced out of a
  // shelf's array, so each shelf's pagination offset stays honest.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Genres explicitly liked (persisted) and genres merely opened this session.
  const [liked, setLiked] = useState<string[]>([]);
  const [opened, setOpened] = useState<string[]>([]);

  useEffect(() => {
    if (!ready || !userId) return;
    let cancelled = false;
    fetchNotInterestedIds(userId).then((ids) => {
      if (!cancelled && ids.size > 0) setDismissed(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, userId]);

  // ── Seed assembly: artists the user very likely knows, in confidence order ──
  useEffect(() => {
    if (!ready || !supabase) return;
    if (!userId) {
      setSeeds([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const [{ data: prof }, { data: ratedRows }] = await Promise.all([
        supabase!
          .from('profiles')
          .select('spotify_artists, spotify_recently_played, preferred_genres')
          .eq('id', userId)
          .maybeSingle(),
        supabase!
          .from('ratings')
          .select('score, release_groups(artist_display)')
          .eq('user_id', userId)
          .gte('score', 3.5)
          .order('score', { ascending: false })
          .limit(150),
      ]);
      if (cancelled) return;

      const ordered: string[] = [];
      const seen = new Set<string>();
      const add = (name?: string | null) => {
        const n = (name ?? '').trim();
        if (!n || seen.has(n)) return;
        seen.add(n);
        ordered.push(n);
      };
      const p = prof as {
        spotify_artists: { name?: string }[] | null;
        spotify_recently_played: { artistName?: string }[] | null;
        preferred_genres: string | null;
      } | null;
      for (const a of p?.spotify_artists ?? []) add(a.name);
      for (const a of p?.spotify_recently_played ?? []) add(a.artistName);
      for (const r of (ratedRows as { release_groups?: { artist_display?: string } }[] | null) ?? []) {
        add(r.release_groups?.artist_display);
      }
      // Only genres this picker knows about — the column is shared with
      // onboarding, which used a different (older) label set.
      setLiked(
        (p?.preferred_genres ?? '')
          .split(',')
          .map((g) => g.trim())
          .filter((g) => GENRES.includes(g)),
      );
      setSeeds(ordered);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, userId]);

  /** One page of a shelf. `kind` picks the RPC; the columns are identical. */
  const fetchShelf = useCallback(
    async (kind: 'artist' | 'genre', seed: string, offset: number, limit = ROW_SIZE) => {
      if (!supabase || !userId) return [] as AlbumCandidate[];
      const { data, error } =
        kind === 'artist'
          ? await supabase.rpc('get_quick_add_candidates', {
              p_user_id: userId,
              p_artist_names: [seed],
              p_lim: limit,
              p_offset: offset,
            })
          : await supabase.rpc('get_quick_add_genre_candidates', {
              p_user_id: userId,
              p_genre: seed,
              p_lim: limit,
              p_offset: offset,
            });
      if (error) {
        console.warn('[quick-add] shelf fetch failed', kind, seed, error);
        return [] as AlbumCandidate[];
      }
      return (data as AlbumCandidate[] | null) ?? [];
    },
    [userId],
  );

  const fetchSongs = useCallback(
    async (offset: number): Promise<SongCandidate[]> => {
      if (!supabase || !userId || !seeds || seeds.length === 0) return [];
      const { data } = await supabase.rpc('get_quick_add_song_candidates', {
        p_user_id: userId,
        p_artist_names: seeds,
        p_lim: SONG_PAGE,
        p_offset: offset,
      });
      return (data as SongCandidate[] | null) ?? [];
    },
    [userId, seeds],
  );

  /** The shelves that should exist right now, in render order. */
  const wanted = useMemo(() => {
    const list: { key: string; kind: 'artist' | 'genre'; seed: string }[] = [];
    for (const a of (seeds ?? []).slice(0, seedsShown)) {
      list.push({ key: `a:${a}`, kind: 'artist', seed: a });
    }
    // Liked genres are permanent shelves; opened ones last for the session.
    for (const g of [...liked, ...opened.filter((g) => !liked.includes(g))]) {
      list.push({ key: `g:${g}`, kind: 'genre', seed: g });
    }
    return list;
  }, [seeds, seedsShown, liked, opened]);

  // Fetch any shelf that's newly wanted, and drop any that no longer is. Each
  // shelf resolves independently — a slow artist never blocks the rest.
  useEffect(() => {
    if (seeds === null) return;
    let cancelled = false;
    const have = new Set(shelves.map((s) => s.key));
    const missing = wanted.filter((w) => !have.has(w.key));
    const wantedKeys = new Set(wanted.map((w) => w.key));
    if (shelves.some((s) => !wantedKeys.has(s.key))) {
      setShelves((prev) => prev.filter((s) => wantedKeys.has(s.key)));
    }
    if (missing.length === 0) {
      setLoading(false);
      return;
    }
    (async () => {
      const loaded = await Promise.all(
        missing.map(async (w) => ({
          ...w,
          items: await fetchShelf(w.kind, w.seed, 0),
        })),
      );
      if (cancelled) return;
      setShelves((prev) => {
        const byKey = new Map(prev.map((s) => [s.key, s]));
        for (const l of loaded) {
          // An empty shelf still gets recorded, so it isn't refetched forever;
          // it's filtered out at render.
          byKey.set(l.key, {
            key: l.key,
            kind: l.kind,
            seed: l.seed,
            items: l.items,
            done: l.items.length < ROW_SIZE,
          });
        }
        return wanted.map((w) => byKey.get(w.key)!).filter(Boolean);
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // `shelves` is read but deliberately not a dependency: this effect writes
    // it, and re-running on its own output would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, seeds, fetchShelf]);

  // Songs mode keeps the flat list — a song shelf per artist would be a row of
  // near-identical text rows, and songs are rated in runs, not browsed.
  useEffect(() => {
    if (seeds === null || mode !== 'songs' || songs.length > 0) return;
    let cancelled = false;
    (async () => {
      const s = await fetchSongs(0);
      if (cancelled) return;
      setSongs(s);
      setSongDone(s.length < SONG_PAGE);
    })();
    return () => {
      cancelled = true;
    };
  }, [seeds, mode, songs.length, fetchSongs]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    if (mode === 'albums') {
      if (!seeds || seedsShown >= seeds.length) return;
      setSeedsShown((n) => n + SEED_PAGE);
      return;
    }
    if (songDone) return;
    setLoadingMore(true);
    const next = await fetchSongs(songs.length);
    setSongs((prev) => [...prev, ...next]);
    setSongDone(next.length < SONG_PAGE);
    setLoadingMore(false);
  }, [mode, loadingMore, songDone, songs.length, fetchSongs, seeds, seedsShown]);

  // Infinite scroll
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  // ── Rating writes ──
  // A null score = the gauge was dragged back into the dead zone → void it.
  async function rateAlbum(id: string, score: number | null) {
    if (!userId) return;
    setHeld((h) => {
      const next = { ...h };
      if (score == null) delete next[id];
      else next[id] = score;
      return next;
    });
    // Albums go through the app-wide store (DB upsert/delete + global sync), so
    // rating here shows up on every other surface for the album immediately.
    await setRating(id, score);
  }

  async function rateSong(c: SongCandidate, score: number | null) {
    if (!supabase || !userId) return;
    setHeld((h) => {
      const next = { ...h };
      if (score == null) delete next[c.id];
      else next[c.id] = score;
      return next;
    });
    if (score == null) {
      await supabase
        .from('track_ratings')
        .delete()
        .eq('user_id', userId)
        .eq('recording_id', c.id);
    } else {
      await supabase
        .from('track_ratings')
        .upsert(
          { user_id: userId, recording_id: c.id, score },
          { onConflict: 'user_id,recording_id' },
        );
    }
  }

  async function saveTarget(score: number | null) {
    if (!supabase || !userId || !target || score == null) return;
    if (target.kind === 'album') {
      await rateAlbum(target.release.id, score);
    } else {
      setHeld((h) => ({ ...h, [target.recordingId]: score }));
      await supabase
        .from('track_ratings')
        .upsert(
          { user_id: userId, recording_id: target.recordingId, score },
          { onConflict: 'user_id,recording_id' },
        );
    }
  }

  /** Persisted to the same column onboarding/home read — not a local flag. */
  async function toggleLiked(genre: string) {
    const next = liked.includes(genre) ? liked.filter((g) => g !== genre) : [...liked, genre];
    setLiked(next);
    if (!supabase || !userId) return;
    const { error } = await supabase
      .from('profiles')
      .update({ preferred_genres: next.join(', ') })
      .eq('id', userId);
    if (error) {
      console.warn('[quick-add] saving liked genres failed', error);
      setLiked(liked); // roll back rather than lie about what's persisted
    }
  }

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => new Set(prev).add(id));
  }, []);

  const openRateTarget = useCallback((tg: Target) => setTarget(tg), []);

  const preciseAlbum = useCallback(
    (c: AlbumCandidate) => {
      openRateTarget({
        kind: 'album',
        release: {
          id: c.id,
          title: c.title,
          artist: c.artist_display,
          coverUrl: c.cover_url,
          releaseType: c.release_group_type,
          releaseDate: null,
          titleNative: c.native_title,
          artistNative: null,
        },
      });
    },
    [openRateTarget],
  );

  const visibleShelves = shelves
    .map((s) => ({ ...s, items: s.items.filter((i) => !dismissed.has(i.id)) }))
    .filter((s) => s.items.length > 0);
  const moreSeeds = mode === 'albums' && !!seeds && seedsShown < seeds.length;

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-6 py-6">
      <header className="mb-5">
        <h1 className="text-[22px] font-black text-ink">{t('sj.quickAdd.title')}</h1>
        <p className="mt-1 text-[13px] text-muted">{t('sj.quickAdd.subtitle')}</p>
      </header>

      {/* Albums / Songs toggle */}
      <div className="flex items-center gap-6 border-b border-divider">
        {(['albums', 'songs'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`pb-2.5 -mb-px border-b-2 text-[15px] transition ${
              mode === m
                ? 'border-accent text-ink font-bold'
                : 'border-transparent text-muted font-medium hover:text-ink'
            }`}
          >
            {t(m === 'albums' ? 'sj.quickAdd.albums' : 'sj.quickAdd.songs')}
          </button>
        ))}
      </div>

      {loading ? (
        <ShelfSkeleton />
      ) : mode === 'songs' ? (
        songs.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <ul className="mt-2 divide-y divide-divider">
              {songs.map((c) => (
                <SongRow
                  key={c.id}
                  candidate={c}
                  held={held[c.id]}
                  ratingStep={ratingStep}
                  onRate={(score) => rateSong(c, score)}
                  onPrecise={() =>
                    openRateTarget({
                      kind: 'song',
                      recordingId: c.id,
                      title: c.title,
                      release: {
                        id: c.id,
                        title: c.album_title,
                        artist: c.artist_display,
                        coverUrl: c.cover_url,
                        releaseType: null,
                        releaseDate: null,
                        titleNative: null,
                        artistNative: null,
                      },
                    })
                  }
                />
              ))}
            </ul>
            {!songDone && <div ref={sentinelRef} className="h-10" />}
            {loadingMore && <SkeletonRows className="py-4" count={2} />}
          </>
        )
      ) : seeds && seeds.length === 0 && liked.length === 0 && opened.length === 0 ? (
        <>
          <p className="py-10 text-center text-[13.5px] text-muted">
            {t('sj.quickAdd.needSeed')}
          </p>
          <GenreExplorer
            liked={liked}
            opened={opened}
            onToggleOpen={(g) =>
              setOpened((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]))
            }
            onToggleLiked={toggleLiked}
          />
        </>
      ) : (
        <>
          {visibleShelves.length === 0 && !moreSeeds && <EmptyState />}

          {visibleShelves.map((shelf) => (
            <CandidateRow
              key={shelf.key}
              title={shelf.seed}
              subtitle={
                shelf.kind === 'genre' ? t('sj.quickAdd.genreShelf') : undefined
              }
              onSeeMore={() => setExpanded(shelf)}
            >
              {shelf.items.map((c) => (
                <CandidateCard
                  key={c.id}
                  candidate={c}
                  held={held[c.id]}
                  ratingStep={ratingStep}
                  onRate={(score) => rateAlbum(c.id, score)}
                  onPrecise={() => preciseAlbum(c)}
                  onNotInterested={() => dismiss(c.id)}
                />
              ))}
            </CandidateRow>
          ))}

          {moreSeeds && <div ref={sentinelRef} className="h-10" />}

          <GenreExplorer
            liked={liked}
            opened={opened}
            onToggleOpen={(g) =>
              setOpened((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]))
            }
            onToggleLiked={toggleLiked}
          />
        </>
      )}

      {expanded && (
        <SeeMoreModal
          shelf={expanded}
          onClose={() => setExpanded(null)}
          fetchPage={(offset) => fetchShelf(expanded.kind, expanded.seed, offset, GRID_PAGE)}
          dismissed={dismissed}
          held={held}
          ratingStep={ratingStep}
          onRate={rateAlbum}
          onPrecise={preciseAlbum}
          onNotInterested={dismiss}
        />
      )}

      {target && (
        <ManualRateModal
          open
          onClose={() => setTarget(null)}
          release={target.release}
          track={target.kind === 'song' ? { recordingId: target.recordingId, title: target.title } : null}
          existingScore={null}
          onSave={saveTarget}
        />
      )}
    </div>
  );
}

// ── Explore other genres ────────────────────────────────────────────────────

/**
 * The genre chips. One chip carries two independent actions: tapping the label
 * *opens* a shelf (a look), tapping the heart *likes* the genre (a preference
 * that persists and follows you to the home rows). Keeping them separate means
 * browsing jazz once doesn't claim you like jazz.
 */
function GenreExplorer({
  liked,
  opened,
  onToggleOpen,
  onToggleLiked,
}: {
  liked: string[];
  opened: string[];
  onToggleOpen: (g: string) => void;
  onToggleLiked: (g: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <section className="mt-8 rounded-2xl border border-divider/70 bg-surface/40 p-4">
      <div className="flex items-center gap-2">
        <Compass size={15} className="text-accent" />
        <h2 className="text-[14.5px] font-bold text-ink">{t('sj.quickAdd.exploreGenres')}</h2>
      </div>
      <p className="mt-1 text-[12.5px] text-muted">{t('sj.quickAdd.exploreGenresDesc')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {GENRES.map((g) => {
          const isOpen = opened.includes(g) || liked.includes(g);
          const isLiked = liked.includes(g);
          return (
            <span
              key={g}
              className={`inline-flex items-center rounded-full border transition ${
                isOpen ? 'border-accent/50 bg-accent/10' : 'border-divider bg-page'
              }`}
            >
              <button
                onClick={() => onToggleOpen(g)}
                aria-pressed={isOpen}
                className={`pl-3 pr-1.5 py-1.5 text-[12.5px] font-medium rounded-l-full transition ${
                  isOpen ? 'text-accent' : 'text-muted hover:text-ink'
                }`}
              >
                {g}
              </button>
              <button
                onClick={() => onToggleLiked(g)}
                aria-pressed={isLiked}
                aria-label={`${t(isLiked ? 'sj.quickAdd.unlikeGenre' : 'sj.quickAdd.likeGenre')}: ${g}`}
                title={t(isLiked ? 'sj.quickAdd.unlikeGenre' : 'sj.quickAdd.likeGenre')}
                className="pr-2.5 pl-1 py-1.5 rounded-r-full text-muted hover:text-accent transition"
              >
                <Heart
                  size={13}
                  className={isLiked ? 'text-accent fill-accent' : ''}
                />
              </button>
            </span>
          );
        })}
      </div>
    </section>
  );
}

// ── "See more" ──────────────────────────────────────────────────────────────

/**
 * The full list behind a shelf. It keeps its own copy of the items and its own
 * offset rather than growing the shelf's array: the shelf is a preview, and a
 * user who pages 100 albums deep in the modal shouldn't leave a 100-card
 * horizontal scroller behind on the page.
 */
function SeeMoreModal({
  shelf,
  onClose,
  fetchPage,
  dismissed,
  held,
  ratingStep = 0.5,
  onRate,
  onPrecise,
  onNotInterested,
}: {
  shelf: Shelf;
  onClose: () => void;
  fetchPage: (offset: number) => Promise<AlbumCandidate[]>;
  dismissed: Set<string>;
  held: Record<string, number>;
  ratingStep?: number;
  onRate: (id: string, score: number | null) => void;
  onPrecise: (c: AlbumCandidate) => void;
  onNotInterested: (id: string) => void;
}) {
  const { t } = useLanguage();
  const [items, setItems] = useState<AlbumCandidate[]>([]);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    fetchPage(0).then((first) => {
      if (cancelled) return;
      setItems(first);
      setDone(first.length < GRID_PAGE);
      setBusy(false);
    });
    return () => {
      cancelled = true;
    };
    // One fetch per opened shelf; `fetchPage` closes over that shelf.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelf.key]);

  async function more() {
    if (busy || done) return;
    setBusy(true);
    const next = await fetchPage(items.length);
    setItems((prev) => [...prev, ...next]);
    setDone(next.length < GRID_PAGE);
    setBusy(false);
  }

  const visible = items.filter((i) => !dismissed.has(i.id));

  return (
    <Modal open onClose={onClose} title={shelf.seed} maxWidth="max-w-3xl">
      <div className="px-5 pb-5 max-h-[70vh] overflow-y-auto">
        {busy && items.length === 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-square w-full rounded-xl bg-surface" />
                <SkeletonLine w="w-3/4" />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="py-14 text-center text-[13.5px] text-muted">{t('sj.quickAdd.empty')}</p>
        ) : (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {visible.map((c) => (
                <CandidateCard
                  key={c.id}
                  candidate={c}
                  held={held[c.id]}
                  fluid
                  ratingStep={ratingStep}
                  onRate={(score) => onRate(c.id, score)}
                  onPrecise={() => onPrecise(c)}
                  onNotInterested={() => onNotInterested(c.id)}
                />
              ))}
            </div>
            {!done && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={more}
                  disabled={busy}
                  className="px-4 py-2 rounded-full bg-surface border border-divider text-[13px] font-semibold text-ink hover:bg-divider/30 disabled:opacity-50 transition"
                >
                  {t(busy ? 'sj.common.loading' : 'sj.quickAdd.loadMore')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Cards & rows ────────────────────────────────────────────────────────────

/**
 * One album candidate. `fluid` fills its grid cell (the See-more modal); the
 * default is a fixed width so a shelf's cards line up regardless of how many
 * there are.
 */
function CandidateCard({
  candidate: c,
  held,
  fluid,
  ratingStep = 0.5,
  onRate,
  onPrecise,
  onNotInterested,
}: {
  candidate: AlbumCandidate;
  held?: number;
  fluid?: boolean;
  ratingStep?: number;
  onRate: (score: number | null) => void;
  onPrecise: () => void;
  onNotInterested: () => void;
}) {
  const title = displayName(c.title, c.native_title);
  return (
    <div className={fluid ? 'min-w-0' : 'w-[132px] sm:w-[148px] shrink-0 snap-start'}>
      <AlbumPeek
        releaseId={c.id}
        title={title}
        artist={c.artist_display}
        coverUrl={c.cover_url}
        onNotInterested={onNotInterested}
        className="relative block group"
      >
        <Cover url={c.cover_url} className="w-full aspect-square" rounded="rounded-xl" />
        <AlbumBookmarkButton
          releaseGroupId={c.id}
          size={24}
          className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition"
        />
        <AlbumOverflowMenu
          releaseGroupId={c.id}
          onNotInterested={onNotInterested}
          size={24}
          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition"
        />
        {/* One-tap dismissal — this page exists to teach the algorithm, so the
            negative signal is as reachable as the rate gauge. */}
        <NotInterestedButton
          releaseGroupId={c.id}
          onNotInterested={onNotInterested}
          size={24}
          className="absolute bottom-1.5 left-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition"
        />
        {/* The rate gauge is always visible — it's the point of the page, not a
            hover affordance. */}
        <FlowerRateControl
          ariaLabel={`Rate ${title}`}
          onRate={onRate}
          onRequestPrecise={onPrecise}
          currentScore={held ?? null}
          size={30}
          className="absolute bottom-1.5 right-1.5"
          ratingStep={ratingStep}
        />
      </AlbumPeek>
      <p className="mt-1.5 text-[12.5px] font-semibold text-ink truncate">{title}</p>
      <p className="text-[11.5px] text-muted truncate">{c.artist_display}</p>
    </div>
  );
}

function SongRow({
  candidate: c,
  held,
  ratingStep = 0.5,
  onRate,
  onPrecise,
}: {
  candidate: SongCandidate;
  held?: number;
  ratingStep?: number;
  onRate: (score: number | null) => void;
  onPrecise: () => void;
}) {
  const { t } = useLanguage();
  // Song rows get the same right-click affordance albums have via AlbumPeek.
  const { onContextMenu, menu } = useContextMenu([
    {
      key: 'open-new-tab',
      label: t('sj.context.openNewTab'),
      icon: <ExternalLink size={15} />,
      onSelect: () => openInNewTab(`/song/${c.id}`),
    },
    {
      key: 'rate',
      label: t('sj.context.rate'),
      icon: <FlowerGlyph size={14} src="/icon-flower.svg" />,
      onSelect: onPrecise,
    },
  ]);
  return (
    <li className="flex items-center gap-3 py-2.5" onContextMenu={onContextMenu}>
      {menu}
      <span className="relative shrink-0">
        <Cover url={c.cover_url} className="w-[52px] h-[52px]" rounded="rounded-lg" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-ink truncate">{c.title}</p>
        <p className="text-[12.5px] text-muted truncate">
          {c.album_title} · {c.artist_display}
        </p>
      </div>
      <FlowerRateControl
        ariaLabel={`Rate ${c.title}`}
        onRate={onRate}
        onRequestPrecise={onPrecise}
        currentScore={held ?? null}
        size={34}
        className="shrink-0"
        ratingStep={ratingStep}
      />
    </li>
  );
}

function ShelfSkeleton() {
  return (
    <div aria-hidden>
      {Array.from({ length: 2 }, (_, r) => (
        <div key={r} className="mt-5">
          <SkeletonLine w="w-32" h="h-4" />
          <div className="mt-3 flex gap-3 overflow-hidden">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="w-[132px] sm:w-[148px] shrink-0 space-y-2">
                <Skeleton className="aspect-square w-full rounded-xl bg-surface" />
                <SkeletonLine w="w-3/4" />
                <SkeletonLine w="w-1/2" h="h-2.5" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  const { t } = useLanguage();
  return (
    <div className="py-20 flex flex-col items-center gap-3 text-center">
      <CheckCircle2 size={40} className="text-divider" />
      <p className="text-[15px] font-semibold text-ink">{t('sj.quickAdd.empty')}</p>
      <p className="text-[13px] text-muted max-w-xs">{t('sj.quickAdd.emptyDesc')}</p>
    </div>
  );
}
