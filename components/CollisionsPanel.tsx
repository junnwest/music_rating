'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';

type Collision = {
  releaseId: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  myScore: number;
  friendScore: number;
  friendUsername: string;
  diff: number;
};

export default function CollisionsPanel() {
  const [collisions, setCollisions] = useState<Collision[]>([]);
  const [loading, setLoading] = useState(true);
  const [noFollows, setNoFollows] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session?.user) { setLoading(false); return; }
      setLoggedIn(true);
      const userId = data.session.user.id;
      const res = await fetch(`/api/collisions?userId=${userId}`);
      const json = await res.json();
      if (json.noFollows) setNoFollows(true);
      setCollisions(json.collisions ?? []);
      setLoading(false);
    });
  }, []);

  return (
    <div className="bg-white min-h-screen">
      {/* Hero */}
      <div className="bg-surface border-b border-[#EBEBEB]">
        <div className="max-w-[1440px] mx-auto px-5 py-12">
          <p className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.7px' }}>
            Social
          </p>
          <h1 className="text-[38px] font-extrabold text-ink leading-[1.06]" style={{ letterSpacing: '-1.2px' }}>
            Taste Collisions
          </h1>
          <p className="text-[15px] text-muted mt-3 max-w-[500px] leading-relaxed">
            Albums where you and the people you follow strongly disagree.
          </p>
        </div>
      </div>

      <div className="max-w-[720px] mx-auto px-5 py-10 pb-16">
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : !loggedIn ? (
          <div className="flex flex-col items-center py-20 text-center">
            <p className="text-[14px] font-semibold text-ink mb-1">Sign in to see taste collisions</p>
            <p className="text-[13px] text-muted mb-6">Follow people and compare your ratings.</p>
            <Link
              href="/login"
              className="bg-ink text-white text-[13px] font-bold px-5 py-2.5 rounded-lg hover:opacity-80 transition inline-block"
            >
              Sign In
            </Link>
          </div>
        ) : noFollows ? (
          <div className="flex flex-col items-center py-20 text-center">
            <p className="text-[14px] font-semibold text-ink mb-1">You&apos;re not following anyone yet</p>
            <p className="text-[13px] text-muted max-w-[280px]">
              Visit someone&apos;s profile and hit Follow to start comparing tastes.
            </p>
          </div>
        ) : collisions.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <p className="text-[14px] font-semibold text-ink mb-1">No collisions yet</p>
            <p className="text-[13px] text-muted max-w-[320px]">
              You and the people you follow haven&apos;t rated many of the same albums — or you agree on everything.
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {collisions.map((c, i) => (
              <div key={`${c.releaseId}-${c.friendUsername}-${i}`} className="flex gap-4 py-5 border-b border-[#EBEBEB] last:border-0">
                {/* Cover */}
                <Link href={`/album/${c.releaseId}`} className="flex-shrink-0">
                  {c.coverUrl ? (
                    <img
                      src={c.coverUrl}
                      alt={c.title}
                      className="w-[56px] h-[56px] rounded-[6px] object-cover"
                    />
                  ) : (
                    <div className="w-[56px] h-[56px] rounded-[6px] bg-surface border border-[#EBEBEB]" />
                  )}
                </Link>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <Link href={`/album/${c.releaseId}`} className="block">
                    <p className="text-[14px] font-bold text-ink truncate hover:text-mid transition">
                      {c.title}
                    </p>
                  </Link>
                  <p className="text-[12px] text-muted mt-0.5 truncate">{c.artist}</p>

                  {/* Scores */}
                  <div className="flex items-center gap-3 mt-2">
                    <span
                      className="inline-flex items-center text-[11px] font-bold rounded-[4px] px-[7px] py-[2px]"
                      style={{ background: '#3DFFD1', color: '#00453A' }}
                    >
                      You ★{c.myScore}
                    </span>
                    <span className="text-[11px] text-muted">vs</span>
                    <span className="inline-flex items-center text-[11px] font-bold rounded-[4px] px-[7px] py-[2px] bg-surface border border-[#EBEBEB] text-ink">
                      {c.friendUsername} ★{c.friendScore}
                    </span>
                    <span
                      className="ml-auto text-[11px] font-semibold"
                      style={{ color: c.diff >= 3 ? '#E53E3E' : c.diff >= 2 ? '#DD6B20' : '#718096' }}
                    >
                      ±{c.diff.toFixed(1)}
                    </span>
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
