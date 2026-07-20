'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import ArtistLink from '../../../../components/sj/ArtistLink';
import Cover from '../../../../components/sj/Cover';
import ManualRateModal from '../../../../components/sj/ManualRateModal';
import InstinctModal from '../../../../components/sj/InstinctModal';
import { SkeletonBlock } from '../../../../components/sj/Loading';
import { useSession } from '../../../../components/sj/SessionContext';
import { supabase } from '../../../../lib/supabaseClient';
import { useLanguage } from '../../../../lib/i18n';
import { displayName, formatScore, typeLabelKey } from '../../../../lib/sj/display';
import { releaseFromEmbed, type SJRelease, RG_COLS } from '../../../../lib/sj/data';

/** Song (recording) page — web sibling of iOS SongDetailView. */
export default function SongPage() {
  return (
    <Suspense>
      <SongPageInner />
    </Suspense>
  );
}

function SongPageInner() {
  const params = useParams<{ id: string }>();
  const recordingId = params.id;
  const searchParams = useSearchParams();
  const rgHint = searchParams.get('rg');
  const { t } = useLanguage();
  const { userId, profile } = useSession();

  const [track, setTrack] = useState<{
    title: string;
    artist: string | null;
    durationMs: number | null;
    position: number | null;
  } | null>(null);
  const [release, setRelease] = useState<SJRelease | null>(null);
  const [communityAvg, setCommunityAvg] = useState<number | null>(null);
  const [communityCount, setCommunityCount] = useState(0);
  const [userScore, setUserScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [showManual, setShowManual] = useState(false);
  const [showInstinct, setShowInstinct] = useState(false);

  const ratingMode = profile?.rating_mode ?? 'manual';

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      setLoading(true);

      const { data: rec } = await supabase!
        .from('recordings')
        .select('id, title, artist_display, duration_ms')
        .eq('id', recordingId)
        .maybeSingle();
      if (cancelled || !rec) {
        setLoading(false);
        return;
      }
      const recAny = rec as any;

      // Position + parent release group (prefer canonical edition)
      let position: number | null = null;
      let rg: SJRelease | null = null;
      const { data: rtRows } = await supabase!
        .from('release_tracks')
        .select(
          `position, releases(is_canonical, release_groups(${RG_COLS}))`,
        )
        .eq('recording_id', recordingId)
        .limit(20);
      const rows = (rtRows as any[] | null) ?? [];
      const preferred =
        rows.find(
          (r) => rgHint && r.releases?.release_groups?.id === rgHint,
        ) ??
        rows.find((r) => r.releases?.is_canonical) ??
        rows[0];
      if (preferred?.releases?.release_groups) {
        position = preferred.position;
        rg = releaseFromEmbed(preferred.releases.release_groups);
      }

      if (cancelled) return;
      setTrack({
        title: recAny.title,
        artist: recAny.artist_display,
        durationMs: recAny.duration_ms,
        position,
      });
      setRelease(rg);

      // Community stats
      const { data: allRows } = await supabase!
        .from('track_ratings')
        .select('score, user_id')
        .eq('recording_id', recordingId);
      const scores = ((allRows as { score: number | null; user_id: string }[] | null) ?? [])
        .map((r) => r.score)
        .filter((s): s is number => s != null);
      if (cancelled) return;
      setCommunityCount(scores.length);
      setCommunityAvg(scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null);
      if (userId) {
        const mine = ((allRows as any[] | null) ?? []).find((r) => r.user_id === userId);
        setUserScore(mine?.score ?? null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [recordingId, rgHint, userId]);

  async function rate(score: number | null) {
    if (!supabase || !userId) return;
    if (score != null) {
      await supabase
        .from('track_ratings')
        .upsert(
          { user_id: userId, recording_id: recordingId, score },
          { onConflict: 'user_id,recording_id' },
        );
    } else {
      await supabase
        .from('track_ratings')
        .delete()
        .eq('user_id', userId)
        .eq('recording_id', recordingId);
    }
    setUserScore(score);
  }

  if (loading || !track) {
    return (
      <div className="mx-auto max-w-3xl px-4 md:px-6 py-10 space-y-4">
        <SkeletonBlock className="h-24" />
        <SkeletonBlock className="h-40" />
      </div>
    );
  }

  const durationString =
    track.durationMs && track.durationMs > 0
      ? `${Math.floor(track.durationMs / 60000)}:${String(
          Math.floor((track.durationMs % 60000) / 1000),
        ).padStart(2, '0')}`
      : '';

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-5">
        <Cover url={release?.coverUrl} className="w-24 h-24" rounded="rounded-xl" />
        <div className="min-w-0">
          {track.position != null && (
            <p className="text-[11px] font-semibold tracking-[0.05em] uppercase text-muted">
              {t('sj.song.trackN').replace('{n}', String(track.position))}
            </p>
          )}
          <h1 className="text-[19px] font-bold text-ink leading-snug line-clamp-2">
            {track.title}
          </h1>
          {(track.artist || release) && (
            <ArtistLink
              href={`/artist/${encodeURIComponent(track.artist ?? release?.artist ?? '')}`}
              className="text-[13px] text-muted hover:text-ink hover:underline"
            >
              {track.artist ?? (release ? displayName(release.artist, release.artistNative) : '')}
            </ArtistLink>
          )}
          {durationString && <p className="text-[12px] text-muted mt-0.5">{durationString}</p>}
        </div>
      </div>

      {/* Community */}
      <section className="mt-7 rounded-2xl bg-surface border border-divider/60 p-5">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-muted mb-3.5">
          {t('sj.song.community')}
        </h2>
        <div className="flex gap-10">
          <div>
            <p className="text-[26px] font-bold text-ink leading-tight">
              {communityAvg != null ? communityAvg.toFixed(2) : '—'}
            </p>
            <p className="text-[12px] text-muted">{t('sj.song.avgScore')}</p>
          </div>
          <div>
            <p className="text-[26px] font-bold text-ink leading-tight">{communityCount}</p>
            <p className="text-[12px] text-muted">{t('sj.album.ratings')}</p>
          </div>
        </div>
      </section>

      {/* Your rating */}
      <section className="mt-4 rounded-2xl bg-surface border border-divider/60 p-5">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-muted mb-3.5">
          {t('sj.album.yourRating')}
        </h2>
        {!userId ? (
          <Link
            href="/login"
            className="block w-full py-2.5 rounded-[10px] bg-accent text-white text-[14px] font-semibold text-center hover:opacity-90 transition"
          >
            {t('sj.album.signInToRate')}
          </Link>
        ) : userScore != null ? (
          <div className="flex items-center gap-2">
            <span className="text-[22px] font-bold text-accent tabular-nums">
              {formatScore(userScore)}
            </span>
            <span className="text-[15px] text-muted">/ 5</span>
            <span className="flex-1" />
            <button
              onClick={() => setShowManual(true)}
              className="text-[14px] font-semibold text-accent hover:opacity-80"
            >
              {t('sj.common.edit')}
            </button>
          </div>
        ) : (
          <button
            onClick={() =>
              ratingMode === 'instinct' ? setShowInstinct(true) : setShowManual(true)
            }
            className="w-full py-2.5 rounded-[10px] bg-accent text-white text-[14px] font-semibold hover:opacity-90 transition"
          >
            {t('sj.song.rateThisTrack')}
          </button>
        )}
      </section>

      {/* Appears on */}
      {release && (
        <section className="mt-4 rounded-2xl bg-surface border border-divider/60 p-5">
          <h2 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-muted mb-3.5">
            {t('sj.song.appearsOn')}
          </h2>
          <Link
            href={`/album/${release.id}`}
            className="flex items-center gap-3 group"
          >
            <Cover url={release.coverUrl} className="w-11 h-11" rounded="rounded-md" />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-ink truncate group-hover:underline">
                {displayName(release.title, release.titleNative)}
              </span>
              <span className="block text-[12px] text-muted truncate">
                {t(typeLabelKey(release.releaseType))} ·{' '}
                {displayName(release.artist, release.artistNative)}
              </span>
            </span>
            <ChevronRight size={14} className="text-muted" />
          </Link>
        </section>
      )}

      {release && (
        <>
          <ManualRateModal
            open={showManual}
            onClose={() => setShowManual(false)}
            release={release}
            track={{ recordingId, title: track.title }}
            existingScore={userScore}
            onSave={rate}
          />
          <InstinctModal
            open={showInstinct}
            onClose={() => setShowInstinct(false)}
            release={release}
            track={{ recordingId, title: track.title }}
          />
        </>
      )}
    </div>
  );
}
