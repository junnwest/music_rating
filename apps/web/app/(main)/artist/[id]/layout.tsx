import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// See album/[id]/layout.tsx for why this exists. The artist route accepts either a real
// artists.id (uuid) or a raw artist-name slug (page.tsx's own `isId` check) -- mirrored here.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchArtistName(rawId: string): Promise<string> {
  const decoded = decodeURIComponent(rawId);
  if (!UUID_RE.test(decoded)) return decoded;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/artists?id=eq.${decoded}&select=name`,
      {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        next: { revalidate: 3600 },
      }
    );
    const rows: { name: string }[] = await res.json();
    return rows[0]?.name ?? decoded;
  } catch {
    return decoded;
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const name = await fetchArtistName(params.id);
  const pageTitle = `${name} — sillajuku`;
  const description = `Explore ${name}'s discography, community ratings, and reviews on sillajuku.`;

  return {
    title: pageTitle,
    description,
    openGraph: { title: pageTitle, description },
    twitter: { title: pageTitle, description },
  };
}

export default function ArtistLayout({ children }: { children: ReactNode }) {
  return children;
}
