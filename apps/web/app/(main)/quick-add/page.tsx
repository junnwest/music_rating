'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import Cover from '../../../components/sj/Cover';
import FlowerRateControl from '../../../components/sj/FlowerRateControl';
import ManualRateModal from '../../../components/sj/ManualRateModal';
import { useSession } from '../../../components/sj/SessionContext';
import { supabase } from '../../../lib/supabaseClient';
import { useLanguage } from '../../../lib/i18n';
import { displayName } from '../../../lib/sj/display';
import type { SJRelease } from '../../../lib/sj/data';

const PAGE_SIZE = 20;

type Mode = 'albums' | 'songs';

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

/** A precise-rating target handed to ManualRateModal (drag = quick; tap = precise). */
type Target =
  | { kind: 'album'; release: SJRelease }
  | { kind: 'song'; recordingId: string; title: string; release: SJRelease };

/**
 * Quick Add — the web counterpart of iOS's QuickAddView. Its whole purpose is
 * albums (and songs) the user has *probably already heard* — seeded from their
 * Spotify top/recent artists and their own highly-rated artists — so they can
 * rate fast from memory. Backed by get_quick_add_candidates /
 * get_quick_add_song_candidates (already-rated releases excluded in SQL,
 * prestige-ordered so the artist's known work leads). Rate by dragging the
 * flower; tap it for the precise slider.
 */
