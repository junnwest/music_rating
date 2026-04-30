'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';

type FeedItem = {
  type: 'rating' | 'review';
  userId: string;
  username: string;
  release: { id: string; title: string; artist: string; cover_url: string | null } | null;
  score?: number;
  body?: string;
  date: string;
  releaseId: string;
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export default function ActivityPage() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFiltered, setIsFiltered] = useState(false);

  useEffect(() => {
    const load = async () => {
      let userId: string | null = null;
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        userId = data.session?.user?.id ?? null;
      }

      const url = userId ? `/api/activity?userId=${userId}` : '/api/activity';
      const res = await fetch(url);
      const json = await res.json();
      setFeed(json.feed ?? []);
      setIsFiltered(json.isFiltered ?? false);
      setLoading(false);
    };
    load();
  }, []);

  const subtitle = isFiltered
    ? 'Recent activity from people you follow'
    : 'Recent ratings and reviews from the community';

  return (
    <div className="bg-white min-h-screen">
      <div className="bg-surface border-b border-[#EBEBEB]">
        <div className="max-w-[1440px] mx-auto px-5 py-8">
          <h1 className="text-[24px] font-extrabold text-ink" style={{ letterSpacing: '-0.6px' }}>
            Activity
          </h1>
          <p className="text-[13px] text-muted mt-1">{subtitle}</p>
        </div>
      </div>

      <div className="max-w-[720px] mx-auto px-5 py-9 pb-14">
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : feed.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[15px] font-bold text-ink mb-2">
              {isFiltered ? 'No activity from your follows yet' : 'No activity yet'}
            </p>
            {isFiltered && (
              <p className="text-[13px] text-muted">
                The people you follow haven&apos;t rated or reviewed anything recently.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col">
            {feed.map((item, i) => (
              <div key={i} className="flex gap-4 py-5 border-b border-[#EBEBEB] last:border-0">
                {/* Avatar */}
                <Link href={`/profile/${item.username}`} className="flex-shrink-0 mt-0.5">
                  <div className="w-8 h-8 rounded-full bg-mint-bg border border-mint flex items-center justify-center text-[11px] font-bold text-mint-dark hover:opacity-80 transition">
                    {item.username[0].toUpperCase()}
                  </div>
                </Link>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] leading-snug">
                        <Link href={`/profile/${item.username}`} className="font-semibold text-ink hover:text-mid transition">
                          {item.username}
                        </Link>
                        <span className="text-muted"> {item.type === 'rating' ? 'rated' : 'reviewed'} </span>
                        <Link href={`/album/${item.releaseId}`} className="font-semibold text-ink hover:text-mid transition">
                          {item.release?.title ?? '—'}
                        </Link>
                        {item.score && (
                          <span
                            className="inline-flex items-center ml-2 text-[10px] font-bold rounded-[4px] px-[6px] py-[1px] align-middle"
                            style={{ background: '#3DFFD1', color: '#00453A' }}
                          >
                            ★ {item.score}
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
                      <p className="text-[11px] text-muted mt-1.5">{timeAgo(item.date)}</p>
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
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
