'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';

type Contradiction = {
  releaseId: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  myScore: number;
  communityAvg: number;
  diff: number;
  absDiff: number;
  communityCount: number;
};

function ContradictionRow({ c }: { c: Contradiction }) {
  const ratedHigher = c.diff > 0;
  return (
    <div className="flex gap-4 py-5 border-b border-[#EBEBEB] last:border-0">
      <Link href={`/album/${c.releaseId}`} className="flex-shrink-0">
        {c.coverUrl ? (
          <img src={c.coverUrl} alt={c.title} className="w-[56px] h-[56px] rounded-[6px] object-cover" />
        ) : (
          <div className="w-[56px] h-[56px] rounded-[6px] bg-surface border border-[#EBEBEB]" />
        )}
      </Link>

      <div className="flex-1 min-w-0">
        <Link href={`/album/${c.releaseId}`} className="block">
          <p className="text-[14px] font-bold text-ink truncate hover:text-mid transition">{c.title}</p>
        </Link>
        <p className="text-[12px] text-muted mt-0.5 truncate">{c.artist}</p>

        <div className="flex items-center gap-3 mt-2">
          <span
            className="inline-flex items-center text-[11px] font-bold rounded-[4px] px-[7px] py-[2px]"
            style={{ background: '#3DFFD1', color: '#00453A' }}
          >
            You ★{c.myScore}
          </span>
          <span className="text-[11px] text-muted">vs</span>
          <span className="inline-flex items-center text-[11px] font-bold rounded-[4px] px-[7px] py-[2px] bg-surface border border-[#EBEBEB] text-ink">
            Community ★{c.communityAvg}
          </span>
          <span className="text-[11px] text-muted ml-1">({c.communityCount} ratings)</span>
          <span
            className="ml-auto text-[11px] font-semibold"
            style={{ color: c.absDiff >= 3 ? '#E53E3E' : c.absDiff >= 2 ? '#DD6B20' : '#718096' }}
          >
            {ratedHigher ? '+' : ''}{c.diff.toFixed(1)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function ContradictionsPanel() {
  const [contradictions, setContradictions] = useState<Contradiction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [noData, setNoData] = useState(false);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session?.user) { setLoading(false); return; }
      setLoggedIn(true);
      const userId = data.session.user.id;
      const res = await fetch(`/api/contradictions?userId=${userId}`);
      const json = await res.json();
      if (json.noData) setNoData(true);
      setContradictions(json.contradictions ?? []);
      setLoading(false);
    });
  }, []);

  const higher = contradictions.filter((c) => c.diff > 0);
  const lower = contradictions.filter((c) => c.diff < 0);

  return (
    <div className="bg-white min-h-screen">
      <div className="bg-surface border-b border-[#EBEBEB]">
        <div className="max-w-[1440px] mx-auto px-5 py-8">
          <h1 className="text-[24px] font-extrabold text-ink" style={{ letterSpacing: '-0.6px' }}>
            Taste Contradictions
          </h1>
          <p className="text-[13px] text-muted mt-1">
            Albums where your score strongly disagrees with the community
          </p>
        </div>
      </div>

      <div className="max-w-[720px] mx-auto px-5 py-9 pb-14">
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : !loggedIn ? (
          <div className="py-16 text-center">
            <p className="text-[15px] font-bold text-ink mb-2">Sign in to see your contradictions</p>
            <Link
              href="/login"
              className="inline-flex rounded-lg bg-ink px-6 py-3 text-sm font-semibold text-white hover:opacity-80 transition"
            >
              Go to login
            </Link>
          </div>
        ) : noData || contradictions.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[15px] font-bold text-ink mb-2">No contradictions found</p>
            <p className="text-[13px] text-muted">
              {noData
                ? 'Not enough community ratings yet — contradictions appear once others rate the same albums.'
                : 'Your ratings align closely with the community. Keep rating to uncover your outlier takes.'}
            </p>
          </div>
        ) : (
          <div>
            {higher.length > 0 && (
              <div className="mb-10">
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-[16px] font-extrabold text-ink" style={{ letterSpacing: '-0.4px' }}>
                    You rated higher
                  </h2>
                  <span className="text-[12px] text-muted">{higher.length} album{higher.length !== 1 ? 's' : ''}</span>
                </div>
                <p className="text-[12px] text-muted mb-4">Albums the community undervalued compared to you</p>
                <div className="flex flex-col">
                  {higher.map((c, i) => <ContradictionRow key={`${c.releaseId}-${i}`} c={c} />)}
                </div>
              </div>
            )}

            {lower.length > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-[16px] font-extrabold text-ink" style={{ letterSpacing: '-0.4px' }}>
                    You rated lower
                  </h2>
                  <span className="text-[12px] text-muted">{lower.length} album{lower.length !== 1 ? 's' : ''}</span>
                </div>
                <p className="text-[12px] text-muted mb-4">Albums the community loved that left you cold</p>
                <div className="flex flex-col">
                  {lower.map((c, i) => <ContradictionRow key={`${c.releaseId}-${i}`} c={c} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
