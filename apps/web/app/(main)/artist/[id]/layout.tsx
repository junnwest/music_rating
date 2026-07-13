import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

// See album/[id]/layout.tsx for why this exists. The artist route accepts either a real
// artists.id (uuid) or a raw artist-name slug (page.tsx's own `isId` check) -- mirrored here.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns { name, isMissingId: true } only when the param IS a uuid and no artist row matches --
// an unambiguous "this id doesn't exist" case, safe to 404. A name-slug param that just has zero
// results isn't treated as missing here (that's more like a no-results search than a broken
// link, and the client page already has its own empty state for it) -- only the exact-id-lookup
// case is what this fixes.
async function fetchArtistName(rawId: string): Promise<{ name: string; isMissingId: boolean }> {
  const decoded = decodeURIComponent(rawId);
  if (!UUID_RE.test(decoded)) return { name: decoded, isMissingId: false };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/artists?id=eq.${decoded}&select=name`,
      {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        next: { revalidate: 3600 },
      }
    );
    const rows: { name: string }[] = await res.json();
    if (!rows[0]) return { name: decoded, isMissingId: true };
    return { name: rows[0].name, isMissingId: false };
  } catch {
    return { name: decoded, isMissingId: false };
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const { name } = await fetchArtistName(params.id);
  const pageTitle = `${name} — sillajuku`;
  const description = `Explore ${name}'s discography, community ratings, and reviews on sillajuku.`;

  return {
    title: pageTitle,
    description,
    openGraph: { title: pageTitle, description },
    twitter: { title: pageTitle, description },
  };
}

// See album/[id]/layout.tsx's matching comment -- same soft-404 fix, scoped to the unambiguous
// case only (see fetchArtistName above).
export default async function ArtistLayout({ children, params }: { children: ReactNode; params: { id: string } }) {
  const { isMissingId } = await fetchArtistName(params.id);
  if (isMissingId) notFound();
  return children;
}
