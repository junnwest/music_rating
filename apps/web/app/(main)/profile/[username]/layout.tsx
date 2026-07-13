import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// See album/[id]/layout.tsx for why this exists. Profile already has a per-route
// opengraph-image.tsx (untouched) -- this only adds the missing text title/description,
// reusing the exact same REST-fetch pattern that file already established.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface ProfileRow {
  id: string;
  display_name: string | null;
  bio: string | null;
}

async function fetchProfile(username: string): Promise<ProfileRow | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id,display_name,bio`,
      {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        next: { revalidate: 3600 },
      }
    );
    const rows: ProfileRow[] = await res.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchRatingCount(userId: string): Promise<number> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/ratings?user_id=eq.${userId}&select=id`,
      {
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
          Prefer: 'count=exact',
          'Range-Unit': 'items',
          Range: '0-0',
        },
        next: { revalidate: 3600 },
      }
    );
    const contentRange = res.headers.get('content-range');
    if (!contentRange) return 0;
    const total = contentRange.split('/')[1];
    return total === '*' ? 0 : parseInt(total, 10);
  } catch {
    return 0;
  }
}

export async function generateMetadata({ params }: { params: { username: string } }): Promise<Metadata> {
  const username = decodeURIComponent(params.username);
  const profile = await fetchProfile(username);
  if (!profile) {
    return { title: `@${username} — sillajuku`, description: "Every record you've loved, documented on sillajuku." };
  }

  const name = profile.display_name ?? username;
  const count = await fetchRatingCount(profile.id);
  const pageTitle = `${name} (@${username}) — sillajuku`;
  // Collapse raw newlines/whitespace -- a bio with a real line break would otherwise land in
  // the <meta description> content attribute verbatim (confirmed live: harmless to parsers,
  // but a literal line break inside a search snippet looks broken).
  const cleanBio = profile.bio?.replace(/\s+/g, ' ').trim();
  const description = cleanBio
    ? cleanBio
    : count > 0
      ? `${name} has rated ${count.toLocaleString()} release${count === 1 ? '' : 's'} on sillajuku. See their taste and reviews.`
      : `${name}'s music ratings and reviews on sillajuku.`;

  return {
    title: pageTitle,
    description,
    openGraph: { title: pageTitle, description },
    twitter: { title: pageTitle, description },
  };
}

export default function ProfileLayout({ children }: { children: ReactNode }) {
  return children;
}
