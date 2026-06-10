/**
 * Backfill Jina v3 embeddings for all releases.
 *
 * Generates a 1024-dimensional embedding for each release using the
 * jina-embeddings-v3 model (retrieval.passage task). Stores results in
 * releases.embedding (vector(1024)).
 *
 * Input text per release:
 *   "{title} by {artist}[ / {title_native} by {artist_native}][. {genres}]"
 *
 * Run:
 *   npm run backfill:embeddings
 *   npm run backfill:embeddings -- --dry-run
 *   npm run backfill:embeddings -- --batch=50   (default 64)
 *
 * Resumable: skips releases that already have an embedding.
 * Requires: JINA_API_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js';

const DRY_RUN    = process.argv.includes('--dry-run');
const BATCH_ARG  = process.argv.find(a => a.startsWith('--batch='));
const BATCH_SIZE = BATCH_ARG ? parseInt(BATCH_ARG.split('=')[1]) : 64;
const DELAY_MS   = 200; // stay well below Jina rate limits

const JINA_KEY = process.env.JINA_API_KEY;
if (!JINA_KEY && !DRY_RUN) {
  console.error('JINA_API_KEY not set. Add it to .env.local.');
  process.exit(1);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Text representation ───────────────────────────────────────────────────────

function buildPassageText(r: {
  title: string;
  artist: string;
  title_native: string | null;
  artist_native: string | null;
  genres: string | null;
}): string {
  let text = `${r.title} by ${r.artist}`;
  if (r.title_native || r.artist_native) {
    const nt = r.title_native  ?? r.title;
    const na = r.artist_native ?? r.artist;
    text += ` / ${nt} by ${na}`;
  }
  if (r.genres) {
    const genreList = r.genres.split(',').map(g => g.trim()).filter(Boolean).join(', ');
    if (genreList) text += `. ${genreList}`;
  }
  return text;
}

// ── Jina API ─────────────────────────────────────────────────────────────────

async function embedBatch(
  texts: string[],
  attempt = 0,
): Promise<number[][] | null> {
  await sleep(DELAY_MS);
  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${JINA_KEY}`,
    },
    body: JSON.stringify({
      model:      'jina-embeddings-v3',
      task:       'retrieval.passage',
      dimensions: 1024,
      input:      texts,
    }),
  });

  if (res.status === 429) {
    const wait = Math.min(60000, 5000 * 2 ** attempt);
    process.stdout.write(`\n  [429] Jina rate limit — waiting ${wait / 1000}s… `);
    await sleep(wait);
    if (attempt >= 5) return null;
    return embedBatch(texts, attempt + 1);
  }

  if (!res.ok) {
    console.error(`\n  Jina API error ${res.status}:`, await res.text());
    return null;
  }

  const data = await res.json();
  // Sort by index to ensure order matches input
  const sorted = (data.data as { index: number; embedding: number[] }[])
    .sort((a, b) => a.index - b.index);
  return sorted.map(d => d.embedding);
}

// ── DB ────────────────────────────────────────────────────────────────────────

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

// ── Main ─────────────────────────────────────────────────────────────────────

type ReleaseRow = {
  id: string;
  title: string;
  artist: string;
  title_native: string | null;
  artist_native: string | null;
  genres: string | null;
};

async function main() {
  console.log(`\n  sillajuku embedding backfill — Jina v3${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`  batch size : ${BATCH_SIZE}\n`);

  const db = getDB();

  // Process page-by-page to avoid loading all ~338k rows into memory at once.
  // ORDER BY id uses the PK index — fast even on large tables.
  // ORDER BY ratings_count across 338k rows with embedding IS NULL timed out.
  const PAGE = BATCH_SIZE;
  let done = 0, failed = 0, total = 0;
  let page = 0;

  for (;;) {
    const { data, error } = await db
      .from('releases')
      .select('id, title, artist, title_native, artist_native, genres')
      .is('embedding', null)
      .neq('release_type', 'Single')
      .order('id')
      .range(page * PAGE, (page + 1) * PAGE - 1);

    if (error) { console.error('DB fetch error:', error.message); process.exit(1); }
    if (!data?.length) break;

    const batch = data as ReleaseRow[];
    total += batch.length;
    const texts = batch.map(buildPassageText);

    process.stdout.write(`  [page ${page + 1}, +${batch.length} | done ${done}] embedding… `);

    if (DRY_RUN) {
      console.log(`(dry run) text[0]: "${texts[0].slice(0, 60)}…"`);
      done += batch.length;
      page++;
      continue;
    }

    const embeddings = await embedBatch(texts);
    if (!embeddings) {
      console.log('FAILED (API error) — will retry on next run');
      failed += batch.length;
      page++;
      continue;
    }

    for (let idx = 0; idx < batch.length; idx++) {
      const { error: upErr } = await db
        .from('releases')
        .update({ embedding: JSON.stringify(embeddings[idx]) as any })
        .eq('id', batch[idx].id);
      if (upErr) {
        process.stdout.write(`\n  DB update error for ${batch[idx].id}: ${upErr.message}\n`);
        failed++;
      } else {
        done++;
      }
    }

    console.log(`done (+${batch.length})`);

    // After writing, re-query from page 0 each time — rows with embedding set
    // will be excluded by .is('embedding', null), so the next page 0 is always fresh.
    // (Don't increment page — the window shifts naturally as rows are embedded.)
  }

  if (total === 0) {
    console.log('  All releases already have embeddings. Nothing to do.\n');
    return;
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Embedded  : ${done}
  Failed    : ${failed}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Next: deploy to Vercel so the search route uses hybrid scoring.
`);
}

main().catch(err => { console.error(err); process.exit(1); });
