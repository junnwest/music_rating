'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Lock, Star, BarChart3, Drama, AudioWaveform } from 'lucide-react';
import Cover from '../../../components/sj/Cover';
import { useSession } from '../../../components/sj/SessionContext';
import { supabase } from '../../../lib/supabaseClient';
import { useLanguage } from '../../../lib/i18n';
import { displayName } from '../../../lib/sj/display';
import type { GenreStandingRPC } from '../../../lib/db/types';

const UNLOCK_THRESHOLD = 25;

interface TasteRating {
  score: number | null;
  createdAt: string;
  release: {
    id: string;
    title: string;
    artist: string;
    coverUrl: string | null;
  } | null;
}

type Card =
  | { kind: 'topAlbum'; releaseId: string; title: string; artist: string; coverUrl: string | null; score: number }
  | { kind: 'activity'; monthIndex: number; count: number; months: number[] }
  | { kind: 'style'; fives: number; total: number }
  | { kind: 'genre'; genre: string; userAvg: number; communityAvg: number; userCount: number };

/**
 * Taste — web sibling of iOS TasteView: locked until 25 ratings, then a
 * vertical snap-scroll reel of full-bleed insight cards (Top Album,
 * Activity, Rating Style, Genre DNA).
 */
export default function TastePage() {
  const { t } = useLanguage();
  const { userId, ready } = useSession();
  const [ratingCount, setRatingCount] = useState(0);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !supabase) return;
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const [{ data: albumRows }, { data: songRows }] = await Promise.all([
        supabase!
          .from('ratings')
          .select(
            'score, created_at, release_groups(id, title, artist_display, cover_url, native_title, artists!release_groups_primary_artist_id_fkey(name_native))',
          )
          .eq('user_id', userId),
        supabase!.from('track_ratings').select('recording_id').eq('user_id', userId),
      ]);
      if (cancelled) return;

      const ratings: TasteRating[] = ((albumRows as any[] | null) ?? []).map((r) => ({
        score: r.score,
        createdAt: r.created_at,
        release: r.release_groups
          ? {
              id: r.release_groups.id,
              title: displayName(r.release_groups.title, r.release_groups.native_title),
              artist: displayName(
                r.release_groups.artist_display,
                r.release_groups.artists?.name_native,
              ),
              coverUrl: r.release_groups.cover_url,
            }
          : null,
      }));
      const total = ratings.length + (((songRows as any[] | null) ?? []).length);
      setRatingCount(total);

      if (total >= UNLOCK_THRESHOLD) {
        const built: Card[] = [];
        const scored = ratings.filter((r) => r.score != null);

        // Top album by score
        const top = scored.reduce<TasteRating | null>(
          (best, r) => (best == null || (r.score ?? 0) > (best.score ?? 0) ? r : best),
          null,
        );
        if (top?.release && top.score != null) {
          built.push({
            kind: 'topAlbum',
            releaseId: top.release.id,
            title: top.release.title,
            artist: top.release.artist,
            coverUrl: top.release.coverUrl,
            score: top.score,
          });
        }

        // Most active month (all-time)
        const byMonth = Array.from({ length: 12 }, () => 0);
        for (const r of ratings) byMonth[new Date(r.createdAt).getMonth()] += 1;
        const peakCount = Math.max(...byMonth);
        if (peakCount > 0) {
          built.push({
            kind: 'activity',
            monthIndex: byMonth.indexOf(peakCount),
            count: peakCount,
            months: byMonth,
          });
        }

        // Rating style
        built.push({
          kind: 'style',
          fives: ratings.filter((r) => r.score === 5).length,
          total: ratings.length,
        });

        // Genre DNA (server RPC)
        const { data: standings } = await supabase!.rpc('get_user_genre_standings', {
          p_user_id: userId,
        });
        const topStanding = ((standings as GenreStandingRPC[] | null) ?? [])[0];
        if (topStanding) {
          built.push({
            kind: 'genre',
            genre: topStanding.genre,
            userAvg: Number(topStanding.user_avg),
            communityAvg: Number(topStanding.community_avg),
            userCount: Number(topStanding.user_count),
          });
        }
        if (!cancelled) setCards(built);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, userId]);

  if (loading) {
    return <div className="py-32 text-center text-muted text-[13px]">…</div>;
  }

  if (!userId || ratingCount < UNLOCK_THRESHOLD) {
    return <LockView ratingCount={ratingCount} signedIn={!!userId} />;
  }

  return (
    <div className="h-[calc(100vh-56px)] overflow-y-auto snap-y snap-mandatory scrollbar-hide">
      {cards.map((card, i) => (
        <InsightCard key={i} card={card} isLast={i === cards.length - 1} />
      ))}
    </div>
  );
}

