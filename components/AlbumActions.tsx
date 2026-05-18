'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, Plus, Bookmark, Pin, Trophy, BookmarkCheck, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

const LL_KEY = 'sillajuku:listen-later';
const PINNED_MAX = 6;
const PIN_ROWS = [[0], [1, 2], [3, 4, 5]];
const PIN_SIZES = [108, 92, 80];

// ── ranking filter constants (mirrors FilterBuilder) ─────────────────────────
const filterCountries = [
  'Global', 'South Korea', 'Japan', 'United States', 'United Kingdom',
  'Canada', 'Australia', 'France', 'Germany', 'Brazil', 'Nigeria',
];
const genresByCountry: Record<string, string[]> = {
  'Global':         ['All Genres', 'Hip-Hop', 'R&B', 'Pop', 'Indie', 'Rock', 'Jazz', 'Electronic', 'Folk', 'Alternative', 'Classical'],
  'South Korea':    ['All Genres', 'K-Pop', 'K-Hip-Hop', 'R&B', 'Indie', 'Rock'],
  'Japan':          ['All Genres', 'J-Pop', 'City Pop', 'Rock', 'Indie', 'Electronic', 'Hip-Hop'],
  'United States':  ['All Genres', 'Hip-Hop', 'R&B', 'Pop', 'Indie', 'Rock', 'Country', 'Jazz', 'Electronic'],
  'United Kingdom': ['All Genres', 'Pop', 'Indie', 'Rock', 'Electronic', 'Hip-Hop', 'R&B'],
  'Canada':         ['All Genres', 'Hip-Hop', 'Pop', 'Indie', 'Rock', 'R&B'],
  'Australia':      ['All Genres', 'Pop', 'Indie', 'Rock', 'Hip-Hop', 'Electronic'],
  'France':         ['All Genres', 'Chanson', 'Pop', 'Electronic', 'Jazz', 'Hip-Hop', 'Indie'],
  'Germany':        ['All Genres', 'Electronic', 'Rock', 'Pop', 'Hip-Hop', 'Jazz'],
  'Brazil':         ['All Genres', 'Samba', 'Bossa Nova', 'MPB', 'Funk', 'Hip-Hop', 'Rock', 'Electronic'],
  'Nigeria':        ['All Genres', 'Afrobeats', 'Hip-Hop', 'R&B', 'Pop'],
};
const filterTimes = [
  'All Time', '2026', '2025', '2024', '2020s', '2010s', '2000s', '1990s', '1980s', '1970s', '1960s',
];

function inferCategoryCountry(genre: string | null, title: string): string {
  if (genre?.startsWith('K-') || title.toLowerCase().includes('korean')) return 'South Korea';
  if (genre?.startsWith('J-') || title.toLowerCase().includes('japanese')) return 'Japan';
  return 'Global';
}

function timeToYear(time: string): number | null | undefined {
  if (time === 'All Time') return null;
  const n = parseInt(time);
  if (!isNaN(n) && n > 2000 && n < 2100) return n;
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  albumId: string;
  albumTitle: string;
  albumArtist: string;
  coverUrl?: string | null;
}

interface PinnedAlbum {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
}

interface RankingCategory {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  genre: string | null;
  year: number | null;
}

