import { albumCommunityScoresServer, communityStats, rest, UUID_RE } from '../../../../lib/sj/serverCatalog';

// Shared by layout.tsx (404 + JSON-LD) and [lang]/page.tsx (title/description). Both make the
// identical fetch, which Next dedupes within a render.

export interface ReleaseRow {
  title: string;
  artist_display: string;
  native_title: string | null;
  release_group_type: string | null;
  first_release_date: string | null;
}

/** null = no such album (non-uuid id, or no row). Throws if the fetch failed (serverCatalog `rest`). */
export async function fetchRelease(id: string): Promise<ReleaseRow | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await rest<ReleaseRow[]>(
    `release_groups?id=eq.${id}&select=title,artist_display,native_title,release_group_type,first_release_date`,
  );
  return rows[0] ?? null;
}

// The same scores and formula the page shows (lib/sj/serverCatalog.ts) -- structured data has to
// match what's actually on the page, or it risks a Google manual action for misleading markup.
// get_album_community_scores includes private accounts (anonymously), like the page's own number;
// this used to read `ratings` directly, which RLS filters down to public accounts.
export async function fetchRatingStats(releaseGroupId: string): Promise<{ count: number; average: number | null }> {
  const { count, avg } = communityStats(await albumCommunityScoresServer(releaseGroupId));
  return { count, average: avg };
}
