'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Search as SearchIcon, X, Check, ChevronRight, ExternalLink, Plus } from 'lucide-react';
import ArtistLink from '../../../components/sj/ArtistLink';
import FlowerGlyph from '../../../components/sj/FlowerGlyph';
import { useContextMenu, useContextMenuFor, openInNewTab } from '../../../components/sj/ContextMenu';
import Cover from '../../../components/sj/Cover';
import ManualRateModal from '../../../components/sj/ManualRateModal';
import InstinctModal from '../../../components/sj/InstinctModal';
import FlowerRateControl from '../../../components/sj/FlowerRateControl';
import AlbumBookmarkButton from '../../../components/sj/AlbumBookmarkButton';
import AlbumPeek from '../../../components/sj/AlbumPeek';
import { useNavSafeClick } from '../../../components/sj/useNavSafeClick';
import { Skeleton, SkeletonLine } from '../../../components/sj/Loading';
import { useSession } from '../../../components/sj/SessionContext';
import { useRatings } from '../../../components/sj/RatingsStore';
import { supabase } from '../../../lib/supabaseClient';
import { useLanguage } from '../../../lib/i18n';
import { displayName, isPredominantlyHangul, typeLabelKey } from '../../../lib/sj/display';
import { RG_COLS, type SJRelease } from '../../../lib/sj/data';
import type {
  SearchArtistRPC,
  SearchReleaseGroupRPC,
} from '../../../lib/db/types';

interface SongResult {
  id: string;
  title: string;
  artists: string | null;
  release: SJRelease;
}

/**
 * Search + discovery — web sibling of the iOS "Add" tab. With a query:
 * artists / albums / songs results with one-click quick-rate. Without:
 * discovery sections (From Your Taste, For You, Popular, Trending).
 */
export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageInner />
    </Suspense>
  );
}

