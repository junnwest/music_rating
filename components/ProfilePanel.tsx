'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';

type ReleaseType = 'All' | 'Albums' | 'EPs' | 'Singles' | 'Compilations';
const TABS: ReleaseType[] = ['All', 'Albums', 'EPs', 'Singles', 'Compilations'];

function TypePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-surface border border-[#EBEBEB] text-[11px] font-medium text-muted">
      {children}
    </span>
  );
}

function ScoreBar({ bars }: { bars: number[] }) {
  const max = Math.max(...bars, 1);
  return (
    <div>
      <div className="flex gap-[3px] items-end h-[72px]">
        {bars.map((h, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end">
            <div
              className="w-full rounded-[2px_2px_0_0]"
              style={{
                height: `${(h / max) * 72}px`,
                background: i >= 7 ? '#3DFFD1' : '#EBEBEB',
                minHeight: h > 0 ? 2 : 0,
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-muted">½★</span>
        <span className="text-[10px] text-muted">5★</span>
      </div>
    </div>
  );
}

interface CommunityStats {
  percentile: number;
  communityAvg: number;
}

function getTasteDNA(ratings: any[]): string[] {
  if (!ratings || ratings.length < 5) return [];

  const scores = ratings.map((r) => r.score).filter(Boolean) as number[];
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / scores.length;
  const sd = Math.sqrt(variance);
  const fivePct = scores.filter((s) => s === 5).length / scores.length;

  // Tally genres across all rated releases
  const genreCount = new Map<string, number>();
  for (const r of ratings) {
    const genreStr = r.releases?.genres as string | null;
    if (!genreStr) continue;
    for (const g of genreStr.split(',')) {
      const g2 = g.trim().toLowerCase();
      if (g2) genreCount.set(g2, (genreCount.get(g2) ?? 0) + 1);
    }
  }
  const topGenre = [...genreCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  let genreTag = '';
  if (topGenre.includes('k-pop') || topGenre.includes('korean pop')) genreTag = 'K-Pop devotee';
  else if (topGenre.includes('k-r&b') || topGenre.includes('korean r&b')) genreTag = 'K-R&B connoisseur';
  else if (topGenre.includes('k-rap') || topGenre.includes('korean hip')) genreTag = 'K-Rap head';
  else if (topGenre.includes('r&b') || topGenre.includes('soul')) genreTag = 'R&B connoisseur';
  else if (topGenre.includes('indie')) genreTag = 'Indie explorer';
  else if (topGenre.includes('rap') || topGenre.includes('hip hop') || topGenre.includes('hip-hop')) genreTag = 'Hip-hop head';
  else if (topGenre.includes('ballad')) genreTag = 'Ballad purist';
  else if (topGenre.includes('jazz')) genreTag = 'Jazz aficionado';
  else if (topGenre.includes('rock')) genreTag = 'Rock loyalist';
  else if (topGenre.includes('electronic') || topGenre.includes('synth')) genreTag = 'Electronic wanderer';
  else if (topGenre.includes('folk') || topGenre.includes('acoustic')) genreTag = 'Folk purist';
  else if (topGenre.includes('classical')) genreTag = 'Classical devotee';
  else if (topGenre.includes('pop')) genreTag = 'Pop enthusiast';

  let behaviorTag = '';
  if (avg < 2.5) behaviorTag = 'Harsh critic';
  else if (avg > 4.3) behaviorTag = 'Eternal optimist';
  else if (fivePct === 0 && scores.length >= 10) behaviorTag = 'Impossible to impress';
  else if (fivePct > 0.35) behaviorTag = 'Generous soul';
  else if (sd > 1.4) behaviorTag = 'All or nothing';
  else if (sd < 0.5 && scores.length >= 10) behaviorTag = 'Measured listener';

  return [genreTag, behaviorTag].filter(Boolean);
}

function getRatingInsights(ratings: any[], communityStats: CommunityStats | null): string[] {
  const scores = (ratings ?? []).map((r) => r.score).filter(Boolean) as number[];
  if (scores.length < 3) return [];

  const insights: string[] = [];
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  // Strictness vs community
  if (communityStats && scores.length >= 5) {
    const p = communityStats.percentile;
    if (p <= 25) insights.push(`You rate harder than ${100 - p}% of users`);
    else if (p >= 75) insights.push(`You're more generous than ${p}% of users`);
    else insights.push(`Your ratings land close to the community average`);
  }

  // Perfect score rarity
  const fiveCount = scores.filter((s) => s === 5).length;
  const fivePct = fiveCount / scores.length;
  if (fiveCount === 0) insights.push(`You've never given a perfect score`);
  else if (fivePct < 0.05) insights.push(`Perfect scores are rare for you — only ${fiveCount} given`);
  else if (fivePct > 0.3) insights.push(`${Math.round(fivePct * 100)}% of your ratings are perfect scores`);

  // Low score tendency
  const lowCount = scores.filter((s) => s <= 2).length;
  const lowPct = lowCount / scores.length;
  if (lowPct > 0.25) insights.push(`You're not afraid to rate low — ${Math.round(lowPct * 100)}% are 2★ or below`);

  // Polarizing vs consistent
  if (scores.length >= 10) {
    const variance = scores.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / scores.length;
    const sd = Math.sqrt(variance);
    if (sd > 1.4) insights.push(`Your taste is polarizing — you love or hate almost everything`);
    else if (sd < 0.6) insights.push(`You're a measured rater — rarely surprised or disappointed`);
  }

  return insights.slice(0, 3);
}

export default function ProfilePanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [ratings, setRatings] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ReleaseType>('All');
  const [communityStats, setCommunityStats] = useState<CommunityStats | null>(null);

  const ratingsCount = ratings?.length ?? 0;
  const averageRating =
    ratingsCount > 0
      ? Math.round((ratings!.reduce((s: number, r: any) => s + (r.score || 0), 0) / ratingsCount) * 10) / 10
      : 0;

  // Score distribution (10 bars: 0.5 → 5.0)
  const bars = Array.from({ length: 10 }, (_, i) => {
    const target = (i + 1) * 0.5;
    return ratings?.filter((r) => r.score === target).length ?? 0;
  });

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        fetchRatings(data.session.user.id);
      } else {
        setLoading(false);
      }
    });
  }, []);

  const fetchRatings = async (userId: string) => {
    if (!supabase) { setLoading(false); return; }

    const [{ data }, { data: allRatings }] = await Promise.all([
      supabase
        .from('ratings')
        .select('id, score, status, note, created_at, release_id, releases(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('ratings')
        .select('user_id, score'),
    ]);

    setRatings(data ?? []);

    // Compute percentile from community data
    if (allRatings && allRatings.length > 0) {
      const userMap = new Map<string, number[]>();
      for (const r of allRatings) {
        if (!r.score) continue;
        if (!userMap.has(r.user_id)) userMap.set(r.user_id, []);
        userMap.get(r.user_id)!.push(r.score);
      }
      const userAvgs = [...userMap.entries()].map(([id, scores]) => ({
        id,
        avg: scores.reduce((a: number, b: number) => a + b, 0) / scores.length,
      }));
      const currentAvg = userAvgs.find((u) => u.id === userId)?.avg ?? null;
      const allScores = allRatings.map((r) => r.score).filter(Boolean) as number[];
      const communityAvg = allScores.reduce((a, b) => a + b, 0) / allScores.length;

      if (currentAvg !== null && userAvgs.length > 1) {
        const below = userAvgs.filter((u) => u.avg < currentAvg).length;
        const percentile = Math.round((below / (userAvgs.length - 1)) * 100);
        setCommunityStats({ percentile, communityAvg: Math.round(communityAvg * 10) / 10 });
      }
    }

    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="max-w-[1440px] mx-auto px-5 py-16 text-center">
        <p className="text-xl font-bold text-ink mb-2">Sign in to view your profile</p>
        <p className="text-sm text-muted mb-8">Track your album ratings, build your music catalog, and discover new recommendations.</p>
        <Link
          href="/login"
          className="inline-flex rounded-lg bg-ink px-6 py-3 text-sm font-semibold text-white hover:opacity-80 transition"
        >
          Go to login
        </Link>
      </div>
    );
  }

  const username = session.user.email?.split('@')[0] ?? '—';
  const initial = session.user.email?.[0].toUpperCase() ?? '?';

  const filteredRatings = (ratings ?? []).filter((r) => {
    if (activeTab === 'All') return true;
    const type = r.releases?.release_type ?? '';
    if (activeTab === 'Albums') return type === 'Album';
    if (activeTab === 'EPs') return type === 'EP';
    if (activeTab === 'Singles') return type === 'Single';
    if (activeTab === 'Compilations') return type === 'Compilation';
    return true;
  });

  const insights = getRatingInsights(ratings ?? [], communityStats);
  const tasteDNA = getTasteDNA(ratings ?? []);

  return (
    <div className="bg-white">
      {/* ── HEADER ─────────────────────────────────────────── */}
      <div className="bg-surface border-b border-[#EBEBEB]">
        <div className="max-w-[1440px] mx-auto px-5 pt-9 pb-0 flex gap-6 items-start">
          {/* Avatar */}
          <div
            className="w-[82px] h-[82px] rounded-full bg-mint-bg border-2 border-mint flex items-center justify-center flex-shrink-0 font-bold text-mint-dark text-[30px]"
          >
            {initial}
          </div>

          {/* Info */}
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h1
                className="text-[24px] font-extrabold text-ink"
                style={{ letterSpacing: '-0.6px' }}
              >
                {username}
              </h1>
            </div>
            <p className="text-[13px] text-muted">Member · {session.user.email}</p>

            {/* Stats */}
            <div className="flex gap-8 mt-[18px]">
              {[
                [ratingsCount, 'albums rated'],
                [`${averageRating || '—'} ★`, 'avg score'],
                ['0', 'reviews'],
                ['0', 'followers'],
                ['0', 'following'],
              ].map(([val, label]) => (
                <div key={label as string}>
                  <div className="text-[20px] font-bold text-ink">{val}</div>
                  <div className="text-[12px] text-muted mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button className="border border-[#EBEBEB] rounded-lg px-[18px] py-[9px] text-[13px] font-semibold text-ink hover:bg-surface transition">
              Edit profile
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-[1440px] mx-auto px-5 flex mt-5 border-t border-[#EBEBEB]">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-3 text-[13px] font-semibold border-b-2 transition ${
                activeTab === tab
                  ? 'text-ink border-ink'
                  : 'text-muted border-transparent hover:text-mid'
              }`}
            >
              {tab}
            </button>
          ))}
          <div className="flex-1" />
          <div className="self-center text-[12px] font-medium text-muted">Sort: Recently rated ↓</div>
        </div>
      </div>

      {/* ── BODY ─────────────────────────────────────────────── */}
      <div
        className="max-w-[1440px] mx-auto px-5 py-9 pb-14 grid gap-12"
        style={{ gridTemplateColumns: '1fr 240px' }}
      >
        {/* Album grid */}
        <div>
          {filteredRatings.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-muted">No ratings yet. Search for albums and rate them.</p>
            </div>
          ) : (
            <div className="grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
              {filteredRatings.map((rating) => (
                <Link key={rating.id} href={`/album/${rating.release_id}`} className="block min-w-0">
                  <div className="relative overflow-hidden rounded-[6px]" style={{ aspectRatio: '1 / 1' }}>
                    {rating.releases?.cover_url ? (
                      <img
                        src={rating.releases.cover_url}
                        alt={rating.releases.title}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-surface border border-[#EBEBEB]" />
                    )}
                    {rating.score && (
                      <div
                        className="absolute bottom-1 right-1 text-[10px] font-bold rounded-[4px] px-[6px] py-[1px]"
                        style={{ background: '#3DFFD1', color: '#00453A' }}
                      >
                        ★ {rating.score}
                      </div>
                    )}
                  </div>
                  <div
                    className="mt-[7px] text-[11px] font-semibold text-ink truncate"
                    title={rating.releases?.title}
                  >
                    {rating.releases?.title ?? rating.release_id}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div>
          {/* Score Distribution */}
          <div className="text-[15px] font-bold text-ink mb-[14px]">Score Distribution</div>
          <ScoreBar bars={bars} />

          <div className="h-px bg-[#EBEBEB] my-5" />

          {/* Rating Philosophy */}
          <div className="text-[15px] font-bold text-ink mb-3">Rating Philosophy</div>
          {insights.length > 0 ? (
            <div className="flex flex-col gap-2">
              {insights.map((insight, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-mint font-bold flex-shrink-0">—</span>
                  <p className="text-[12px] text-mid leading-snug">{insight}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-muted">Rate more albums to unlock insights.</p>
          )}

          <div className="h-px bg-[#EBEBEB] my-5" />

          {/* Taste DNA */}
          <div className="text-[15px] font-bold text-ink mb-3">Taste DNA</div>
          {tasteDNA.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {tasteDNA.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center px-[10px] py-[4px] rounded-full text-[12px] font-semibold"
                  style={{ background: '#EDFFF9', border: '1.5px solid #3DFFD1', color: '#00453A' }}
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-muted">Rate more albums to reveal your taste DNA.</p>
          )}

          <div className="h-px bg-[#EBEBEB] my-5" />

          {/* Listen Later placeholder */}
          <div className="text-[15px] font-bold text-ink mb-3">Listen Later</div>
          <p className="text-[12px] text-muted">Nothing queued yet.</p>

          <div className="h-px bg-[#EBEBEB] my-5" />

          {/* Top Genres placeholder */}
          <div className="text-[15px] font-bold text-ink mb-3">Top Genres</div>
          <p className="text-[12px] text-muted">Rate more albums to see your top genres.</p>
        </div>
      </div>
    </div>
  );
}
