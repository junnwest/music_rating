import { notFound, permanentRedirect } from 'next/navigation';
import { trackAnchorHref } from '../../../../lib/sj/trackLinks';

// Song pages are retired (2026-10-06): a song rating is a score, and it lives in
// the album's tracklist. Old /song links -- shared, indexed, or in someone's
// history -- land on the album, scrolled to that track.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** The canonical edition's release group for a recording, when no `?rg=` came along. */
async function canonicalReleaseGroup(recordingId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/release_tracks?recording_id=eq.${recordingId}` +
        `&select=releases(is_canonical,release_group_id)&limit=40`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }, next: { revalidate: 86400 } },
    );
    const rows: { releases: { is_canonical: boolean; release_group_id: string } | null }[] = await res.json();
    const rels = (Array.isArray(rows) ? rows : []).map((r) => r.releases).filter((r) => r != null);
    return (rels.find((r) => r.is_canonical) ?? rels[0])?.release_group_id ?? null;
  } catch {
    return null;
  }
}

export default async function SongRedirect({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { rg?: string };
}) {
  const rg = searchParams.rg ?? (await canonicalReleaseGroup(params.id));
  if (!rg) notFound();
  permanentRedirect(trackAnchorHref(rg, params.id));
}