function SearchPageInner() {
  const { t } = useLanguage();
  const { userId, profile } = useSession();
  const { setRating } = useRatings();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [searching, setSearching] = useState(false);
  const [artists, setArtists] = useState<SearchArtistRPC[]>([]);
  const [albums, setAlbums] = useState<SJRelease[]>([]);
  const [songs, setSongs] = useState<SongResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const runSeqRef = useRef(0);

  // Quick-rate state
  const [ratedIds, setRatedIds] = useState<Set<string>>(new Set());
  const [sessionRatedIds, setSessionRatedIds] = useState<Set<string>>(new Set());
  const [manualTarget, setManualTarget] = useState<SJRelease | null>(null);
  const [instinctTarget, setInstinctTarget] = useState<SJRelease | null>(null);

  const ratingMode = profile?.rating_mode ?? 'manual';
  const ratingStep = profile?.manual_rating_step ?? 0.5;
  // Instinct mode has no drag-to-score: unrated covers show a plus that opens
  // the pairwise sheet instead of the flower. Reactive to the session profile.
  const isInstinct = ratingMode === 'instinct';
  const hasQuery = query.trim().length > 0;

  // Already-rated release ids (hide their add buttons / discovery entries)
  useEffect(() => {
    if (!supabase || !userId) return;
    supabase
      .from('ratings')
      .select('release_group_id')
      .eq('user_id', userId)
      .then(({ data }) => {
        setRatedIds(
          new Set(
            ((data as { release_group_id: string }[] | null) ?? []).map(
              (r) => r.release_group_id,
            ),
          ),
        );
      });
  }, [userId]);

  const runSearch = useCallback(async (q: string) => {
    if (!supabase) return;
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setArtists([]);
      setAlbums([]);
      setSongs([]);
      return;
    }
    // Stale-request guard: a slower earlier query must never overwrite a newer
    // one's results (types faster than the network responds).
    const seq = ++runSeqRef.current;
    const fresh = () => seq === runSeqRef.current;
    setSearching(true);

    // Albums and artists each render the moment their own RPC returns — the
    // slower song lookup (a recordings scan + a release_tracks join) no longer
    // holds them up. Results now stream in instead of appearing all at once.
    const albumsP = supabase
      .rpc('search_release_groups', { q: trimmed, lim: 30 })
      .then(({ data }) => {
        if (!fresh()) return;
        const albumRows = (data as SearchReleaseGroupRPC[] | null) ?? [];
        setAlbums(
          albumRows.map((r) => ({
            id: r.id,
            title: r.title,
            artist: r.artist_display,
            coverUrl: r.cover_url,
            releaseType: r.release_group_type,
            releaseDate: r.first_release_date,
            titleNative: r.native_title,
            artistNative: r.artist_native,
          })),
        );
      });

    const artistsP = supabase
      .rpc('search_artists', { q: trimmed, lim: 10 })
      .then(({ data }) => {
        if (fresh()) setArtists((data as SearchArtistRPC[] | null) ?? []);
      });

    // Song hits → parent release group (canonical preferred), like iOS
    const songsP = (async () => {
      const { data: recData } = await supabase!
        .from('recordings')
        .select('id, title, artist_display')
        .ilike('title', `%${trimmed}%`)
        .limit(30);
      const hits =
        (recData as { id: string; title: string; artist_display: string | null }[] | null) ?? [];
      if (hits.length === 0) {
        if (fresh()) setSongs([]);
        return;
      }
      const { data: rtRows } = await supabase!
        .from('release_tracks')
        .select(
          'recording_id, releases(is_canonical, release_groups(id, title, artist_display, cover_url))',
        )
        .in('recording_id', hits.map((h) => h.id));
      if (!fresh()) return;
      const rgMap: Record<string, any> = {};
      for (const row of (rtRows as any[] | null) ?? []) {
        const rg = row.releases?.release_groups;
        if (!rg) continue;
        if (row.releases?.is_canonical || !rgMap[row.recording_id]) {
          rgMap[row.recording_id] = rg;
        }
      }
      setSongs(
        hits
          .filter((h) => rgMap[h.id])
          .map((h) => ({
            id: h.id,
            title: h.title,
            artists: h.artist_display,
            release: {
              id: rgMap[h.id].id,
              title: rgMap[h.id].title,
              artist: rgMap[h.id].artist_display ?? '',
              coverUrl: rgMap[h.id].cover_url,
              releaseType: null,
              releaseDate: null,
              titleNative: null,
              artistNative: null,
            },
          })),
      );
    })();

    await Promise.allSettled([albumsP, artistsP, songsP]);
    if (fresh()) setSearching(false);
  }, []);

  // Debounced search on query change (300ms, like iOS)
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, runSearch]);

  function addRelease(release: SJRelease) {
    if (ratingMode === 'instinct') setInstinctTarget(release);
    else setManualTarget(release);
  }

  async function saveQuickRating(score: number | null, release: SJRelease) {
    if (!userId) return;
    // Route through the app-wide store so the write propagates to every other
    // surface for this album (feed, charts, album page…), not just this page.
    await setRating(release.id, score);
    if (score == null) {
      // "Remove rating" from the modal used to silently no-op here
      setRatedIds((prev) => {
        const next = new Set(prev);
        next.delete(release.id);
        return next;
      });
      setSessionRatedIds((prev) => {
        const next = new Set(prev);
        next.delete(release.id);
        return next;
      });
      return;
    }
    markRated(release.id);
  }

  function markRated(id: string) {
    setRatedIds((prev) => new Set(prev).add(id));
    setSessionRatedIds((prev) => new Set(prev).add(id));
  }

  // Drag-to-rate: commit a quick score without opening the modal. Optimistically
  // marks the release rated so the card flips to its "rated" state immediately.
  function quickRate(release: SJRelease, score: number | null) {
    // A drag back into the dead zone commits null → void the rating.
    if (score == null) {
      void saveQuickRating(null, release);
      return;
    }
    markRated(release.id);
    void saveQuickRating(score, release);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 md:px-6 py-6">
      {/* Search bar */}
      <div className="flex items-center gap-2.5 px-4 h-12 rounded-xl bg-surface border border-divider focus-within:border-accent/60 transition max-w-2xl">
        <SearchIcon size={17} className="text-muted shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('sj.search.placeholder')}
          className="w-full bg-transparent text-[15px] text-ink placeholder-placeholder outline-none"
        />
        {searching ? (
          <span className="w-4 h-4 rounded-full border-2 border-divider border-t-accent animate-spin shrink-0" />
        ) : (
          query !== '' && (
            <button
              onClick={() => setQuery('')}
              aria-label={t('sj.search.clear')}
              className="text-muted hover:text-ink transition shrink-0"
            >
              <X size={16} />
            </button>
          )
        )}
      </div>

      {hasQuery ? (
        <SearchResults
          artists={artists}
          albums={albums}
          songs={songs}
          searching={searching}
          query={query}
          ratedIds={ratedIds}
          sessionRatedIds={sessionRatedIds}
          isInstinct={isInstinct}
          onAdd={addRelease}
          onRate={quickRate}
        />
      ) : (
        <>
          {/* Quick Add entry banner — mirrors iOS SearchView's quickAddBanner.
              Manual-mode gating happens on the Quick Add page itself. */}
          {userId && (
            <div className="flex items-center gap-3 mt-4 p-3 rounded-2xl bg-surface border border-divider/60">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold text-ink">{t('sj.quickAdd.settingUp')}</p>
                <p className="text-[12px] text-muted truncate">{t('sj.quickAdd.bannerBody')}</p>
              </div>
              <Link
                href="/quick-add"
                className="shrink-0 px-3.5 py-2 rounded-full bg-ink text-page text-[13.5px] font-semibold hover:opacity-85 transition"
              >
                {t('sj.quickAdd.title')}
              </Link>
            </div>
          )}
          <Discovery
            ratedIds={ratedIds}
            sessionRatedIds={sessionRatedIds}
            isInstinct={isInstinct}
            onAdd={addRelease}
            onRate={quickRate}
          />
        </>
      )}

      {manualTarget && (
        <ManualRateModal
          open
          onClose={() => setManualTarget(null)}
          release={manualTarget}
          existingScore={null}
          ratingStep={ratingStep}
          onSave={(score) => saveQuickRating(score, manualTarget)}
        />
      )}
      {instinctTarget && (
        <InstinctModal
          open
          onClose={() => setInstinctTarget(null)}
          release={instinctTarget}
          onRated={markRated}
        />
      )}
    </div>
  );
}