export default function AlbumActions({ albumId, albumTitle, albumArtist, coverUrl }: Props) {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [pinnedFull, setPinnedFull] = useState(false);
  const [pinnedAlbums, setPinnedAlbums] = useState<PinnedAlbum[]>([]);
  const [listenLater, setListenLater] = useState(false);
  const [pinnedLoading, setPinnedLoading] = useState(false);
  const [userScore, setUserScore] = useState<number | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showPinSwapModal, setShowPinSwapModal] = useState(false);
  const [showPinConfirm, setShowPinConfirm] = useState(false);
  const [pendingSwapRemoveId, setPendingSwapRemoveId] = useState<string | null>(null);
  const [showRankModal, setShowRankModal] = useState(false);

  // ranking filter state
  const [categories, setCategories] = useState<RankingCategory[]>([]);
  const [loadingCats, setLoadingCats] = useState(false);
  const [rankCountry, setRankCountry] = useState('South Korea');
  const [rankGenre, setRankGenre] = useState('All Genres');
  const [rankTime, setRankTime] = useState('All Time');
  const [myRankedCategoryIds, setMyRankedCategoryIds] = useState<Set<string>>(new Set());

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem(LL_KEY) ?? '[]') as string[];
    setListenLater(saved.includes(albumId));
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);
      if (uid) {
        checkPinned(uid);
        supabase!.from('ratings').select('score').eq('user_id', uid).eq('release_id', albumId).maybeSingle()
          .then(({ data: r }) => setUserScore(r?.score ?? null));
      }
    });
  }, [albumId]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  const checkPinned = async (uid: string) => {
    if (!supabase) return;
    const { data: pinnedRows } = await supabase
      .from('pinned_albums')
      .select('release_id')
      .eq('user_id', uid);
    const ids = (pinnedRows ?? []).map((r: any) => r.release_id as string);
    setPinned(ids.includes(albumId));
    setPinnedFull(ids.length >= PINNED_MAX);
    if (ids.length > 0) {
      const { data: releaseRows } = await supabase
        .from('releases')
        .select('id, title, artist, cover_url')
        .in('id', ids);
      const relMap = new Map((releaseRows ?? []).map((r: any) => [r.id, r]));
      setPinnedAlbums(ids.map((id) => {
        const rel = relMap.get(id);
        return { id, title: rel?.title ?? id, artist: rel?.artist ?? '', coverUrl: rel?.cover_url ?? null };
      }));
    }
  };

  const ensureRelease = async () => {
    if (!supabase) return;
    await supabase.from('releases').upsert(
      { id: albumId, title: albumTitle, artist: albumArtist, cover_url: coverUrl ?? null },
      { onConflict: 'id', ignoreDuplicates: true }
    );
  };

  const requestPin = (removeId?: string) => {
    // Gate behind confirmation when score isn't already 5
    if (userScore !== 5) {
      setPendingSwapRemoveId(removeId ?? null);
      setShowPinSwapModal(false);
      setShowPinConfirm(true);
    } else {
      void commitPin(removeId ?? null);
    }
  };

  const commitPin = async (removeId: string | null) => {
    if (!userId || !supabase) return;
    setPinnedLoading(true);
    await ensureRelease();
    await supabase.from('releases').upsert(
      { id: albumId, title: albumTitle, artist: albumArtist, cover_url: coverUrl ?? null },
      { onConflict: 'id', ignoreDuplicates: true }
    );
    await supabase.from('ratings').upsert(
      { user_id: userId, release_id: albumId, score: 5, status: 'Listened' },
      { onConflict: 'user_id,release_id' }
    );
    if (removeId) {
      await supabase.from('pinned_albums').delete().eq('user_id', userId).eq('release_id', removeId);
    }
    const { error } = await supabase.from('pinned_albums').insert({ user_id: userId, release_id: albumId });
    if (!error) {
      setPinned(true);
      setUserScore(5);
      if (removeId) {
        setPinnedAlbums(prev => [
          ...prev.filter(a => a.id !== removeId),
          { id: albumId, title: albumTitle, artist: albumArtist, coverUrl: coverUrl ?? null },
        ]);
      } else {
        setPinnedFull(pinnedAlbums.length + 1 >= PINNED_MAX);
        setPinnedAlbums(prev => [...prev, { id: albumId, title: albumTitle, artist: albumArtist, coverUrl: coverUrl ?? null }]);
      }
    }
    setPinnedLoading(false);
    setShowPinConfirm(false);
    setDropdownOpen(false);
  };

  const handlePinnedClick = () => {
    if (!userId || !supabase || pinnedLoading) return;
    if (pinned) {
      setPinnedLoading(true);
      supabase.from('pinned_albums').delete().eq('user_id', userId).eq('release_id', albumId).then(() => {
        setPinned(false);
        setPinnedFull(false);
        setPinnedAlbums(prev => prev.filter(a => a.id !== albumId));
        setPinnedLoading(false);
        setDropdownOpen(false);
      });
    } else if (pinnedFull) {
      setDropdownOpen(false);
      setShowPinSwapModal(true);
    } else {
      setDropdownOpen(false);
      requestPin();
    }
  };

  const toggleListenLater = () => {
    const saved = JSON.parse(localStorage.getItem(LL_KEY) ?? '[]') as string[];
    const next = saved.includes(albumId) ? saved.filter(id => id !== albumId) : [...saved, albumId];
    localStorage.setItem(LL_KEY, JSON.stringify(next));
    setListenLater(!listenLater);
    setDropdownOpen(false);
  };

  const openRankModal = async () => {
    setDropdownOpen(false);
    setShowRankModal(true);
    if (categories.length === 0 && !loadingCats && supabase) {
      setLoadingCats(true);
      const { data } = await supabase
        .from('ranking_categories')
        .select('id, slug, title, description, genre, year')
        .order('sort_order')
        .order('created_at');
      setCategories(data ?? []);
      setLoadingCats(false);
    }
    // Refresh which rankings the user has already placed this album in
    if (userId && supabase) {
      const { data: userRankings } = await supabase
        .from('user_rankings')
        .select('id, category_id')
        .eq('user_id', userId);
      if (userRankings && userRankings.length > 0) {
        const rankingIds = userRankings.map(r => r.id);
        const { data: entries } = await supabase
          .from('user_ranking_entries')
          .select('ranking_id')
          .eq('release_id', albumId)
          .in('ranking_id', rankingIds);
        const rankedRankingIds = new Set((entries ?? []).map(e => e.ranking_id));
        setMyRankedCategoryIds(new Set(
          userRankings.filter(r => rankedRankingIds.has(r.id)).map(r => r.category_id)
        ));
      } else {
        setMyRankedCategoryIds(new Set());
      }
    }
  };

  const goToRanking = (slug: string) => {
    const params = new URLSearchParams({ album: albumId, title: albumTitle, artist: albumArtist });
    if (coverUrl) params.set('cover', coverUrl);
    router.push(`/rankings/${slug}/rank?${params}`);
    setShowRankModal(false);
  };

  const rankAvailableGenres = genresByCountry[rankCountry] ?? genresByCountry['Global'];

  const matchedCategory = useMemo(() => {
    const year = timeToYear(rankTime);
    if (year === undefined) return null;
    return categories.find((cat) => {
      const catCountry = inferCategoryCountry(cat.genre, cat.title);
      const countryMatch = catCountry === rankCountry;
      const genreMatch = rankGenre === 'All Genres' ? cat.genre === null : cat.genre === rankGenre;
      const yearMatch = cat.year === year;
      return countryMatch && genreMatch && yearMatch;
    }) ?? null;
  }, [rankCountry, rankGenre, rankTime, categories]);

  const hasAny = listenLater || pinned;

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(o => !o)}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-bold border transition ${
            hasAny ? 'bg-mint text-mint-dark border-mint' : 'bg-page border-divider text-ink hover:bg-surface'
          }`}
        >
          {hasAny ? <Check size={14} /> : <Plus size={14} />}
          Add
          <ChevronRight size={13} className={`transition-transform ${dropdownOpen ? 'rotate-90' : ''}`} />
        </button>

        {dropdownOpen && (
          <div className="absolute top-full right-0 mt-1.5 bg-page border border-divider rounded-xl shadow-lg z-30 min-w-[200px] py-1">
            <button
              onClick={toggleListenLater}
              className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-ink hover:bg-surface w-full text-left transition"
            >
              {listenLater ? <BookmarkCheck size={15} className="text-mint-dark" /> : <Bookmark size={15} className="text-muted" />}
              <span className="flex-1">Listen Later</span>
              {listenLater && <Check size={13} className="text-mint-dark" />}
            </button>

            {userId && (
              <button
                onClick={handlePinnedClick}
                disabled={pinnedLoading}
                className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-ink hover:bg-surface w-full text-left transition disabled:opacity-40"
              >
                <Pin size={15} className={pinned ? 'text-mint-dark' : 'text-muted'} />
                <span className="flex-1">Essentials</span>
                {pinned
                  ? <Check size={13} className="text-mint-dark" />
                  : pinnedFull
                  ? <ChevronRight size={13} className="text-muted" />
                  : null}
              </button>
            )}

            {userId && (
              <button
                onClick={openRankModal}
                className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-ink hover:bg-surface w-full text-left transition"
              >
                <Trophy size={15} className="text-muted" />
                <span className="flex-1">Add to Ranking</span>
                <ChevronRight size={13} className="text-muted" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Essentials swap modal ───────────────────────────────── */}
      {showPinSwapModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowPinSwapModal(false)}
        >
          <div
            className="bg-page rounded-2xl shadow-2xl w-full max-w-[420px] mx-4 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between px-5 pt-5 pb-1">
              <div>
                <p className="text-[15px] font-bold text-ink">Replace from Essentials</p>
                <p className="text-[12px] text-muted mt-0.5">
                  Pick an album to swap with <span className="font-semibold text-ink">{albumTitle}</span>
                </p>
              </div>
              <button
                onClick={() => setShowPinSwapModal(false)}
                className="text-muted hover:text-ink transition p-1 flex-shrink-0"
              >
                <X size={18} />
              </button>
            </div>

            {/* Pyramid */}
            <div className="flex flex-col items-center gap-3 py-5 px-4">
              {PIN_ROWS.map((positions, rowIdx) => {
                const size = PIN_SIZES[rowIdx];
                return (
                  <div key={rowIdx} className="flex gap-3">
                    {positions.map(pos => {
                      const album = pinnedAlbums[pos];
                      if (!album) return (
                        <div
                          key={pos}
                          style={{ width: size, height: size }}
                          className="rounded-[8px] border-2 border-dashed border-[#DDDDD8] flex-shrink-0"
                        />
                      );
                      return (
                        <button
                          key={pos}
                          onClick={() => requestPin(album.id)}
                          disabled={pinnedLoading}
                          style={{ width: size, height: size }}
                          className="group/pin flex-shrink-0 relative rounded-[8px] overflow-hidden bg-surface border-2 border-divider disabled:opacity-50 focus:outline-none"
                        >
                          {album.coverUrl
                            ? <img src={album.coverUrl} alt={album.title} className="w-full h-full object-cover" draggable={false} />
                            : <div className="w-full h-full bg-surface" />
                          }
                          <div className="absolute inset-0 bg-black/0 group-hover/pin:bg-black/40 transition flex items-center justify-center">
                            <X
                              size={size > 90 ? 22 : 16}
                              className="text-white opacity-0 group-hover/pin:opacity-100 transition"
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Pin confirmation modal ─────────────────────────────── */}
      {showPinConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowPinConfirm(false)}
        >
          <div
            className="bg-page rounded-2xl shadow-2xl w-full max-w-[380px] mx-4 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6">
              {/* Album preview */}
              <div className="flex items-start gap-4 mb-5">
                <div className="w-[56px] h-[56px] rounded-[8px] overflow-hidden flex-shrink-0 bg-surface border border-divider">
                  {coverUrl
                    ? <img src={coverUrl} alt={albumTitle} className="w-full h-full object-cover" />
                    : <div className="w-full h-full bg-surface" />
                  }
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <p className="text-[14px] font-bold text-ink truncate">{albumTitle}</p>
                  <p className="text-[12px] text-muted truncate">{albumArtist}</p>
                  {userScore !== null && (
                    <p className="text-[12px] text-muted mt-1">
                      Current rating: <span className="font-semibold text-ink">★ {Number(userScore).toFixed(1)}</span>
                    </p>
                  )}
                </div>
              </div>
              <p className="text-[14px] font-bold text-ink mb-1">Pin this album?</p>
              <p className="text-[13px] text-muted mb-6 leading-relaxed">
                {userScore !== null
                  ? `Your current rating of ★ ${userScore} will be updated to ★ 5.`
                  : 'This album will be added to your catalog with a rating of ★ 5.'}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowPinConfirm(false)}
                  className="flex-1 border border-divider rounded-xl py-2.5 text-[13px] font-semibold text-ink hover:bg-surface transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => commitPin(pendingSwapRemoveId)}
                  disabled={pinnedLoading}
                  className="flex-1 bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-xl py-2.5 text-[13px] font-semibold hover:opacity-80 transition disabled:opacity-50"
                >
                  {pinnedLoading ? 'Saving…' : 'Confirm & set ★ 5'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add to Ranking modal ────────────────────────────────── */}
      {showRankModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowRankModal(false)}
        >
          <div
            className="bg-page rounded-2xl shadow-2xl w-full max-w-[500px] mx-4 overflow-hidden max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-divider flex-shrink-0">
              <div className="min-w-0 pr-4">
                <p className="text-[15px] font-bold text-ink">Add to Ranking</p>
                <p className="text-[12px] text-muted mt-0.5 truncate">
                  {albumTitle} · {albumArtist}
                </p>
              </div>
              <button
                onClick={() => setShowRankModal(false)}
                className="text-muted hover:text-ink transition p-1 flex-shrink-0"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto">
              {/* Top 6 rankings */}
              <div className="px-5 pt-4 pb-3">
                <p className="text-[10px] font-bold text-muted uppercase mb-3" style={{ letterSpacing: '0.6px' }}>
                  Top Rankings
                </p>
                {loadingCats ? (
                  <div className="flex flex-col gap-1">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-10 rounded-lg bg-surface animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {categories.slice(0, 6).map(cat => {
                      const alreadyRanked = myRankedCategoryIds.has(cat.id);
                      return (
                        <button
                          key={cat.slug}
                          onClick={() => goToRanking(cat.slug)}
                          className="flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-lg hover:bg-surface transition"
                        >
                          <Trophy size={13} className={`flex-shrink-0 ${alreadyRanked ? 'text-[#E8A020]' : 'text-muted'}`} />
                          <span className="flex-1 text-[13px] font-semibold text-ink truncate">{cat.title}</span>
                          {alreadyRanked
                            ? <Check size={13} className="text-[#E8A020] flex-shrink-0" />
                            : <ChevronRight size={13} className="text-muted flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="mx-5 border-t border-divider" />

              {/* Browse filter */}
              <div className="px-5 pt-4 pb-5">
                <p className="text-[10px] font-bold text-muted uppercase mb-3" style={{ letterSpacing: '0.6px' }}>
                  Browse Rankings
                </p>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div>
                    <label className="block text-[10px] font-semibold text-muted uppercase mb-1.5" style={{ letterSpacing: '0.5px' }}>Country</label>
                    <select
                      value={rankCountry}
                      onChange={e => { setRankCountry(e.target.value); setRankGenre('All Genres'); }}
                      className="w-full bg-surface border border-divider rounded-lg px-3 py-2 text-[12px] text-ink outline-none cursor-pointer hover:border-mid transition"
                    >
                      {filterCountries.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-muted uppercase mb-1.5" style={{ letterSpacing: '0.5px' }}>Genre</label>
                    <select
                      value={rankGenre}
                      onChange={e => setRankGenre(e.target.value)}
                      className="w-full bg-surface border border-divider rounded-lg px-3 py-2 text-[12px] text-ink outline-none cursor-pointer hover:border-mid transition"
                    >
                      {rankAvailableGenres.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-muted uppercase mb-1.5" style={{ letterSpacing: '0.5px' }}>Time</label>
                    <select
                      value={rankTime}
                      onChange={e => setRankTime(e.target.value)}
                      className="w-full bg-surface border border-divider rounded-lg px-3 py-2 text-[12px] text-ink outline-none cursor-pointer hover:border-mid transition"
                    >
                      {filterTimes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>

                {loadingCats ? (
                  <div className="h-12 rounded-xl bg-surface animate-pulse" />
                ) : matchedCategory ? (
                  <div className="border border-divider rounded-xl px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[14px] font-extrabold text-ink truncate" style={{ letterSpacing: '-0.3px' }}>
                          {matchedCategory.title}
                        </p>
                        {myRankedCategoryIds.has(matchedCategory.id) && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#E8A020] flex-shrink-0">
                            <Check size={10} />
                            Ranked
                          </span>
                        )}
                      </div>
                      {matchedCategory.description && (
                        <p className="text-[11px] text-muted mt-0.5 truncate">{matchedCategory.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => goToRanking(matchedCategory.slug)}
                      className="text-[12px] font-semibold text-ink border border-divider rounded-lg px-4 py-1.5 hover:bg-surface transition whitespace-nowrap flex-shrink-0"
                    >
                      Rank →
                    </button>
                  </div>
                ) : (
                  <p className="text-[13px] text-muted">No ranking for this combination yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
