/**
 * Seed default ranking votes before launch.
 *
 * Fill in the entries array below, then run:
 *   npx ts-node scripts/seed-votes.ts
 *
 * Each entry needs a Spotify album ID as releaseId.
 * Find it from the album URL: open.spotify.com/album/<ID>
 *
 * To clear all seeds: send DELETE to /api/admin/seed-votes
 */

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
const SEED_SECRET = process.env.SEED_SECRET ?? '';

interface SeedEntry {
  categorySlug: string;
  releaseId: string;      // Spotify album ID
  releaseTitle: string;
  releaseArtist: string;
  releaseCoverUrl: string | null;
  releaseType: string;    // 'Album' | 'EP' | 'Single'
  seedVotes: number;
}

// ─── Fill in your albums here ────────────────────────────────────────────────

const entries: SeedEntry[] = [
  // Best Album of 2024
  // { categorySlug: 'album-2024', releaseId: '', releaseTitle: '', releaseArtist: '', releaseCoverUrl: null, releaseType: 'Album', seedVotes: 1 },

  // Best K-Pop Album of 2024
  // { categorySlug: 'kpop-2024', releaseId: '', releaseTitle: '', releaseArtist: '', releaseCoverUrl: null, releaseType: 'Album', seedVotes: 1 },

  // Best K-Rap Album of 2024
  // { categorySlug: 'krap-2024', releaseId: '', releaseTitle: '', releaseArtist: '', releaseCoverUrl: null, releaseType: 'Album', seedVotes: 1 },

  // Best K-R&B Album of 2024
  // { categorySlug: 'krb-2024', releaseId: '', releaseTitle: '', releaseArtist: '', releaseCoverUrl: null, releaseType: 'Album', seedVotes: 1 },

  // Best K-Indie Album of 2024
  // { categorySlug: 'kindie-2024', releaseId: '', releaseTitle: '', releaseArtist: '', releaseCoverUrl: null, releaseType: 'Album', seedVotes: 1 },

  // Best Indie Album of 2024
  // { categorySlug: 'indie-2024', releaseId: '', releaseTitle: '', releaseArtist: '', releaseCoverUrl: null, releaseType: 'Album', seedVotes: 1 },

  // Best Hip-Hop Album of 2024
  // { categorySlug: 'hiphop-2024', releaseId: '', releaseTitle: '', releaseArtist: '', releaseCoverUrl: null, releaseType: 'Album', seedVotes: 1 },

  // Greatest Album of All Time
  // { categorySlug: 'all-time', releaseId: '', releaseTitle: '', releaseArtist: '', releaseCoverUrl: null, releaseType: 'Album', seedVotes: 1 },
];

// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  if (!SEED_SECRET) {
    console.error('Set SEED_SECRET env var before running');
    process.exit(1);
  }

  const active = entries.filter((e) => e.releaseId);
  if (active.length === 0) {
    console.log('No entries defined — uncomment and fill in the entries array first.');
    process.exit(0);
  }

  const res = await fetch(`${BASE_URL}/api/admin/seed-votes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-seed-secret': SEED_SECRET },
    body: JSON.stringify({ entries: active }),
  });

  const json = await res.json();
  if (!res.ok) {
    console.error('Error:', json);
    process.exit(1);
  }
  console.log(`Seeded ${json.seeded} entries.`);
}

run();