// ── Search results ──────────────────────────────────────────────────────────

function SearchResults({
  artists,
  albums,
  songs,
  searching,
  query,
  ratedIds,
  sessionRatedIds,
  isInstinct,
  onAdd,
  onRate,
}: {
  artists: SearchArtistRPC[];
  albums: SJRelease[];
  songs: SongResult[];
  searching: boolean;
  query: string;
  ratedIds: Set<string>;
  sessionRatedIds: Set<string>;
  isInstinct: boolean;
  onAdd: (release: SJRelease) => void;
  onRate: (release: SJRelease, score: number | null) => void;
}) {
  const { t } = useLanguage();
  const { profile } = useSession();
  const ratingStep = profile?.manual_rating_step ?? 0.5;
  const hasAny = artists.length > 0 || albums.length > 0 || songs.length > 0;

  // One menu instance for the whole artist column (see useContextMenuFor).
  const { onContextMenu: onArtistContextMenu, menu: artistContextMenu } =
    useContextMenuFor<SearchArtistRPC>((a) => [
      {
        key: 'open-new-tab',
        label: t('sj.context.openNewTab'),
        icon: <ExternalLink size={15} />,
        onSelect: () => openInNewTab(`/artist/${a.id}`),
      },
    ]);

  if (!hasAny) {
    if (searching || query.trim().length < 2) return <div className="py-20" />;
    return (
      <div className="py-24 flex flex-col items-center gap-3">
        <SearchIcon size={40} className="text-divider" />
        <p className="text-[14.5px] text-muted">
          {t('sj.search.noResults').replace('{q}', query)}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-7 grid lg:grid-cols-[280px_1fr] gap-8 items-start">
      {/* Artists (left column on desktop) */}
      {artists.length > 0 && (
        <section className="lg:sticky lg:top-[76px]">
          <SectionLabel>{t('sj.search.artists')}</SectionLabel>
          <ul className="rounded-2xl bg-surface border border-divider/60 divide-y divide-divider overflow-hidden">
            {artists.map((a) => {
              const native =
                a.name_native && isPredominantlyHangul(a.name_native) ? a.name_native : null;
              return (
                <li key={a.id} onContextMenu={(e) => onArtistContextMenu(e, a)}>
                  <ArtistLink
                    href={`/artist/${a.id}`}
                    className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-page/60 transition"
                  >
                    {a.cover_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.cover_url}
                        alt=""
                        className="w-11 h-11 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <span className="flex w-11 h-11 rounded-full bg-divider text-muted items-center justify-center text-[15px] font-bold shrink-0">
                        {a.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold text-ink truncate">
                        {a.name}
                      </span>
                      {native && (
                        <span className="block text-[11.5px] text-muted truncate">{native}</span>
                      )}
                      <span className="block text-[11.5px] text-muted">
                        {a.release_count === 1
                          ? t('sj.search.oneRelease')
                          : t('sj.search.nReleases').replace('{n}', String(a.release_count))}
                      </span>
                    </span>
                    <ChevronRight size={13} className="text-divider" />
                  </ArtistLink>
                </li>
              );
            })}
          </ul>
          {artistContextMenu}
        </section>
      )}

      <div className={artists.length === 0 ? 'lg:col-span-2' : ''}>
        {/* Albums grid */}
        {albums.length > 0 && (
          <section>
            <SectionLabel>{t('sj.search.albums')}</SectionLabel>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
              {albums.map((release) => (
                <AlbumCard
                  key={release.id}
                  release={release}
                  rated={ratedIds.has(release.id)}
                  sessionRated={sessionRatedIds.has(release.id)}
                  isInstinct={isInstinct}
                  ratingStep={ratingStep}
                  onAdd={() => onAdd(release)}
                  onRate={(score) => onRate(release, score)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Songs */}
        {songs.length > 0 && (
          <section className="mt-8">
            <SectionLabel>{t('sj.search.songs')}</SectionLabel>
            <ul className="rounded-2xl bg-surface border border-divider/60 divide-y divide-divider overflow-hidden">
              {songs.map((song) => (
                <SongRow
                  key={song.id}
                  song={song}
                  rated={ratedIds.has(song.release.id)}
                  sessionRated={sessionRatedIds.has(song.release.id)}
                  isInstinct={isInstinct}
                  ratingStep={ratingStep}
                  onAdd={() => onAdd(song.release)}
                  onRate={(score) => onRate(song.release, score)}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

// ── Discovery (empty query) ─────────────────────────────────────────────────

function Discovery({
  ratedIds,
  sessionRatedIds,
  isInstinct,
  onAdd,
  onRate,
}: {
  ratedIds: Set<string>;
  sessionRatedIds: Set<string>;
  isInstinct: boolean;
  onAdd: (release: SJRelease) => void;
  onRate: (release: SJRelease, score: number | null) => void;
}) {
  const { t } = useLanguage();
  const { userId, ready, profile } = useSession();
  const ratingStep = profile?.manual_rating_step ?? 0.5;
  const [tasteAlbums, setTasteAlbums] = useState<SJRelease[]>([]);
  const [personalized, setPersonalized] = useState<SJRelease[]>([]);
  const [worlds, setWorlds] = useState<{ label: string; albums: SJRelease[] }[]>([]);
  const [blockedArtists, setBlockedArtists] = useState<Set<string>>(new Set());
  const [popular, setPopular] = useState<SJRelease[]>([]);
  const [newReleases, setNewReleases] = useState<SJRelease[]>([]);
  const [trending, setTrending] = useState<SJRelease[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !ready) return;
    let cancelled = false;

    const mapRows = (rows: any[] | null): SJRelease[] =>
      (rows ?? []).map((r) => ({
        id: r.id,
        title: r.title,
        artist: r.artist_display,
        coverUrl: r.cover_url,
        releaseType: r.release_group_type,
        releaseDate: r.first_release_date,
        titleNative: r.native_title,
        artistNative: null,
      }));

    (async () => {
      // Popular (prestige-ranked) / New Releases / Trending (bot-weighted) —
      // one globally-cached service-role route (/api/discovery). Falls back to
      // the old client-side queries if it fails, so a route outage degrades
      // rather than blanks the rows.
      const globalP = (async () => {
        try {
          const res = await fetch('/api/discovery');
          if (!res.ok) throw new Error(`discovery ${res.status}`);
          const payload: { popular: any[]; newReleases: any[]; trending: any[] } =
            await res.json();
          if (cancelled) return;
          setPopular(mapRows(payload.popular));
          setNewReleases(mapRows(payload.newReleases));
          setTrending(mapRows(payload.trending));
          return;
        } catch (err) {
          console.warn('[search] discovery route failed, using fallback:', err);
        }

        // Fallback: newest-first list (the old "Popular") only — the old
        // client-side trending had no bot filter, so it's not worth keeping.
        const { data } = await supabase!
          .from('release_groups')
          .select(RG_COLS)
          .in('release_group_type', ['album', 'ep'])
          .not('cover_url', 'is', null)
          .order('first_release_date', { ascending: false, nullsFirst: false })
          .limit(50);
        if (!cancelled) setNewReleases(mapRows(data as any[]));
      })();

      // From Your Taste (loved artists) + For You (taste-cluster reranked
      // discovery) — served by /api/recommendations (server-side, low-rated
      // artists suppressed, already-rated albums excluded). Falls back to the
      // old client-side loved-artist queries if the route fails, so a route
      // outage degrades rather than blanks the rows.
      const personalP = (async () => {
        if (!userId) return;
        try {
          const { data: sessionData } = await supabase!.auth.getSession();
          const token = sessionData.session?.access_token;
          if (!token) throw new Error('no session');
          const res = await fetch('/api/recommendations', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) throw new Error(`recs ${res.status}`);
          const payload: {
            fromYourTaste: any[];
            forYou: any[];
            worlds?: { label: string; albums: any[] }[];
            blockedArtists?: string[];
          } = await res.json();
          if (cancelled) return;
          setTasteAlbums(mapRows(payload.fromYourTaste));
          setPersonalized(mapRows(payload.forYou));
          setWorlds(
            (payload.worlds ?? []).map((w) => ({ label: w.label, albums: mapRows(w.albums) })),
          );
          // Popular/Trending are assembled from globally-shared queries — the
          // per-user ≤1.5★ artist suppression is applied to them client-side.
          setBlockedArtists(new Set(payload.blockedArtists ?? []));
          return;
        } catch (err) {
          console.warn('[search] recommendations route failed, using fallback:', err);
        }

        // Fallback: albums by artists the user rated ≥ 4 (client-side).
        const { data: ratedRows } = await supabase!
          .from('ratings')
          .select('score, release_groups(artist_display)')
          .eq('user_id', userId)
          .limit(200);
        if (cancelled) return;
        const all = (ratedRows as any[] | null) ?? [];
        const lovedArtists = Array.from(
          new Set(
            all
              .filter((r) => (r.score ?? 0) >= 4)
              .map((r) => r.release_groups?.artist_display)
              .filter(Boolean),
          ),
        ).slice(0, 30);

        if (lovedArtists.length > 0) {
          const { data } = await supabase!
            .from('release_groups')
            .select(RG_COLS)
            .in('artist_display', lovedArtists)
            .in('release_group_type', ['album', 'ep'])
            .not('cover_url', 'is', null)
            .order('first_release_date', { ascending: false, nullsFirst: false })
            .limit(200);
          if (cancelled) return;
          // Cap 3 per artist so one prolific artist doesn't flood the row
          const perArtist: Record<string, number> = {};
          const capped: SJRelease[] = [];
          for (const album of mapRows(data as any[])) {
            const n = perArtist[album.artist] ?? 0;
            if (n < 3) {
              capped.push(album);
              perArtist[album.artist] = n + 1;
            }
          }
          // Shuffle
          for (let i = capped.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [capped[i], capped[j]] = [capped[j], capped[i]];
          }
          setTasteAlbums(capped);
        }
      })();

      await Promise.all([globalP, personalP]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, userId]);

  const visible = (albums: SJRelease[]) =>
    albums.filter(
      (a) =>
        (!ratedIds.has(a.id) || sessionRatedIds.has(a.id)) && !blockedArtists.has(a.artist),
    );

  if (loading) {
    return (
      <div className="mt-8 space-y-8" aria-hidden>
        {[0, 1].map((i) => (
          <div key={i}>
            <SkeletonLine w="w-40" h="h-6" className="mb-3" />
            <div className="flex gap-4">
              {Array.from({ length: 6 }).map((_, j) => (
                <Skeleton key={j} className="w-36 h-48 rounded-xl bg-surface" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const sections: { title: string; albums: SJRelease[] }[] = [
    { title: t('sj.search.fromYourTaste'), albums: visible(tasteAlbums) },
    { title: t('sj.search.forYou'), albums: visible(personalized) },
    ...worlds.map((w) => ({
      title: t('sj.search.becauseYouLove').replace('{genre}', w.label),
      albums: visible(w.albums),
    })),
    { title: t('sj.search.popular'), albums: visible(popular) },
    { title: t('sj.search.trending'), albums: visible(trending) },
    { title: t('sj.search.newReleases'), albums: visible(newReleases) },
  ].filter((s) => s.albums.length > 0);

  return (
    <div className="mt-8 space-y-9 pb-10">
      {sections.map(({ title, albums }) => (
        <section key={title}>
          <h2 className="text-[19px] font-bold text-ink mb-3">{title}</h2>
          <div className="flex gap-4 overflow-x-auto scrollbar-hide -mx-4 px-4 md:-mx-6 md:px-6">
            {albums.slice(0, 24).map((release) => (
              <div key={release.id} className="w-36 shrink-0">
                <AlbumCard
                  release={release}
                  rated={ratedIds.has(release.id)}
                  sessionRated={sessionRatedIds.has(release.id)}
                  isInstinct={isInstinct}
                  ratingStep={ratingStep}
                  onAdd={() => onAdd(release)}
                  onRate={(score) => onRate(release, score)}
                />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Shared cards ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold tracking-[0.1em] uppercase text-muted mb-3">
      {children}
    </h2>
  );
}

function AlbumCard({
  release,
  rated,
  sessionRated,
  isInstinct,
  ratingStep = 0.5,
  onAdd,
  onRate,
}: {
  release: SJRelease;
  rated: boolean;
  sessionRated: boolean;
  isInstinct: boolean;
  ratingStep?: number;
  onAdd: () => void;
  onRate: (score: number | null) => void;
}) {
  const { t } = useLanguage();
  const showCheck = sessionRated;
  const showAdd = !rated && !sessionRated;

  return (
    <div className="group">
      <AlbumPeek
        releaseId={release.id}
        title={displayName(release.title, release.titleNative)}
        artist={displayName(release.artist, release.artistNative)}
        release={release}
        className="relative"
      >
        <Link href={`/album/${release.id}`}>
          <Cover url={release.coverUrl} className="w-full aspect-square" rounded="rounded-xl" />
        </Link>
        <AlbumBookmarkButton
          releaseGroupId={release.id}
          size={26}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition"
        />
        {showCheck && (
          <span className="absolute bottom-2 right-2 flex w-7 h-7 rounded-full bg-accent items-center justify-center shadow">
            <Check size={12} strokeWidth={3} className="text-white" />
          </span>
        )}
        {showAdd &&
          (isInstinct ? (
            <InstinctAddButton
              onOpen={onAdd}
              ariaLabel={`${t('sj.search.add')} ${release.title}`}
              size={30}
              className="absolute bottom-2 right-2 opacity-90 group-hover:opacity-100 transition"
            />
          ) : (
            <FlowerRateControl
              ariaLabel={`${t('sj.search.add')} ${release.title}`}
              onRate={onRate}
              onRequestPrecise={onAdd}
              size={30}
              className="absolute bottom-2 right-2 opacity-90 group-hover:opacity-100 transition"
              ratingStep={ratingStep}
            />
          ))}
      </AlbumPeek>
      <Link href={`/album/${release.id}`} className="block mt-1.5">
        <p className="text-[13px] font-semibold text-ink truncate group-hover:underline">
          {displayName(release.title, release.titleNative)}
        </p>
        <p className="flex items-center gap-1.5 text-[12px] text-muted truncate">
          <span className="px-1 py-0.5 rounded bg-accent/10 text-accent text-[9px] font-medium shrink-0">
            {t(typeLabelKey(release.releaseType))}
          </span>
          {displayName(release.artist, release.artistNative)}
        </p>
      </Link>
    </div>
  );
}

function SongRow({
  song,
  rated,
  sessionRated,
  isInstinct,
  ratingStep = 0.5,
  onAdd,
  onRate,
}: {
  song: SongResult;
  rated: boolean;
  sessionRated: boolean;
  isInstinct: boolean;
  ratingStep?: number;
  onAdd: () => void;
  onRate: (score: number | null) => void;
}) {
  const { t } = useLanguage();
  // Right-click parity with album cards (whose menu rides on AlbumPeek).
  const { onContextMenu, menu } = useContextMenu([
    {
      key: 'open-new-tab',
      label: t('sj.context.openNewTab'),
      icon: <ExternalLink size={15} />,
      onSelect: () => openInNewTab(`/song/${song.id}?rg=${song.release.id}`),
    },
    {
      key: 'rate',
      label: t('sj.context.rate'),
      icon: <FlowerGlyph size={14} src="/icon-flower.svg" />,
      onSelect: onAdd,
    },
  ]);
  return (
    <li
      onContextMenu={onContextMenu}
      className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-page/60 transition group"
    >
      {menu}
      <Link
        href={`/song/${song.id}?rg=${song.release.id}`}
        className="flex items-center gap-3 min-w-0 flex-1"
      >
        <Cover url={song.release.coverUrl} className="w-11 h-11" rounded="rounded-md" />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="text-[13.5px] font-semibold text-ink truncate">{song.title}</span>
            <span className="px-1 py-0.5 rounded bg-accent/10 text-accent text-[9px] font-medium shrink-0">
              {t('sj.type.song')}
            </span>
          </span>
          <span className="block text-[12px] text-muted truncate">
            {song.release.title} · {song.artists ?? song.release.artist}
          </span>
        </span>
      </Link>
      {sessionRated ? (
        <span className="flex w-[30px] h-[30px] rounded-full bg-accent items-center justify-center shrink-0">
          <Check size={12} strokeWidth={3} className="text-white" />
        </span>
      ) : !rated ? (
        isInstinct ? (
          <InstinctAddButton
            onOpen={onAdd}
            ariaLabel={`${t('sj.search.add')} ${song.title}`}
            size={30}
            className="shrink-0 !bg-accent/[0.12] !shadow-none"
          />
        ) : (
          <FlowerRateControl
            ariaLabel={`${t('sj.search.add')} ${song.title}`}
            onRate={onRate}
            onRequestPrecise={onAdd}
            size={30}
            className="shrink-0 !bg-accent/[0.12] !shadow-none"
            ratingStep={ratingStep}
          />
        )
      ) : null}
    </li>
  );
}

/**
 * Instinct-mode counterpart to the drag flower: a plus that opens the pairwise
 * sheet (no quick score, no drag). Session-rated cards show a check elsewhere,
 * so this only ever renders the plus. Matches AlbumRateButton's Instinct button.
 */
function InstinctAddButton({
  onOpen,
  ariaLabel,
  size,
  className = '',
}: {
  onOpen: () => void;
  ariaLabel: string;
  size: number;
  className?: string;
}) {
  // Native-listener ref so the click never reaches a wrapping <Link> or the top
  // progress bar (see useNavSafeClick).
  const ref = useNavSafeClick<HTMLButtonElement>(onOpen);
  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      onPointerDown={(e) => e.stopPropagation()}
      className={`grid place-items-center rounded-full shadow bg-white text-accent transition-transform hover:scale-105 active:scale-95 ${className}`}
      style={{ width: size, height: size }}
    >
      <Plus size={Math.round(size * 0.52)} strokeWidth={3} />
    </button>
  );
}
