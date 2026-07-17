'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import Cover from '../../../components/sj/Cover';
import FlowerRatingRow from '../../../components/sj/FlowerRatingRow';
import { useSession } from '../../../components/sj/SessionContext';
import { supabase } from '../../../lib/supabaseClient';
import { useLanguage } from '../../../lib/i18n';
import { displayName } from '../../../lib/sj/display';

const PAGE_SIZE = 20;

interface AlbumCandidate {
  id: string;
  title: string;
  artist_display: string;
  cover_url: string | null;
  native_title: string | null;
  release_group_type: string | null;
}

interface SongCandidate {
  id: string; // recordings.id
  title: string;
  artist_display: string;
  cover_url: string | null;
  album_title: string;
}

/**
 * Quick Add — web port of iOS QuickAddView: candidate albums/songs from artists
 * the user probably knows (Spotify taste + own rated-artist history), each rated
 * in place by dragging across five flowers. Just-rated rows keep the editable
 * flower row (filled at the committed score) so a slip can be fixed immediately;
 * the server-side NOT EXISTS exclusion drops them on the next fresh load.
 */
export default function QuickAddPage() {
  const { t } = useLanguage();
  const { userId, profile } = useSession();
  const [mode, setMode] = useState<'albums' | 'songs'>('albums');
  const [albums, setAlbums] = useState<AlbumCandidate[]>([]);
  const [songs, setSongs] = useState<SongCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreAlbums, setHasMoreAlbums] = useState(true);
  const [hasMoreSongs, setHasMoreSongs] = useState(true);
  // Rated this session but held in place (keyed by album/song id) — mirrors
  // iOS QuickAddViewModel.ratedScores.
  const [ratedScores, setRatedScores] = useState<Record<string, number>>({});
  const seedRef = useRef<string[] | null>(null);

  const ratingMode = profile?.rating_mode ?? 'manual';

  /**
   * Ordered by confidence, mirroring iOS QuickAddViewModel.init: Spotify top
   * artists first, then Spotify recently-played, then the user's own highly-
   * rated artist history (>= 3.5, best first). Apple Music sources are
   * device-only and don't exist on web.
   */
  const buildSeed = useCallback(async (): Promise<string[]> => {
    if (seedRef.current) return seedRef.current;
    if (!supabase || !userId) return [];
    const seen = new Set<string>();
    const ordered: string[] = [];
    const add = (name: string | null | undefined) => {
      if (!name) return;
      if (seen.has(name)) return;
      seen.add(name);
      ordered.push(name);
    };

    const { data: prof } = await supabase
      .from('profiles')
      .select('spotify_artists, spotify_recently_played')
      .eq('id', userId)
      .maybeSingle();
    const p = prof as {
      spotify_artists: { name?: string }[] | null;
      spotify_recently_played: { artistName?: string }[] | null;
    } | null;
    for (const a of p?.spotify_artists ?? []) add(a.name);
    for (const a of p?.spotify_recently_played ?? []) add(a.artistName);

    const { data: rated } = await supabase
      .from('ratings')
      .select('score, release_groups(artist_display)')
      .eq('user_id', userId)
      .gte('score', 3.5)
      .order('score', { ascending: false })
      .limit(100);
    for (const r of (rated as { release_groups: { artist_display: string | null } | null }[] | null) ?? []) {
      add(r.release_groups?.artist_display);
    }

    seedRef.current = ordered;
    return ordered;
  }, [userId]);

  const fetchAlbums = useCallback(
    async (offset: number): Promise<AlbumCandidate[]> => {
      if (!supabase || !userId) return [];
      const names = await buildSeed();
      if (!names.length) return [];
      const { data } = await supabase.rpc('get_quick_add_candidates', {
        p_user_id: userId,
        p_artist_names: names,
        p_lim: PAGE_SIZE,
        p_offset: offset,
      });
      const page = (data as AlbumCandidate[] | null) ?? [];
      // Only the first page shuffles — the RPC's ORDER BY must stay stable for
      // offset paging (same reasoning as iOS fetchAlbumPage).
      return offset === 0 ? shuffle(page) : page;
    },
    [userId, buildSeed],
  );

  const fetchSongs = useCallback(
    async (offset: number): Promise<SongCandidate[]> => {
      if (!supabase || !userId) return [];
      const names = await buildSeed();
      if (!names.length) return [];
      const { data } = await supabase.rpc('get_quick_add_song_candidates', {
        p_user_id: userId,
        p_artist_names: names,
        p_lim: PAGE_SIZE,
        p_offset: offset,
      });
      const page = (data as SongCandidate[] | null) ?? [];
      return offset === 0 ? shuffle(page) : page;
    },
    [userId, buildSeed],
  );

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [a, s] = await Promise.all([fetchAlbums(0), fetchSongs(0)]);
      if (cancelled) return;
      setAlbums(a);
      setSongs(s);
      setHasMoreAlbums(a.length === PAGE_SIZE);
      setHasMoreSongs(s.length === PAGE_SIZE);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, fetchAlbums, fetchSongs]);

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    if (mode === 'albums') {
      const next = await fetchAlbums(albums.length);
      setAlbums((prev) => [...prev, ...next]);
      setHasMoreAlbums(next.length === PAGE_SIZE);
    } else {
      const next = await fetchSongs(songs.length);
      setSongs((prev) => [...prev, ...next]);
      setHasMoreSongs(next.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  }

  /** Same write path as the album page's setRating (upsert; re-drags overwrite). */
  async function rateAlbum(id: string, score: number) {
    if (!supabase || !userId) return;
    setRatedScores((prev) => ({ ...prev, [id]: score }));
    await supabase
      .from('ratings')
      .upsert({ user_id: userId, release_group_id: id, score }, { onConflict: 'user_id,release_group_id' });
  }

  async function rateSong(id: string, score: number) {
    if (!supabase || !userId) return;
    setRatedScores((prev) => ({ ...prev, [id]: score }));
    await supabase
      .from('track_ratings')
      .upsert({ user_id: userId, recording_id: id, score }, { onConflict: 'user_id,recording_id' });
  }

  if (ratingMode === 'instinct') {
    return (
      <main className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-[17px] font-semibold text-ink">{t('sj.quickAdd.title')}</h1>
        <p className="mt-3 text-[14px] text-muted">{t('sj.quickAdd.manualOnly')}</p>
        <Link
          href="/settings"
          className="inline-block mt-5 px-5 py-2.5 rounded-xl bg-accent text-white text-[14px] font-semibold hover:opacity-90 transition"
        >
          {t('sj.nav.settings')}
        </Link>
      </main>
    );
  }

  const items = mode === 'albums' ? albums : songs;
  const hasMore = mode === 'albums' ? hasMoreAlbums : hasMoreSongs;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-16">
      <h1 className="sr-only">{t('sj.quickAdd.title')}</h1>

      {/* Albums / Songs toggle — same style as the Rankings toggle */}
      <div className="flex justify-center gap-7 py-3">
        {(['albums', 'songs'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`text-[17px] transition ${
              mode === m ? 'font-bold text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            {m === 'albums' ? t('sj.quickAdd.albums') : t('sj.quickAdd.songs')}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-24 text-center text-muted text-[14px]">…</div>
      ) : items.length === 0 ? (
        <div className="py-24 text-center">
          <CheckCircle2 className="w-11 h-11 mx-auto text-divider" strokeWidth={1.5} />
          <p className="mt-4 text-[17px] font-semibold text-ink">{t('sj.quickAdd.caughtUp')}</p>
          <p className="mt-1 text-[14px] text-muted">{t('sj.quickAdd.caughtUpBody')}</p>
        </div>
      ) : (
        <>
          <div className="rounded-2xl bg-surface border border-divider/60 divide-y divide-divider overflow-hidden">
            {mode === 'albums'
              ? albums.map((a) => (
                  <QuickAddRow
                    key={a.id}
                    coverUrl={a.cover_url}
                    href={`/album/${a.id}`}
                    title={displayName(a.title, a.native_title)}
                    subtitle={a.artist_display}
                    rated={ratedScores[a.id] ?? null}
                    onRate={(score) => rateAlbum(a.id, score)}
                  />
                ))
              : songs.map((s) => (
                  <QuickAddRow
                    key={s.id}
                    coverUrl={s.cover_url}
                    href={null}
                    title={s.title}
                    subtitle={s.artist_display}
                    rated={ratedScores[s.id] ?? null}
                    onRate={(score) => rateSong(s.id, score)}
                  />
                ))}
          </div>
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-4 w-full py-3 rounded-xl border border-divider text-[14px] font-semibold text-ink hover:bg-surface transition disabled:opacity-50"
            >
              {loadingMore ? '…' : t('sj.quickAdd.loadMore')}
            </button>
          )}
        </>
      )}
    </main>
  );
}

function QuickAddRow({
  coverUrl,
  href,
  title,
  subtitle,
  rated,
  onRate,
}: {
  coverUrl: string | null;
  href: string | null;
  title: string;
  subtitle: string;
  rated: number | null;
  onRate: (score: number) => void;
}) {
  const inner = (
    <>
      <Cover url={coverUrl} className="w-[52px] h-[52px] shrink-0" rounded="rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-ink truncate">{title}</p>
        <p className="text-[13px] text-muted truncate">{subtitle}</p>
      </div>
    </>
  );
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      {href ? (
        <Link href={href} className="flex items-center gap-3 min-w-0 flex-1 hover:opacity-80 transition">
          {inner}
        </Link>
      ) : (
        <div className="flex items-center gap-3 min-w-0 flex-1">{inner}</div>
      )}
      <FlowerRatingRow rating={rated} onRate={onRate} label={title} />
    </div>
  );
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
