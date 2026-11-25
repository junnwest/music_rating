import { rest, UUID_RE } from '../../../../lib/sj/serverCatalog';

// Shared by layout.tsx (404 + JSON-LD + noindex) and [lang]/page.tsx (title/description). Both
// make the identical fetch, which Next dedupes within a render.

export interface ArtistInfo {
  name: string;
  coverUrl: string | null;
  isMissingId: boolean;
}

// The artist route accepts either a real artists.id (uuid) or a raw artist-name slug.
// Returns { isMissingId: true } only when the param IS a uuid and no artist row matches --
// an unambiguous "this id doesn't exist" case, safe to 404. A name-slug param that just has zero
// results isn't treated as missing here (that's more like a no-results search than a broken
// link, and the client page already has its own empty state for it) -- only the exact-id-lookup
// case is what this fixes. Throws if the fetch failed (serverCatalog `rest`), so a Supabase error
// isn't cached for a week as a page titled with the raw uuid.
export async function fetchArtist(rawId: string): Promise<ArtistInfo> {
  const decoded = decodeURIComponent(rawId);
  if (!UUID_RE.test(decoded)) return { name: decoded, coverUrl: null, isMissingId: false };
  const rows = await rest<{ name: string; cover_url: string | null }[]>(
    `artists?id=eq.${decoded}&select=name,cover_url`,
  );
  if (!rows[0]) return { name: decoded, coverUrl: null, isMissingId: true };
  return { name: rows[0].name, coverUrl: rows[0].cover_url ?? null, isMissingId: false };
}

export function isUuidParam(rawId: string): boolean {
  return UUID_RE.test(decodeURIComponent(rawId));
}
