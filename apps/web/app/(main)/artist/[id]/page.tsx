'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import Avatar from '../../../../components/sj/Avatar';
import Cover from '../../../../components/sj/Cover';
import AlbumRateButton from '../../../../components/sj/AlbumRateButton';
import AlbumBookmarkButton from '../../../../components/sj/AlbumBookmarkButton';
import AlbumPeek from '../../../../components/sj/AlbumPeek';
import FlowerGlyph from '../../../../components/sj/FlowerGlyph';
import { Skeleton, SkeletonLine, SkeletonRows } from '../../../../components/sj/Loading';
import { useSession } from '../../../../components/sj/SessionContext';
import { supabase } from '../../../../lib/supabaseClient';
import { useLanguage } from '../../../../lib/i18n';
import { eloToScore } from '../../../../lib/elo';
import {
  displayName,
  formatScore,
  relativeTime,
  typeLabelKey,
  yearOf,
} from '../../../../lib/sj/display';
import { RG_COLS, type SJRelease } from '../../../../lib/sj/data';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CommunityEntry {
  id: string;
  userId: string;
  releaseGroupId: string;
  score: number | null;
  eloScore: number | null;
  createdAt: string;
  handle: string;
  username: string | null;
}

type Tab = 'albums' | 'songs' | 'community' | 'stats';

interface ArtistSong {
  id: string;
  title: string;
  albumId: string | null;
  albumTitle: string;
  albumCoverUrl: string | null;
}

/**
 * Artist page — web sibling of iOS ArtistPageView. `[id]` is a uuid
 * (identity-aware via get_artist_release_groups) or a URL-encoded artist
 * name fallback (artist_display match), same duality as iOS ArtistDestination.
 */
