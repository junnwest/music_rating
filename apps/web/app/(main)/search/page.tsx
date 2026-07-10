'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Search as SearchIcon, X, Plus, Check, ChevronRight } from 'lucide-react';
import Cover from '../../../components/sj/Cover';
import ManualRateModal from '../../../components/sj/ManualRateModal';
import InstinctModal from '../../../components/sj/InstinctModal';
import { useSession } from '../../../components/sj/SessionContext';
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
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [searching, setSearching] = useState(false);
  const [artists, setArtists] = useState<SearchArtistRPC[]>([]);
  const [albums, setAlbums] = useState<SJRelease[]>([]);
  const [songs, setSongs] = useState<SongResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Quick-rate state
  const [ratedIds, setRatedIds] = useState<Set<string>>(new Set());
  const [sessionRatedIds, setSessionRatedIds] = useState<Set<string>>(new Set());
  const [manualTarget, setManualTarget] = useState<SJRelease | null>(null);
  const [instinctTarget, setInstinctTarget] = useState<SJRelease | null>(null);

  const ratingMode = profile?.rating_mode ?? 'manual';
  const ratingStep = profile?.manual_rating_step ?? 0.5;
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
    setSearching(true);

    const [albumsRes, artistsRes, recordingsRes] = await Promise.all([
      supabase.rpc('search_release_groups', { q: trimmed, lim: 30 }),
      supabase.rpc('search_artists', { q: trimmed, lim: 10 }),
      supabase
        .from('recordings')
        .select('id, title, artist_display')
        .ilike('title', `%${trimmed}%`)
        .limit(30),
    ]);

    const albumRows = (albumsRes.data as SearchReleaseGroupRPC[] | null) ?? [];
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
    setArtists((artistsRes.data as SearchArtistRPC[] | null) ?? []);

    // Song hits → parent release group (canonical preferred), like iOS
    const hits =
      (recordingsRes.data as { id: string; title: string; artist_display: string | null }[] | null) ??
      [];
    if (hits.length === 0) {
      setSongs([]);
    } else {
      const { data: rtRows } = await supabase
        .from('release_tracks')
        .select(
          'recording_id, releases(is_canonical, release_groups(id, title, artist_display, cover_url))',
        )
        .in('recording_id', hits.map((h) => h.id));
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
    }
    setSearching(false);
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
    if (!supabase || !userId) return;
    if (score == null) {
      // "Remove rating" from the modal used to silently no-op here
      await supabase
        .from('ratings')
        .delete()
        .eq('user_id', userId)
        .eq('release_group_id', release.id);
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
    await supabase
      .from('ratings')
      .upsert(
        { user_id: userId, release_group_id: release.id, score },
        { onConflict: 'user_id,release_group_id' },
      );
    markRated(release.id);
  }

  function markRated(id: string) {
    setRatedIds((prev) => new Set(prev).add(id));
    setSessionRatedIds((prev) => new Set(prev).add(id));
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
          onAdd={addRelease}
        />
      ) : (
        <Discovery
          ratedIds={ratedIds}
          sessionRatedIds={sessionRatedIds}
          onAdd={addRelease}
        />
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
  onAdd,
}: {
  artists: SearchArtistRPC[];
  albums: SJRelease[];
  songs: SongResult[];
  searching: boolean;
  query: string;
  ratedIds: Set<string>;
  sessionRatedIds: Set<string>;
  onAdd: (release: SJRelease) => void;
}) {
  const { t } = useLanguage();
  const hasAny = artists.length > 0 || albums.length > 0 || songs.length > 0;

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
                <li key={a.id}>
                  <Link
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
                  </Link>
                </li>
              );
            })}
          </ul>
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
                  onAdd={() => onAdd(release)}
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
                  onAdd={() => onAdd(song.release)}
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
  onAdd,
}: {
  ratedIds: Set<string>;
  sessionRatedIds: Set<string>;
  onAdd: (release: SJRelease) => void;
}) {
  const { t } = useLanguage();
  const { userId, ready } = useSession();
  const [tasteAlbums, setTasteAlbums] = useState<SJRelease[]>([]);
  const [personalized, setPersonalized] = useState<SJRelease[]>([]);
  const [popular, setPopular] = useState<SJRelease[]>([]);
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
      // Popular: recent albums/EPs with covers (matches iOS loadPopular)
      const popularP = supabase!
        .from('release_groups')
        .select(RG_COLS)
        .in('release_group_type', ['album', 'ep'])
        .not('cover_url', 'is', null)
        .order('first_release_date', { ascending: false, nullsFirst: false })
        .limit(50)
        .then(({ data }) => {
          if (!cancelled) setPopular(mapRows(data as any[]));
        });

      // Trending: most-rated in last 30 days
      const trendingP = (async () => {
        const cutoff = new Date(Date.now() - 30 * 86400e3).toISOString();
        const { data } = await supabase!
          .from('ratings')
          .select(`release_group_id, release_groups(${RG_COLS})`)
          .gt('created_at', cutoff)
          .order('created_at', { ascending: false })
          .limit(500);
        if (cancelled) return;
        const counts: Record<string, { count: number; release: SJRelease }> = {};
        for (const row of (data as any[] | null) ?? []) {
          const rg = row.release_groups;
          if (!rg || rg.release_group_type === 'single') continue;
          const mapped = mapRows([rg])[0];
          counts[row.release_group_id] = {
            count: (counts[row.release_group_id]?.count ?? 0) + 1,
            release: mapped,
          };
        }
        setTrending(
          Object.values(counts)
            .sort((a, b) => b.count - a.count)
            .map((c) => c.release)
            .slice(0, 25),
        );
      })();

      // From Your Taste (artists rated ≥4) + For You (all rated artists)
      const personalP = (async () => {
        if (!userId) return;
        const { data: ratedRows } = await supabase!
          .from('ratings')
          .select('score, release_groups(artist_display)')
          .eq('user_id', userId)
          .limit(200);
        if (cancelled) return;
        const all = (ratedRows as any[] | null) ?? [];
        const allArtists = Array.from(
          new Set(all.map((r) => r.release_groups?.artist_display).filter(Boolean)),
        ).slice(0, 50);
        const lovedArtists = Array.from(
          new Set(
            all
              .filter((r) => (r.score ?? 0) >= 4)
              .map((r) => r.release_groups?.artist_display)
              .filter(Boolean),
          ),
        ).slice(0, 30);

        if (allArtists.length > 0) {
          const { data } = await supabase!
            .from('release_groups')
            .select(RG_COLS)
            .in('artist_display', allArtists)
            .in('release_group_type', ['album', 'ep'])
            .not('cover_url', 'is', null)
            .order('first_release_date', { ascending: false, nullsFirst: false })
            .limit(60);
          if (!cancelled) setPersonalized(mapRows(data as any[]));
        }
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

      await Promise.all([popularP, trendingP, personalP]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, userId]);

  const visible = (albums: SJRelease[]) =>
    albums.filter((a) => !ratedIds.has(a.id) || sessionRatedIds.has(a.id));

  if (loading) {
    return (
      <div className="mt-8 space-y-8 animate-pulse">
        {[0, 1].map((i) => (
          <div key={i}>
            <div className="h-6 w-40 rounded bg-surface mb-3" />
            <div className="flex gap-4">
              {Array.from({ length: 6 }).map((_, j) => (
                <div key={j} className="w-36 h-48 rounded-xl bg-surface" />
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
    { title: t('sj.search.popular'), albums: visible(popular) },
    { title: t('sj.search.trending'), albums: visible(trending) },
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
                  onAdd={() => onAdd(release)}
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
  onAdd,
}: {
  release: SJRelease;
  rated: boolean;
  sessionRated: boolean;
  onAdd: () => void;
}) {
  const { t } = useLanguage();
  const showCheck = sessionRated;
  const showAdd = !rated && !sessionRated;

  return (
    <div className="group">
      <div className="relative">
        <Link href={`/album/${release.id}`}>
          <Cover url={release.coverUrl} className="w-full aspect-square" rounded="rounded-xl" />
        </Link>
        {showCheck && (
          <span className="absolute bottom-2 right-2 flex w-7 h-7 rounded-full bg-accent items-center justify-center shadow">
            <Check size={12} strokeWidth={3} className="text-white" />
          </span>
        )}
        {showAdd && (
          <button
            onClick={(e) => {
              e.preventDefault();
              onAdd();
            }}
            aria-label={`${t('sj.search.add')} ${release.title}`}
            className="absolute bottom-2 right-2 flex w-7 h-7 rounded-full bg-white items-center justify-center shadow opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
          >
            <Plus size={13} strokeWidth={2.8} className="text-accent" />
          </button>
        )}
      </div>
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
  onAdd,
}: {
  song: SongResult;
  rated: boolean;
  sessionRated: boolean;
  onAdd: () => void;
}) {
  const { t } = useLanguage();
  return (
    <li className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-page/60 transition group">
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
        <button
          onClick={onAdd}
          aria-label={`${t('sj.search.add')} ${song.title}`}
          className="flex w-[30px] h-[30px] rounded-full bg-accent/[0.12] items-center justify-center shrink-0 hover:bg-accent/20 transition"
        >
          <Plus size={13} strokeWidth={2.8} className="text-accent" />
        </button>
      ) : null}
    </li>
  );
}
