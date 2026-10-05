import { albumCentroid, cosine } from '../taste/embeddings';
import { buildClusters, clusterProfiles, weightsFromRatings } from '../taste/profile';
import { eraAffinity, sceneAffinity, sceneOf, yearOf } from '../taste/albumVector';
import type { ReleaseGroupEmbed } from '../sj/data';

export interface TasteRating { score: number | null; created_at: string; release_groups: ReleaseGroupEmbed | null }
const clamp = (n: number) => Math.max(0, Math.min(1, n));

export function buildFeedTaste(rows: TasteRating[], now: number) {
  const rated = rows.filter((r): r is TasteRating & { score: number; release_groups: ReleaseGroupEmbed } =>
    r.score != null && !!r.release_groups);
  const mean = rated.length ? rated.reduce((sum, r) => sum + r.score, 0) / rated.length : 3;
  // Shrink the user's baseline toward 3 until enough ratings exist.
  const baseline = (mean * rated.length + 3 * 10) / (rated.length + 10);
  const positive = rated.filter(r => r.score > baseline);
  const artists = new Map<string, { sum: number; count: number }>();
  for (const r of rated) {
    const id = r.release_groups.primary_artist_id;
    if (!id) continue;
    const current = artists.get(id) ?? { sum: 0, count: 0 };
    current.sum += r.score - baseline;
    current.count++;
    artists.set(id, current);
  }
  function profile(input: typeof rated) {
    const clusters = buildClusters(weightsFromRatings(input.map(r => ({
      score: 3 + r.score - baseline, genres: r.release_groups.genres ?? null,
    }))));
    const profiles = clusterProfiles(input.filter(r => r.score > baseline).map(r => ({
      genres: r.release_groups.genres ?? null,
      first_release_date: r.release_groups.first_release_date ?? null,
      country: r.release_groups.artists?.country ?? null,
    })), clusters);
    return { clusters, profiles };
  }
  const established = profile(rated);
  const recentRows = rated.filter(r => now - Date.parse(r.created_at) < 30 * 86400000);
  const recent = recentRows.length >= 5 ? profile(recentRows) : established;
  const artistAffinity = (id: string | null | undefined) => {
    const data = id ? artists.get(id) : null;
    return data ? clamp(0.5 + data.sum / (data.count + 2) / 2) : 0.5;
  };
  function affinity(album: ReleaseGroupEmbed, p: ReturnType<typeof profile>) {
    const vector = albumCentroid(album.genres);
    if (!vector || !p.clusters.length) return 0.75 * 0.5 + 0.25 * artistAffinity(album.primary_artist_id);
    return Math.max(...p.clusters.map((cluster, i) => {
      const context = p.profiles[i];
      const genre = clamp(cosine(vector, cluster.centroid));
      const eraScene = 0.5 * eraAffinity(yearOf(album.first_release_date), context)
        + 0.5 * sceneAffinity(sceneOf(album.artists?.country), context.sceneShares);
      return 0.60 * genre + 0.25 * artistAffinity(album.primary_artist_id) + 0.15 * eraScene;
    }));
  }
  // The viewer's own rated releases. Free here: these rows are already loaded to build the taste model,
  // so familiarity costs no extra query.
  const ratedIds = new Set(rated.map(r => r.release_groups.id));
  return {
    hasRated: (album: ReleaseGroupEmbed) => ratedIds.has(album.id),
    artistIds: [...artists].filter(([, v]) => v.sum > 0).sort((a, b) => b[1].sum - a[1].sum).slice(0, 30).map(([id]) => id),
    genres: [...new Set(positive.flatMap(r => r.release_groups.genres ?? []))].slice(0, 40),
    knownArtist: (album: ReleaseGroupEmbed) => !!album.primary_artist_id && artists.has(album.primary_artist_id),
    score: (album: ReleaseGroupEmbed) => 0.8 * affinity(album, established) + 0.2 * affinity(album, recent),
  };
}
