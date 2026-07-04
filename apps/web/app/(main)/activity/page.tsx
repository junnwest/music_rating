'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';
import UserAvatar from '../../../components/UserAvatar';
import InlineStarRating from '../../../components/InlineStarRating';
import ReportBlockMenu from '../../../components/ReportBlockMenu';
import { useLanguage } from '../../../lib/i18n';
import type { AlbumRelease } from '../../../types';

type FeedItem = {
  type: 'rating' | 'review';
  userId: string;
  username: string;
  release: { id: string; title: string; artist: string; cover_url: string | null } | null;
  score?: number;
  body?: string;
  date: string;
  releaseId: string;
  ratingId: string | null;
};

function timeAgo(iso: string, t: (key: string) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return t('activity.justNow');
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function RecommendedFeed({ userId }: { userId: string | null }) {
  const [recs, setRecs] = useState<AlbumRelease[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const params = new URLSearchParams({ page: '0' });
      if (userId) params.set('excludeRated', 'true');
      const res = await fetch(`/api/recommendations?${params}`);
      const data = await res.json();
      setRecs((data.albums ?? []).slice(0, 10));
      setLoading(false);
    };
    load();
  }, [userId]);

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-3 items-center">
            <div className="w-10 h-10 rounded-[5px] bg-surface animate-pulse flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-surface animate-pulse rounded w-3/4" />
              <div className="h-2.5 bg-surface animate-pulse rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (recs.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {recs.map(album => (
        <div key={album.id} className="group">
          <div className="flex gap-3 items-center">
            <Link href={`/album/${album.id}`} className="flex-shrink-0">
              <div className="w-10 h-10 rounded-[5px] overflow-hidden bg-surface border border-divider">
                {album.coverUrl ? (
                  <img src={album.coverUrl} alt={album.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full" />
                )}
              </div>
            </Link>
            <div className="flex-1 min-w-0">
              <Link href={`/album/${album.id}`}>
                <p className="text-[12px] font-semibold text-ink truncate hover:text-amber-600 transition">{album.title}</p>
              </Link>
              <p className="text-[11px] text-muted truncate">{album.artist}</p>
            </div>
          </div>
          <div className="mt-1 pl-13" style={{ paddingLeft: 52 }}>
            <InlineStarRating
              releaseId={album.id}
              releaseTitle={album.title}
              releaseArtist={album.artist}
              releaseDate={album.date}
              releaseCountry={album.country}
              releaseType={album.releaseType}
              coverUrl={album.coverUrl ?? null}
              size={13}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ActivityPage() {
  const { t } = useLanguage();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFiltered, setIsFiltered] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      let uid: string | null = null;
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        uid = data.session?.user?.id ?? null;
        setUserId(uid);

        if (uid) {
          const { data: blocked } = await supabase
            .from('blocked_users')
            .select('blocked_id')
            .eq('blocker_id', uid);
          setBlockedIds(new Set((blocked ?? []).map((b: any) => b.blocked_id)));
        }
      }

      const url = uid ? `/api/activity?userId=${uid}` : '/api/activity';
      const res = await fetch(url);
      const json = await res.json();
      setFeed(json.feed ?? []);
      setIsFiltered(json.isFiltered ?? false);
      setLoading(false);
    };
    load();
  }, []);

  const visibleFeed = feed.filter((item) => !blockedIds.has(item.userId));

  const subtitle = isFiltered
    ? t('activity.subtitleFiltered')
    : t('activity.subtitleAll');

  return (
    <div className="bg-page min-h-screen">
      <div className="bg-surface border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-12">
          <p className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.7px' }}>
            {t('activity.community')}
          </p>
          <h1 className="text-[28px] sm:text-[38px] font-extrabold text-ink leading-[1.06]" style={{ letterSpacing: '-1.2px' }}>
            {t('activity.title')}
          </h1>
          <p className="text-[15px] text-muted mt-3 max-w-[500px] leading-relaxed">{subtitle}</p>
        </div>
      </div>

      <div className="max-w-[1100px] mx-auto px-5 py-10 pb-16 flex gap-10">
        {/* ── Feed ── */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="flex flex-col">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-4 py-5 border-b border-divider">
                  <div className="w-8 h-8 rounded-full bg-surface animate-pulse flex-shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3 bg-surface animate-pulse rounded w-3/4" />
                    <div className="h-2.5 bg-surface animate-pulse rounded w-1/2" />
                  </div>
                  <div className="w-[52px] h-[52px] rounded-[5px] bg-surface animate-pulse flex-shrink-0" />
                </div>
              ))}
            </div>
          ) : visibleFeed.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-[15px] font-bold text-ink mb-2">
                {isFiltered ? t('activity.noActivityFollows') : t('activity.noActivity')}
              </p>
              {isFiltered && (
                <p className="text-[13px] text-muted">
                  {t('activity.noActivityFollowsDesc')}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col">
              {visibleFeed.map((item, i) => (
                <div key={i} className="flex gap-4 py-5 border-b border-divider last:border-0">
                  <Link href={`/profile/${item.username}`} className="flex-shrink-0 mt-0.5 hover:opacity-80 transition">
                    <UserAvatar size={32} />
                  </Link>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] leading-snug">
                          <Link href={`/profile/${item.username}`} className="font-semibold text-ink hover:text-mid transition">
                            {item.username}
                          </Link>
                          <span className="text-muted"> {item.type === 'rating' ? t('activity.rated') : t('activity.commentedOn')} </span>
                          <Link href={`/album/${item.releaseId}`} className="font-semibold text-ink hover:text-mid transition">
                            {item.release?.title ?? '—'}
                          </Link>
                          {item.score && (
                            <span
                              className="inline-flex items-center ml-2 text-[10px] font-bold rounded-[4px] px-[6px] py-[1px] align-middle"
                              style={{ background: '#E8A020', color: '#7A4F0A' }}
                            >
                              ★ {Number(item.score).toFixed(1)}
                            </span>
                          )}
                        </p>
                        {item.release?.artist && (
                          <p className="text-[12px] text-muted mt-0.5">{item.release.artist}</p>
                        )}
                        {item.type === 'review' && item.body && (
                          <p className="text-[13px] text-mid mt-2 leading-relaxed line-clamp-2 italic">
                            &ldquo;{item.body}&rdquo;
                          </p>
                        )}
                        <p className="text-[11px] text-muted mt-1.5">{timeAgo(item.date, t)}</p>
                      </div>

                      {item.release?.cover_url && (
                        <Link href={`/album/${item.releaseId}`} className="flex-shrink-0">
                          <img
                            src={item.release.cover_url}
                            alt={item.release.title ?? ''}
                            className="w-[52px] h-[52px] rounded-[5px] object-cover"
                          />
                        </Link>
                      )}

                      {userId && userId !== item.userId && (
                        <ReportBlockMenu
                          reportedUserId={item.userId}
                          ratingId={item.type === 'rating' ? item.ratingId : null}
                          onBlocked={() => setBlockedIds((prev) => new Set(prev).add(item.userId))}
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Recommended sidebar ── */}
        <aside className="hidden lg:block w-[220px] flex-shrink-0">
          <div className="sticky top-[78px]">
            <p className="text-[11px] font-bold text-muted uppercase mb-4" style={{ letterSpacing: '0.6px' }}>
              Recommended for You
            </p>
            <RecommendedFeed userId={userId} />
          </div>
        </aside>
      </div>
    </div>
  );
}