function LockView({ ratingCount, signedIn }: { ratingCount: number; signedIn: boolean }) {
  const { t } = useLanguage();
  const remaining = Math.max(0, UNLOCK_THRESHOLD - ratingCount);
  const teasers = [
    { icon: Star, label: t('sj.taste.teaserTop') },
    { icon: BarChart3, label: t('sj.taste.teaserActivity') },
    { icon: Drama, label: t('sj.taste.teaserStyle') },
    { icon: AudioWaveform, label: t('sj.taste.teaserGenre') },
  ];
  return (
    <div className="min-h-[calc(100vh-56px)] flex flex-col items-center justify-center px-6 py-14 text-center">
      <Lock size={34} className="text-accent" />
      <h1 className="mt-6 text-[24px] font-bold text-ink whitespace-pre-line">
        {t('sj.taste.lockTitle').replace('{n}', String(remaining))}
      </h1>
      <p className="mt-3 text-[15px] text-muted whitespace-pre-line">{t('sj.taste.lockDesc')}</p>

      <div className="w-full max-w-xs mt-9">
        <div className="h-1.5 rounded-full bg-accent/[0.12] overflow-hidden">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.min(100, (ratingCount / UNLOCK_THRESHOLD) * 100)}%` }}
          />
        </div>
        <p className="mt-2 text-[13px] font-semibold text-muted tabular-nums">
          {t('sj.taste.progress')
            .replace('{n}', String(ratingCount))
            .replace('{total}', String(UNLOCK_THRESHOLD))}
        </p>
      </div>

      <Link
        href={signedIn ? '/search' : '/login'}
        className="mt-6 px-6 py-2.5 rounded-[10px] bg-accent text-white text-[14px] font-semibold hover:opacity-90 transition"
      >
        {signedIn ? t('sj.taste.findReleases') : t('sj.album.signInToRate')}
      </Link>

      <div className="mt-16">
        <p className="text-[10px] font-bold tracking-[0.1em] uppercase text-muted/60 mb-3">
          {t('sj.taste.comingToYou')}
        </p>
        <div className="flex gap-8">
          {teasers.map(({ icon: Icon, label }) => (
            <span key={label} className="flex flex-col items-center gap-1.5">
              <Icon size={20} className="text-accent/40" />
              <span className="text-[10px] text-muted/70">{label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Insight cards (full-bleed, dark, snap-scrolled) ────────────────────────

function InsightCard({ card, isLast }: { card: Card; isLast: boolean }) {
  const { t, lang } = useLanguage();

  const shell = (bg: string, children: React.ReactNode) => (
    <section
      className="snap-start h-[calc(100vh-56px)] flex flex-col items-center justify-center px-6 relative"
      style={{ background: bg }}
    >
      {children}
      {!isLast && (
        <span className="absolute bottom-10 flex flex-col items-center gap-0.5 text-white/20 text-[10px]">
          <span className="rotate-180 text-[11px]">⌄</span>
          {t('sj.taste.scroll')}
        </span>
      )}
    </section>
  );

  const eyebrow = (label: string, color: string) => (
    <span
      className="px-3 py-1.5 rounded-full text-[9px] font-black tracking-[0.08em] uppercase"
      style={{ color, background: `${color}24`, border: `0.5px solid ${color}4d` }}
    >
      {label}
    </span>
  );

  const AMBER = '#E8A020';

  if (card.kind === 'topAlbum') {
    return shell(
      '#12121a',
      <>
        {eyebrow(t('sj.taste.topAlbum'), AMBER)}
        <div className="mt-6 shadow-2xl rounded-2xl">
          <Cover url={card.coverUrl} thumb={false} className="w-40 h-40" rounded="rounded-2xl" />
        </div>
        <h2 className="mt-6 text-[20px] font-bold text-white text-center max-w-sm line-clamp-2">
          <Link href={`/album/${card.releaseId}`} className="hover:underline">
            {card.title}
          </Link>
        </h2>
        <p className="mt-1 text-[14px] text-white/45">{card.artist}</p>
        <p className="mt-6 text-[64px] font-black leading-none tracking-tight" style={{ color: AMBER }}>
          {card.score.toFixed(1)}
        </p>
        <p className="mt-1 text-[12px] text-white/30">{t('sj.taste.outOf')}</p>
      </>,
    );
  }

  if (card.kind === 'activity') {
    const monthNames =
      lang === 'ko'
        ? ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']
        : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const shortNames = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    const maxCount = Math.max(1, ...card.months);
    return shell(
      '#1f1705',
      <>
        {eyebrow(t('sj.taste.yourMonth'), AMBER)}
        <h2 className="mt-5 text-[26px] font-bold text-white text-center whitespace-pre-line">
          {t('sj.taste.activityTitle').replace('{month}', monthNames[card.monthIndex])}
        </h2>
        <p className="mt-2 text-[14px]" style={{ color: `${AMBER}b3` }}>
          {t('sj.taste.albumsRated').replace('{n}', String(card.count))}
        </p>
        <div className="flex items-end gap-1.5 mt-9 w-full max-w-sm h-20">
          {card.months.map((count, i) => {
            const isPeak = count === maxCount && count > 0;
            return (
              <span key={i} className="flex-1 flex flex-col items-center gap-1 self-end">
                <span
                  className="w-full rounded-sm"
                  style={{
                    height: Math.max(3, (count / maxCount) * 60),
                    background: isPeak ? AMBER : 'rgba(255,255,255,0.12)',
                  }}
                />
                <span
                  className="text-[7px]"
                  style={{ color: isPeak ? AMBER : 'rgba(255,255,255,0.25)' }}
                >
                  {shortNames[i]}
                </span>
              </span>
            );
          })}
        </div>
      </>,
    );
  }

  if (card.kind === 'style') {
    const RED = '#d96161';
    const pct = card.total > 0 ? card.fives / card.total : 0;
    const label =
      card.fives === 0
        ? t('sj.taste.styleSkeptic')
        : pct < 0.05
          ? t('sj.taste.stylePurist')
          : pct < 0.15
            ? t('sj.taste.styleEnthusiast')
            : pct < 0.3
              ? t('sj.taste.styleGenerous')
              : t('sj.taste.styleChampion');
    const desc =
      card.fives === 0
        ? t('sj.taste.styleSkepticDesc')
        : pct < 0.05
          ? t('sj.taste.stylePuristDesc')
          : pct < 0.15
            ? t('sj.taste.styleEnthusiastDesc')
            : pct < 0.3
              ? t('sj.taste.styleGenerousDesc')
              : t('sj.taste.styleChampionDesc');
    return shell(
      '#210f0f',
      <>
        {eyebrow(t('sj.taste.yourStyle'), RED)}
        <h2 className="mt-5 text-[34px] font-black text-white">{label}</h2>
        <p className="mt-2 text-[16px] text-white/45 text-center max-w-xs">{desc}</p>
        <div className="flex items-center gap-9 mt-10">
          <span className="text-center">
            <span className="block text-[38px] font-black" style={{ color: AMBER }}>
              {card.fives}
            </span>
            <span className="block text-[11px] text-white/30">{t('sj.taste.perfectScores')}</span>
          </span>
          <span className="w-px h-11 bg-white/10" />
          <span className="text-center">
            <span className="block text-[38px] font-black" style={{ color: RED }}>
              {Math.round(pct * 100)}%
            </span>
            <span className="block text-[11px] text-white/30">{t('sj.taste.ofYourRatings')}</span>
          </span>
        </div>
      </>,
    );
  }

  // genre
  const BLUE = '#61adff';
  const diff = card.userAvg - card.communityAvg;
  return shell(
    '#0d1429',
    <>
      {eyebrow(t('sj.taste.genreDna'), BLUE)}
      <h2 className="mt-5 text-[26px] font-bold text-white text-center whitespace-pre-line">
        {t('sj.taste.genreTitle')
          .replace('{genre}', card.genre)
          .replace(
            '{dir}',
            diff >= 0 ? t('sj.taste.higher') : t('sj.taste.lower'),
          )}
      </h2>
      <p className="mt-1.5 text-[13px] text-white/30">
        {t('sj.taste.fromNRatings').replace('{n}', String(card.userCount))}
      </p>
      <div className="w-full max-w-sm mt-9 space-y-3">
        <GenreBar label={t('sj.taste.you')} value={card.userAvg} color={AMBER} />
        <GenreBar
          label={t('sj.taste.community')}
          value={card.communityAvg}
          color="rgba(255,255,255,0.25)"
        />
      </div>
      <span
        className="mt-5 px-3.5 py-1.5 rounded-full bg-white/[0.07] text-[13px] font-semibold"
        style={{ color: diff >= 0 ? AMBER : 'rgba(255,255,255,0.45)' }}
      >
        {diff >= 0 ? '↑' : '↓'} {Math.abs(diff).toFixed(2)}{' '}
        {diff >= 0 ? t('sj.taste.aboveAverage') : t('sj.taste.belowAverage')}
      </span>
      {isLast && (
        <p className="absolute bottom-12 text-[12px] text-white/[0.18]">
          {t('sj.taste.snapshotEnd')}
        </p>
      )}
    </>,
  );
}

function GenreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-20 text-right text-[12px] font-semibold text-white/40">{label}</span>
      <span className="flex-1 h-[7px] rounded-full bg-white/[0.07] overflow-hidden">
        <span
          className="block h-full rounded-full"
          style={{ width: `${(value / 5) * 100}%`, background: color }}
        />
      </span>
      <span className="w-9 text-[12px] font-bold tabular-nums" style={{ color }}>
        {value.toFixed(2)}
      </span>
    </div>
  );
}
