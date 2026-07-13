import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

// See album/[id]/layout.tsx for why this exists.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface MixRow {
  name: string;
  profiles: { username: string | null; display_name: string | null } | null;
}

async function fetchMix(id: string): Promise<MixRow | null> {
  try {
    const res = await fetch(
      // Explicit FK hint required -- mixes has two possible paths to profiles (the direct
      // owner FK, and a many-to-many via mix_likes), so a plain `profiles(...)` embed is
      // ambiguous (PGRST201) and silently fails (fetchMix's try/catch swallows it, falling
      // through to the generic title/description). Confirmed live against the real API.
      `${SUPABASE_URL}/rest/v1/mixes?id=eq.${id}&select=name,profiles!mixes_user_id_fkey(username,display_name)`,
      {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        next: { revalidate: 3600 },
      }
    );
    const rows: MixRow[] = await res.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const mix = await fetchMix(params.id);
  if (!mix) {
    return { title: 'Mix — sillajuku', description: "A curated collection of music on sillajuku." };
  }

  const author = mix.profiles?.username ?? mix.profiles?.display_name ?? 'someone';
  const pageTitle = `${mix.name} by @${author} — sillajuku`;
  const description = `A mix curated by @${author} on sillajuku. Listen and explore "${mix.name}".`;

  return {
    title: pageTitle,
    description,
    openGraph: { title: pageTitle, description },
    twitter: { title: pageTitle, description },
  };
}

// See album/[id]/layout.tsx's matching comment -- same soft-404 fix. Also correctly covers a
// private mix (fetchMix returns null there too, per RLS on the anon key) -- a private mix should
// look like "not found" to an anonymous crawler, not leak that it exists.
export default async function MixLayout({ children, params }: { children: ReactNode; params: { id: string } }) {
  const mix = await fetchMix(params.id);
  if (!mix) notFound();
  return children;
}
