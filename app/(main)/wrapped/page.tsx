'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabaseClient';

const CURRENT_YEAR = new Date().getFullYear();
const AVAILABLE_YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

interface WrappedData {
  year: number;
  empty?: boolean;
  total: number;
  avgScore: number;
  topGenre: string | null;
  topArtist: string | null;
  topArtistCount: number;
  perfectCount: number;
  topMonthLabel: string | null;
  topMonthCount: number;
  highest: { title: string; artist: string; coverUrl: string | null; score: number; releaseId: string } | null;
  lowest: { title: string; artist: string; coverUrl: string | null; score: number; releaseId: string } | null;
}

function StatBlock({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-[14px] border border-[#EBEBEB] p-6 flex flex-col">
      <span className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.7px' }}>
        {label}
      </span>
      <span
        className="text-[40px] font-extrabold text-ink leading-none"
        style={{ letterSpacing: '-1.2px' }}
      >
        {value}
      </span>
      {sub && <span className="text-[13px] text-muted mt-2">{sub}</span>}
    </div>
  );
}

function AlbumCard({ label, item }: { label: string; item: NonNullable<WrappedData['highest']> }) {
  return (
    <div className="rounded-[14px] border border-[#EBEBEB] p-6">
      <span className="text-[11px] font-semibold text-muted uppercase mb-4 block" style={{ letterSpacing: '0.7px' }}>
        {label}
      </span>
      <Link href={`/album/${item.releaseId}`} className="flex items-center gap-4 group">
        <div className="w-[72px] h-[72px] rounded-[8px] overflow-hidden flex-shrink-0 border border-[#EBEBEB] bg-surface">
          {item.coverUrl ? (
            <img src={item.coverUrl} alt={item.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-surface" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[16px] font-extrabold text-ink truncate group-hover:underline" style={{ letterSpacing: '-0.4px' }}>
            {item.title}
          </div>
          <div className="text-[13px] text-muted truncate">{item.artist}</div>
          <div
            className="inline-flex items-center mt-2 px-[9px] py-[2px] rounded-full text-[12px] font-bold"
            style={{ background: '#3DFFD1', color: '#00453A' }}
          >
            ★ {item.score}
          </div>
        </div>
      </Link>
    </div>
  );
}

export default function WrappedPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [data, setData] = useState<WrappedData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data: s }) => {
      const uid = s.session?.user?.id ?? null;
      setUserId(uid);
      if (!uid) { setLoading(false); return; }
      fetchWrapped(uid, year);
    });
  }, []);

  const fetchWrapped = async (uid: string, y: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/wrapped?userId=${uid}&year=${y}`);
      const json = await res.json();
      setData(json);
    } catch {
      setData(null);
    }
    setLoading(false);
  };

  const changeYear = (y: number) => {
    setYear(y);
    if (userId) fetchWrapped(userId, y);
  };

  if (!userId && !loading) {
    return (
      <div className="max-w-[640px] mx-auto px-5 py-24 text-center">
        <div className="text-[11px] font-semibold text-muted uppercase mb-4" style={{ letterSpacing: '0.7px' }}>
          Wrapped
        </div>
        <h1 className="text-[34px] font-extrabold text-ink mb-4" style={{ letterSpacing: '-1px' }}>
          Your year in music
        </h1>
        <p className="text-[15px] text-muted mb-8 leading-relaxed">
          Sign in to see your yearly listening summary.
        </p>
        <Link
          href="/login"
          className="inline-flex rounded-lg bg-ink px-6 py-3 text-[14px] font-semibold text-white hover:opacity-80 transition"
        >
          Log in →
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white min-h-screen">
      {/* Hero */}
      <div className="bg-surface border-b border-[#EBEBEB]">
        <div className="max-w-[1440px] mx-auto px-5 py-12">
          <p className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.7px' }}>
            Your year in music
          </p>
          <div className="flex items-end gap-5 flex-wrap">
            <h1
              className="text-[38px] font-extrabold text-ink leading-[1.06]"
              style={{ letterSpacing: '-1.2px' }}
            >
              Wrapped
            </h1>
            {/* Year selector */}
            <div className="flex gap-1 pb-1">
              {AVAILABLE_YEARS.map((y) => (
                <button
                  key={y}
                  onClick={() => changeYear(y)}
                  className={`px-4 py-[6px] rounded-full text-[13px] font-semibold transition ${
                    year === y
                      ? 'bg-ink text-white'
                      : 'bg-white border border-[#EBEBEB] text-muted hover:text-ink'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[15px] text-muted mt-3 max-w-[480px] leading-relaxed">
            Every album, every score — your {year} listening story.
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-[860px] mx-auto px-5 py-12 pb-20">
        {loading ? (
          <div className="py-24 text-center">
            <p className="text-sm text-muted">Loading your year…</p>
          </div>
        ) : !data || data.empty ? (
          <div className="py-24 text-center">
            <p className="text-[15px] text-muted">No ratings found for {year}.</p>
            {year < CURRENT_YEAR && (
              <p className="text-[13px] text-muted mt-2">Try a different year above.</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Top stats row */}
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <StatBlock label="Albums rated" value={data.total} />
              <StatBlock
                label="Avg score"
                value={`${data.avgScore} ★`}
              />
              <StatBlock
                label="Perfect scores"
                value={data.perfectCount}
                sub={
                  data.total > 0
                    ? `${Math.round((data.perfectCount / data.total) * 100)}% of your ratings`
                    : undefined
                }
              />
            </div>

            {/* Genre + Artist row */}
            <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="rounded-[14px] border border-[#EBEBEB] p-6">
                <span
                  className="text-[11px] font-semibold text-muted uppercase mb-3 block"
                  style={{ letterSpacing: '0.7px' }}
                >
                  Top genre
                </span>
                {data.topGenre ? (
                  <span
                    className="text-[28px] font-extrabold text-ink"
                    style={{ letterSpacing: '-0.7px' }}
                  >
                    {data.topGenre}
                  </span>
                ) : (
                  <span className="text-[14px] text-muted">Not enough data</span>
                )}
              </div>

              <div className="rounded-[14px] border border-[#EBEBEB] p-6">
                <span
                  className="text-[11px] font-semibold text-muted uppercase mb-3 block"
                  style={{ letterSpacing: '0.7px' }}
                >
                  Most rated artist
                </span>
                {data.topArtist ? (
                  <>
                    <span
                      className="text-[28px] font-extrabold text-ink block"
                      style={{ letterSpacing: '-0.7px' }}
                    >
                      {data.topArtist}
                    </span>
                    <span className="text-[13px] text-muted mt-1 block">
                      {data.topArtistCount} album{data.topArtistCount !== 1 ? 's' : ''} rated
                    </span>
                  </>
                ) : (
                  <span className="text-[14px] text-muted">Not enough data</span>
                )}
              </div>
            </div>

            {/* Most active month */}
            {data.topMonthLabel && (
              <div className="rounded-[14px] p-6 flex items-center justify-between" style={{ background: '#3DFFD1' }}>
                <div>
                  <span
                    className="text-[11px] font-semibold uppercase mb-2 block"
                    style={{ letterSpacing: '0.7px', color: '#00453A' }}
                  >
                    Most active month
                  </span>
                  <span
                    className="text-[34px] font-extrabold"
                    style={{ letterSpacing: '-1px', color: '#00453A' }}
                  >
                    {data.topMonthLabel}
                  </span>
                </div>
                <div className="text-right">
                  <span
                    className="text-[52px] font-extrabold leading-none"
                    style={{ letterSpacing: '-1.5px', color: '#00453A' }}
                  >
                    {data.topMonthCount}
                  </span>
                  <span className="text-[13px] block" style={{ color: '#00453A' }}>
                    album{data.topMonthCount !== 1 ? 's' : ''} rated
                  </span>
                </div>
              </div>
            )}

            {/* Best + Worst album */}
            <div className="grid gap-4" style={{ gridTemplateColumns: data.lowest ? '1fr 1fr' : '1fr' }}>
              {data.highest && <AlbumCard label="Highest rated" item={data.highest} />}
              {data.lowest && <AlbumCard label="Lowest rated" item={data.lowest} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