export default function ArtistPage() {
  const params = useParams<{ id: string }>();
  const rawId = decodeURIComponent(params.id);
  const isId = UUID_RE.test(rawId);
  const { t, lang } = useLanguage();
  const { userId } = useSession();

  const [name, setName] = useState(isId ? '' : rawId);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [releases, setReleases] = useState<SJRelease[]>([]);
  const [songs, setSongs] = useState<ArtistSong[]>([]);
  const [releaseScores, setReleaseScores] = useState<Record<string, number>>({});
  const [releaseCounts, setReleaseCounts] = useState<Record<string, number>>({});
  const [myRatings, setMyRatings] = useState<Record<string, number>>({});
  const [allScores, setAllScores] = useState<number[]>([]);
  const [communityCount, setCommunityCount] = useState(0);
  const [communityFeed, setCommunityFeed] = useState<CommunityEntry[]>([]);
  const [tab, setTab] = useState<Tab>('albums');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      setLoading(true);

      let loaded: SJRelease[] = [];
      if (isId) {
        const [{ data: rgs }, { data: artistRows }] = await Promise.all([
          supabase!.rpc('get_artist_release_groups', { p_artist_id: rawId, lim: 60 }),
          supabase!.from('artists').select('name, cover_url').eq('id', rawId).limit(1),
        ]);
        loaded = ((rgs as any[] | null) ?? []).map((r) => ({
          id: r.id,
          title: r.title,
          artist: r.artist_display,
          coverUrl: r.cover_url,
          releaseType: r.release_group_type,
          releaseDate: r.first_release_date,
          titleNative: r.native_title,
          artistNative: null,
        }));
        const artist = (artistRows as any[] | null)?.[0];
        if (artist && !cancelled) {
          setName(artist.name);
          setAvatarUrl(artist.cover_url);
        }
      } else {
        const { data } = await supabase!
          .from('release_groups')
          .select(RG_COLS)
          .ilike('artist_display', rawId)
          .order('first_release_date', { ascending: false, nullsFirst: false })
          .limit(60);
        loaded = ((data as any[] | null) ?? []).map((r) => ({
          id: r.id,
          title: r.title,
          artist: r.artist_display,
          coverUrl: r.cover_url,
          releaseType: r.release_group_type,
          releaseDate: r.first_release_date,
          titleNative: r.native_title,
          artistNative: null,
        }));
      }
      if (cancelled) return;
      setReleases(loaded);

      // Songs (title-sorted recordings by this artist)
      const songsP = (async () => {
        const artistName = isId ? undefined : rawId;
        const nameForSongs = artistName ?? loaded[0]?.artist;
        if (!nameForSongs) return;
        const { data: hits } = await supabase!
          .from('recordings')
          .select('id, title')
          .ilike('artist_display', nameForSongs)
          .order('title')
          .limit(200);
        const hitRows = (hits as { id: string; title: string }[] | null) ?? [];
        if (hitRows.length === 0 || cancelled) return;
        const { data: rt } = await supabase!
          .from('release_tracks')
          .select('recording_id, releases(is_canonical, release_groups(id, title, cover_url))')
          .in('recording_id', hitRows.map((h) => h.id));
        const rgMap: Record<string, any> = {};
        for (const row of (rt as any[] | null) ?? []) {
          const rg = row.releases?.release_groups;
          if (!rg) continue;
          if (row.releases?.is_canonical || !rgMap[row.recording_id]) {
            rgMap[row.recording_id] = rg;
          }
        }
        if (cancelled) return;
        setSongs(
          hitRows.map((h) => ({
            id: h.id,
            title: h.title,
            albumId: rgMap[h.id]?.id ?? null,
            albumTitle: rgMap[h.id]?.title ?? '',
            albumCoverUrl: rgMap[h.id]?.cover_url ?? null,
          })),
        );
      })();

      // Ratings across this artist's release groups
      const ratingsP = (async () => {
        const ids = loaded.map((r) => r.id);
        if (ids.length === 0) return;
        const { data: rows } = await supabase!
          .from('ratings')
          .select('release_group_id, user_id, score')
          .in('release_group_id', ids);
        if (cancelled) return;
        const sums: Record<string, { sum: number; count: number }> = {};
        const mine: Record<string, number> = {};
        const scores: number[] = [];
        const all = (rows as { release_group_id: string; user_id: string; score: number | null }[] | null) ?? [];
        for (const r of all) {
          if (r.score != null) {
            const e = sums[r.release_group_id] ?? { sum: 0, count: 0 };
            sums[r.release_group_id] = { sum: e.sum + r.score, count: e.count + 1 };
            scores.push(r.score);
            if (r.user_id === userId) mine[r.release_group_id] = r.score;
          }
        }
        setReleaseScores(
          Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, v.sum / v.count])),
        );
        setReleaseCounts(
          Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, v.count])),
        );
        setMyRatings(mine);
        setAllScores(scores);
        setCommunityCount(all.length);

        // Community feed
        const { data: cf } = await supabase!
          .from('ratings')
          .select('id, user_id, release_group_id, score, elo_score, created_at, profiles(username, display_name)')
          .in('release_group_id', ids)
          .order('created_at', { ascending: false })
          .limit(60);
        if (cancelled) return;
        setCommunityFeed(
          ((cf as any[] | null) ?? []).map((r) => ({
            id: r.id,
            userId: r.user_id,
            releaseGroupId: r.release_group_id,
            score: r.score,
            eloScore: r.elo_score,
            createdAt: r.created_at,
            handle: r.profiles?.username ?? r.profiles?.display_name ?? 'someone',
            username: r.profiles?.username ?? null,
          })),
        );
      })();

      await Promise.all([songsP, ratingsP]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [rawId, isId, userId]);

  const communityAvg = allScores.length
    ? allScores.reduce((a, b) => a + b, 0) / allScores.length
    : null;
  const myRated = Object.values(myRatings).filter((s) => s > 0);
  const myAvg = myRated.length ? myRated.reduce((a, b) => a + b, 0) / myRated.length : null;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'albums', label: t('sj.artist.albums') },
    { key: 'songs', label: t('sj.artist.songs') },
    { key: 'community', label: t('sj.artist.community') },
    { key: 'stats', label: t('sj.artist.stats') },
  ];

  const releaseById = useMemo(
    () => Object.fromEntries(releases.map((r) => [r.id, r])),
    [releases],
  );

  return (
    <div className="mx-auto max-w-4xl px-4 md:px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover" />
        ) : (
          !name && <Skeleton className="w-16 h-16 shrink-0 rounded-full bg-surface" />
        )}
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.14em] uppercase text-muted">
            {t('sj.artist.artist')}
          </p>
          {/* Never fall back to `rawId` — a UUID flashing as the title is worse
              than a moment of skeleton. */}
          {name ? (
            <h1 className="text-[30px] font-extrabold text-ink leading-tight">{name}</h1>
          ) : (
            <SkeletonLine w="w-56" h="h-8" className="mt-1.5 rounded-lg" />
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex gap-8 mt-5">
        <Stat value={communityAvg != null ? communityAvg.toFixed(1) : '—'} label={t('sj.artist.communityAvg')} />
        <Stat value={`${communityCount}`} label={t('sj.album.ratings')} />
        <Stat value={`${releases.length}`} label={t('sj.artist.releases')} />
      </div>

      {myRated.length > 0 && myAvg != null && (
        <p className="inline-flex items-center gap-1.5 mt-4 px-2.5 py-1.5 rounded-lg bg-accent/[0.12] border border-accent/40 text-[12px] font-bold text-ink">
          <span className="text-[10px] font-semibold text-muted tracking-[0.04em]">
            {t('sj.artist.you')}
          </span>
          {t('sj.artist.youStats')
            .replace('{n}', String(myRated.length))
            .replace('{avg}', myAvg.toFixed(1))}
        </p>
      )}

      {/* Tabs */}
      <div
        role="tablist"
        className="flex border-b border-divider mt-6 overflow-x-auto scrollbar-hide"
      >
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-1 mr-7 pb-2.5 text-[13px] whitespace-nowrap transition border-b-2 -mb-px outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm ${
              tab === key
                ? 'border-accent text-ink font-bold'
                : 'border-transparent text-muted hover:text-ink font-medium'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonRows className="mt-4" count={6} />
      ) : (
        <div className="mt-2">
          {tab === 'albums' && (
            <Discography
              releases={releases}
              artistName={name}
              myRatings={myRatings}
              releaseScores={releaseScores}
            />
          )}

          {tab === 'songs' &&
            (songs.length === 0 ? (
              <Empty label={t('sj.artist.noSongs')} />
            ) : (
              <ul className="divide-y divide-divider">
                {songs.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/song/${s.id}${s.albumId ? `?rg=${s.albumId}` : ''}`}
                      className="flex items-center gap-3 py-2.5 px-1 hover:bg-surface/70 rounded-lg transition"
                    >
                      <Cover url={s.albumCoverUrl} className="w-11 h-11" rounded="rounded-md" />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-ink truncate">
                          {s.title}
                        </span>
                        <span className="block text-[11px] text-muted truncate">
                          {s.albumTitle}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ))}

          {tab === 'community' &&
            (communityFeed.length === 0 ? (
              <Empty label={t('sj.artist.noCommunity')} />
            ) : (
              <ul className="divide-y divide-divider">
                {communityFeed.map((entry) => {
                  const release = releaseById[entry.releaseGroupId];
                  const score =
                    entry.score ?? (entry.eloScore != null ? eloToScore(entry.eloScore) : null);
                  return (
                    <li key={entry.id} className="flex items-center gap-2.5 py-2.5 px-1">
                      <Avatar url={null} size={36} />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5 text-[12px]">
                          <Link
                            href={`/profile/${entry.username ?? ''}`}
                            className="font-semibold text-ink hover:underline"
                          >
                            @{entry.handle}
                          </Link>
                          <span className="text-divider">·</span>
                          <span className="text-muted">
                            {relativeTime(entry.createdAt, lang)}
                          </span>
                        </span>
                        {release && (
                          <span className="block text-[12px] text-muted truncate">
                            {displayName(release.title, release.titleNative)}
                          </span>
                        )}
                      </span>
                      {score != null && (
                        <span className="flex items-center gap-1 text-accent">
                          <FlowerGlyph size={10} />
                          <span className="text-[12px] font-bold">{formatScore(score)}</span>
                        </span>
                      )}
                      {release && (
                        <Cover url={release.coverUrl} className="w-9 h-9" rounded="rounded-md" />
                      )}
                    </li>
                  );
                })}
              </ul>
            ))}

          {tab === 'stats' && (
            <ArtistStats
              allScores={allScores}
              releases={releases}
              releaseScores={releaseScores}
              releaseCounts={releaseCounts}
              myRatings={myRatings}
              communityAvg={communityAvg}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-[22px] font-extrabold text-ink leading-tight">{value}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="py-14 text-center text-[13.5px] text-muted">{label}</p>;
}

function ScoreChip({ score, accent = false }: { score: number; accent?: boolean }) {
  return (
    <span
      className={`flex items-center gap-1 ${accent ? 'text-accent' : 'text-accent-deep/70'}`}
    >
      <FlowerGlyph size={11} />
      <span className="text-[12px] font-bold tabular-nums">{score.toFixed(1)}</span>
    </span>
  );
}

// ── Discography ─────────────────────────────────────────────────────────────

type GroupKey = 'album' | 'ep' | 'single' | 'compilation' | 'soundtrack' | 'other';
type SortKey = 'newest' | 'oldest' | 'title';

/** Section order, matching how mainstream music apps lead with full-lengths. */
const GROUP_ORDER: GroupKey[] = ['album', 'ep', 'single', 'compilation', 'soundtrack', 'other'];

const GROUP_LABEL: Record<GroupKey, string> = {
  album: 'sj.artist.groupAlbums',
  ep: 'sj.artist.groupEps',
  single: 'sj.artist.groupSingles',
  compilation: 'sj.artist.groupCompilations',
  soundtrack: 'sj.artist.groupSoundtracks',
  other: 'sj.artist.groupOther',
};

/** `release_group_type` is free-form in the catalogue; anything unrecognised
 *  lands in "Other" rather than inventing a section per stray value. */
function groupOf(releaseType?: string | null): GroupKey {
  const t = releaseType?.toLowerCase() ?? '';
  return (GROUP_ORDER as string[]).includes(t) ? (t as GroupKey) : 'other';
}

/**
 * Sectioned discography with sort + group controls. Grouping is a *view* over
 * the same `releases` array the other tabs read, so nothing refetches when the
 * controls change.
 */
function Discography({
  releases,
  artistName,
  myRatings,
  releaseScores,
}: {
  releases: SJRelease[];
  artistName: string;
  myRatings: Record<string, number>;
  releaseScores: Record<string, number>;
}) {
  const { t } = useLanguage();
  const [grouped, setGrouped] = useState(true);
  const [sort, setSort] = useState<SortKey>('newest');

  const sections = useMemo(() => {
    // Undated releases sort last in both directions — an unknown date is not
    // "the year 0", and burying them beats leading a discography with them.
    const byDate = (a: SJRelease, b: SJRelease, dir: 1 | -1) => {
      const da = a.releaseDate ?? '';
      const db = b.releaseDate ?? '';
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da < db ? dir : da > db ? -dir : 0;
    };
    const cmp = (a: SJRelease, b: SJRelease) => {
      if (sort === 'title') {
        return displayName(a.title, a.titleNative).localeCompare(
          displayName(b.title, b.titleNative),
        );
      }
      return byDate(a, b, sort === 'newest' ? 1 : -1);
    };

    if (!grouped) {
      return [{ key: 'all' as const, label: null, items: [...releases].sort(cmp) }];
    }
    const buckets = new Map<GroupKey, SJRelease[]>();
    for (const r of releases) {
      const k = groupOf(r.releaseType);
      const list = buckets.get(k);
      if (list) list.push(r);
      else buckets.set(k, [r]);
    }
    return GROUP_ORDER.filter((k) => buckets.has(k)).map((k) => ({
      key: k,
      label: t(GROUP_LABEL[k]),
      items: buckets.get(k)!.sort(cmp),
    }));
  }, [releases, grouped, sort, t]);

  if (releases.length === 0) return <Empty label={t('sj.artist.noReleases')} />;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2 pb-1">
        <Segmented
          options={[
            { key: 'type', label: t('sj.artist.groupByType') },
            { key: 'all', label: t('sj.artist.groupAll') },
          ]}
          value={grouped ? 'type' : 'all'}
          onChange={(v) => setGrouped(v === 'type')}
        />
        <Segmented
          options={[
            { key: 'newest', label: t('sj.artist.sortNewest') },
            { key: 'oldest', label: t('sj.artist.sortOldest') },
            { key: 'title', label: t('sj.artist.sortTitle') },
          ]}
          value={sort}
          onChange={(v) => setSort(v as SortKey)}
        />
      </div>

      {sections.map((section) => (
        <section key={section.key} className="mt-4 first:mt-3">
          {section.label && (
            <h2 className="flex items-baseline gap-2 px-1 pb-1">
              <span className="text-[13px] font-bold text-ink">{section.label}</span>
              <span className="text-[11px] text-muted tabular-nums">
                {section.items.length === 1
                  ? t('sj.artist.oneRelease')
                  : t('sj.artist.nReleases').replace('{n}', String(section.items.length))}
              </span>
            </h2>
          )}
          <ul className="divide-y divide-divider">
            {section.items.map((r) => (
              <ReleaseRow
                key={r.id}
                release={r}
                artistName={artistName}
                myScore={myRatings[r.id]}
                communityScore={releaseScores[r.id]}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Pill group. Plain buttons, so tab/enter work without extra key handling. */
function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div role="group" className="flex items-center gap-0.5 p-0.5 rounded-full bg-surface border border-divider/60">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={`px-2.5 py-1 rounded-full text-[11.5px] whitespace-nowrap transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
            value === o.key
              ? 'bg-accent/[0.14] text-ink font-bold'
              : 'text-muted hover:text-ink font-medium'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** One discography row — unchanged from the flat list it replaced. */
function ReleaseRow({
  release: r,
  artistName,
  myScore,
  communityScore,
}: {
  release: SJRelease;
  artistName: string;
  myScore?: number;
  communityScore?: number;
}) {
  const { t } = useLanguage();
  const title = displayName(r.title, r.titleNative);
  return (
    <li>
      <Link
        href={`/album/${r.id}`}
        className="group flex items-center gap-3 py-2.5 px-1 hover:bg-surface/70 rounded-lg transition"
      >
        <AlbumPeek
          releaseId={r.id}
          title={title}
          artist={artistName}
          release={r}
          className="relative shrink-0"
        >
          <Cover url={r.coverUrl} className="w-11 h-11" rounded="rounded-md" />
          <AlbumBookmarkButton
            releaseGroupId={r.id}
            size={20}
            className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition"
          />
          <AlbumRateButton
            release={r}
            initialScore={myScore ?? null}
            size={22}
            className="absolute -bottom-1 -right-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition"
          />
        </AlbumPeek>
        <span className="flex-1 min-w-0">
          <span className="block text-[13.5px] font-semibold text-ink truncate">{title}</span>
          <span className="block text-[11.5px] text-muted">
            {t(typeLabelKey(r.releaseType))}
            {yearOf(r.releaseDate) && ` · ${yearOf(r.releaseDate)}`}
          </span>
        </span>
        {myScore != null ? (
          <ScoreChip score={myScore} accent />
        ) : communityScore != null ? (
          <ScoreChip score={communityScore} />
        ) : (
          <span className="flex w-6 h-6 rounded-full border-[1.5px] border-divider items-center justify-center">
            <Plus size={10} className="text-muted" />
          </span>
        )}
      </Link>
    </li>
  );
}

function ArtistStats({
  allScores,
  releases,
  releaseScores,
  releaseCounts,
  myRatings,
  communityAvg,
}: {
  allScores: number[];
  releases: SJRelease[];
  releaseScores: Record<string, number>;
  releaseCounts: Record<string, number>;
  myRatings: Record<string, number>;
  communityAvg: number | null;
}) {
  const { t } = useLanguage();

  if (allScores.length === 0 && Object.keys(myRatings).length === 0) {
    return <Empty label={t('sj.artist.noRatings')} />;
  }

  // 0.5-bucket distribution
  const bins: Record<number, number> = {};
  for (const s of allScores) {
    const key = Math.round(s * 2);
    bins[key] = (bins[key] ?? 0) + 1;
  }
  const binEntries = [];
  for (let key = 10; key >= 1; key--) {
    if (bins[key]) binEntries.push({ key, count: bins[key] });
  }
  const maxCount = Math.max(1, ...binEntries.map((b) => b.count));

  const top = releases
    .map((r) => ({
      release: r,
      score: releaseScores[r.id],
      count: releaseCounts[r.id],
    }))
    .filter((x) => x.score != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 3);

  const myRated = Object.values(myRatings).filter((s) => s > 0);
  const myAvg = myRated.length ? myRated.reduce((a, b) => a + b, 0) / myRated.length : null;

  return (
    <div className="py-5 space-y-8 max-w-lg">
      {binEntries.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold tracking-[0.06em] uppercase text-muted mb-3">
            {t('sj.artist.scoreDistribution')}
          </h3>
          <div className="space-y-1.5">
            {binEntries.map(({ key, count }) => {
              const val = key / 2;
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-7 text-right text-[11px] font-medium text-muted tabular-nums">
                    {Number.isInteger(val) ? val : val.toFixed(1)}
                  </span>
                  <span className="flex-1 h-3.5">
                    <span
                      className="block h-full rounded bg-accent/75"
                      style={{ width: `${(count / maxCount) * 100}%` }}
                    />
                  </span>
                  <span className="text-[11px] text-muted tabular-nums">{count}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {top.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold tracking-[0.06em] uppercase text-muted mb-2">
            {t('sj.artist.topReleases')}
          </h3>
          <ul className="divide-y divide-divider">
            {top.map(({ release, score, count }, i) => (
              <li key={release.id}>
                <Link
                  href={`/album/${release.id}`}
                  className="flex items-center gap-2.5 py-2 hover:bg-surface/70 rounded-lg px-1 transition"
                >
                  <span className="w-5 text-[11px] font-bold text-muted">#{i + 1}</span>
                  <Cover url={release.coverUrl} className="w-9 h-9" rounded="rounded" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12px] font-semibold text-ink truncate">
                      {displayName(release.title, release.titleNative)}
                    </span>
                    <span className="block text-[10px] text-muted">
                      {count === 1
                        ? t('sj.artist.oneRating')
                        : t('sj.artist.nRatings').replace('{n}', String(count))}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-accent">
                    <FlowerGlyph size={10} />
                    <span className="text-[12px] font-bold">{(score ?? 0).toFixed(1)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {myRated.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold tracking-[0.06em] uppercase text-muted mb-3">
            {t('sj.artist.yourCoverage')}
          </h3>
          <div className="flex gap-8">
            <Stat
              value={`${myRated.length}/${releases.length}`}
              label={t('sj.artist.releasesRated')}
            />
            {myAvg != null && (
              <Stat value={myAvg.toFixed(1)} label={t('sj.artist.yourAvg')} />
            )}
            {myAvg != null && communityAvg != null && (
              <Stat
                value={`${myAvg - communityAvg >= 0 ? '+' : ''}${(myAvg - communityAvg).toFixed(1)}`}
                label={t('sj.artist.vsCommunity')}
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