export default function QuickAddPage() {
  const { t } = useLanguage();
  const { userId, ready } = useSession();

  const [seeds, setSeeds] = useState<string[] | null>(null);
  const [mode, setMode] = useState<Mode>('albums');
  const [albums, setAlbums] = useState<AlbumCandidate[]>([]);
  const [songs, setSongs] = useState<SongCandidate[]>([]);
  const [albumDone, setAlbumDone] = useState(false);
  const [songDone, setSongDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [held, setHeld] = useState<Record<string, number>>({});
  const [target, setTarget] = useState<Target | null>(null);

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
          .select('spotify_artists, spotify_recently_played')
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
      } | null;
      for (const a of p?.spotify_artists ?? []) add(a.name);
      for (const a of p?.spotify_recently_played ?? []) add(a.artistName);
      for (const r of (ratedRows as { release_groups?: { artist_display?: string } }[] | null) ?? []) {
        add(r.release_groups?.artist_display);
      }
      setSeeds(ordered);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, userId]);

  const fetchAlbums = useCallback(
    async (offset: number): Promise<AlbumCandidate[]> => {
      if (!supabase || !userId || !seeds || seeds.length === 0) return [];
      const { data } = await supabase.rpc('get_quick_add_candidates', {
        p_user_id: userId,
        p_artist_names: seeds,
        p_lim: PAGE_SIZE,
        p_offset: offset,
      });
      return (data as AlbumCandidate[] | null) ?? [];
    },
    [userId, seeds],
  );

  const fetchSongs = useCallback(
    async (offset: number): Promise<SongCandidate[]> => {
      if (!supabase || !userId || !seeds || seeds.length === 0) return [];
      const { data } = await supabase.rpc('get_quick_add_song_candidates', {
        p_user_id: userId,
        p_artist_names: seeds,
        p_lim: PAGE_SIZE,
        p_offset: offset,
      });
      return (data as SongCandidate[] | null) ?? [];
    },
    [userId, seeds],
  );

  // Initial load once seeds are ready
  useEffect(() => {
    if (seeds === null) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [a, s] = await Promise.all([fetchAlbums(0), fetchSongs(0)]);
      if (cancelled) return;
      setAlbums(a);
      setSongs(s);
      setAlbumDone(a.length < PAGE_SIZE);
      setSongDone(s.length < PAGE_SIZE);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [seeds, fetchAlbums, fetchSongs]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    if (mode === 'albums' && albumDone) return;
    if (mode === 'songs' && songDone) return;
    setLoadingMore(true);
    if (mode === 'albums') {
      const next = await fetchAlbums(albums.length);
      setAlbums((prev) => [...prev, ...next]);
      setAlbumDone(next.length < PAGE_SIZE);
    } else {
      const next = await fetchSongs(songs.length);
      setSongs((prev) => [...prev, ...next]);
      setSongDone(next.length < PAGE_SIZE);
    }
    setLoadingMore(false);
  }, [mode, loadingMore, albumDone, songDone, albums.length, songs.length, fetchAlbums, fetchSongs]);

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
  async function rateAlbum(c: AlbumCandidate, score: number) {
    if (!supabase || !userId) return;
    setHeld((h) => ({ ...h, [c.id]: score }));
    await supabase
      .from('ratings')
      .upsert(
        { user_id: userId, release_group_id: c.id, score },
        { onConflict: 'user_id,release_group_id' },
      );
  }

  async function rateSong(c: SongCandidate, score: number) {
    if (!supabase || !userId) return;
    setHeld((h) => ({ ...h, [c.id]: score }));
    await supabase
      .from('track_ratings')
      .upsert(
        { user_id: userId, recording_id: c.id, score },
        { onConflict: 'user_id,recording_id' },
      );
  }

  async function saveTarget(score: number | null) {
    if (!supabase || !userId || !target) return;
    if (target.kind === 'album') {
      if (score == null) return;
      setHeld((h) => ({ ...h, [target.release.id]: score }));
      await supabase
        .from('ratings')
        .upsert(
          { user_id: userId, release_group_id: target.release.id, score },
          { onConflict: 'user_id,release_group_id' },
        );
    } else {
      if (score == null) return;
      setHeld((h) => ({ ...h, [target.recordingId]: score }));
      await supabase
        .from('track_ratings')
        .upsert(
          { user_id: userId, recording_id: target.recordingId, score },
          { onConflict: 'user_id,recording_id' },
        );
    }
  }

  const list = mode === 'albums' ? albums : songs;
  const done = mode === 'albums' ? albumDone : songDone;

  return (
    <div className="mx-auto max-w-2xl px-4 md:px-6 py-6">
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
        <ul className="mt-3 divide-y divide-divider animate-pulse">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 py-2.5">
              <div className="w-[52px] h-[52px] rounded-lg bg-surface shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-2/3 rounded bg-surface" />
                <div className="h-2.5 w-1/3 rounded bg-surface" />
              </div>
            </li>
          ))}
        </ul>
      ) : seeds && seeds.length === 0 ? (
        <p className="py-20 text-center text-[13.5px] text-muted">{t('sj.quickAdd.needSeed')}</p>
      ) : list.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <ul className="mt-2 divide-y divide-divider">
            {mode === 'albums'
              ? albums.map((c) => (
                  <Row
                    key={c.id}
                    coverUrl={c.cover_url}
                    title={displayName(c.title, c.native_title)}
                    subtitle={c.artist_display}
                    held={held[c.id]}
                    onRate={(score) => rateAlbum(c, score)}
                    onPrecise={() =>
                      setTarget({
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
                      })
                    }
                  />
                ))
              : songs.map((c) => (
                  <Row
                    key={c.id}
                    coverUrl={c.cover_url}
                    title={c.title}
                    subtitle={`${c.album_title} · ${c.artist_display}`}
                    held={held[c.id]}
                    onRate={(score) => rateSong(c, score)}
                    onPrecise={() =>
                      setTarget({
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
          {!done && <div ref={sentinelRef} className="h-10" />}
          {loadingMore && (
            <p className="py-4 text-center text-[12px] text-muted">…</p>
          )}
        </>
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

function Row({
  coverUrl,
  title,
  subtitle,
  held,
  onRate,
  onPrecise,
}: {
  coverUrl: string | null;
  title: string;
  subtitle: string;
  held?: number;
  onRate: (score: number) => void;
  onPrecise: () => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Cover url={coverUrl} className="w-[52px] h-[52px] shrink-0" rounded="rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-ink truncate">{title}</p>
        <p className="text-[12.5px] text-muted truncate">{subtitle}</p>
      </div>
      {/* Always the drag control — a rated row shows its score and stays
          re-ratable (press and drag again to change it). */}
      <FlowerRateControl
        ariaLabel={`Rate ${title}`}
        onRate={onRate}
        onRequestPrecise={onPrecise}
        currentScore={held ?? null}
        size={34}
        className="shrink-0"
      />
    </li>
  );
}

function EmptyState() {
  const { t } = useLanguage();
  return (
    <div className="py-24 flex flex-col items-center gap-3 text-center">
      <CheckCircle2 size={40} className="text-divider" />
      <p className="text-[15px] font-semibold text-ink">{t('sj.quickAdd.empty')}</p>
      <p className="text-[13px] text-muted max-w-xs">{t('sj.quickAdd.emptyDesc')}</p>
    </div>
  );
}
