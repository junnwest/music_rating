/**
 * Enrichment lanes that run on NON-MusicBrainz resources, so they execute
 * concurrently with the MB ingest without touching its rate limit.
 *
 * EMBEDDINGS — Jina v3 (vector(1024), cosine) on release_groups. Cold-start search/recs
 *   glue (not a taste graph). HNSW auto-indexes new vectors.
 *
 * (COVERS are captured inline at ingest from MB's cover-art-archive flag — no lane needed.
 *  QC = the read-only `mb-audit.ts` sweep.)
 */
import type { DB } from './mb-ingest';

const JINA_KEY = process.env.JINA_API_KEY;
const JINA_DELAY_MS = 200;
function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// release_groups.genres is text[]; build a compact passage for embedding.
interface RgRow {
  id: string; title: string; native_title: string | null; artist_display: string;
  genres: string[] | null; first_release_date: string | null;
}
function buildText(rg: RgRow): string {
  let t = `${rg.title} by ${rg.artist_display}`;
  if (rg.native_title) t += ` / ${rg.native_title}`;
  const g = (rg.genres ?? []).join(', ');
  if (g) t += `. ${g}`;
  const yr = rg.first_release_date?.slice(0, 4);
  if (yr) t += ` (${yr})`;
  return t;
}

async function embedBatch(texts: string[], attempt = 0): Promise<number[][] | null> {
  await sleep(JINA_DELAY_MS);
  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${JINA_KEY}` },
    body: JSON.stringify({ model: 'jina-embeddings-v3', task: 'retrieval.passage', dimensions: 1024, input: texts }),
  });
  // 429 (rate limit) and 5xx (transient Jina server error) → back off + retry.
  if (res.status === 429 || res.status >= 500) {
    const wait = Math.min(60_000, 5_000 * 2 ** attempt);
    process.stdout.write(`\n  [${res.status}] Jina — retrying in ${wait / 1000}s… `);
    await sleep(wait);
    if (attempt >= 5) return null;
    return embedBatch(texts, attempt + 1);
  }
  if (!res.ok) { console.error(`\n  Jina ${res.status}:`, await res.text().catch(() => '')); return null; }
  const data = await res.json();
  return (data.data as { index: number; embedding: number[] }[]).sort((a, b) => a.index - b.index).map(d => d.embedding);
}

export const embeddingsEnabled = () => !!JINA_KEY;

/**
 * Embed one batch of release_groups missing an embedding.
 * Returns: rows embedded (0 = nothing pending; -1 = transient API error, retry later).
 */
/**
 * Embed a batch of release groups.
 *
 * `types` restricts which release-group types are eligible. This exists because embedding the whole
 * catalogue does not fit the plan: the HNSW index already measures 1,893 MB for 237,545 embedded
 * rows (~8.0 KB/row on top of ~4.1 KB/row for the vector(1024) column itself), against a database
 * that is at 6,923 MB of a 12 GB limit. The 253,612 unembedded rows split almost evenly between
 * singles (107,667) and album/EP (107,090); embedding all of them adds roughly 3.1 GB and lands at
 * ~10.0 GB with the stub drain still holding 33,598 artists to ingest, whereas album/EP only adds
 * ~1.3 GB. Singles are also the least useful rows in semantic search -- backfill-embeddings.ts,
 * which does the equivalent job over `releases`, already excludes them for the same reason.
 */
export async function embedReleaseGroupsBatch(
  db: DB, batchSize = 64, types?: string[], cursor?: { after?: string },
): Promise<number> {
  const afterId = cursor?.after;
  if (!JINA_KEY) return 0;
  let q = db.from('release_groups')
    .select('id, title, native_title, artist_display, genres, first_release_date')
    .is('embedding', null);
  if (types?.length) q = q.in('release_group_type', types);
  // KEYSET CURSOR, NOT A BARE ORDER BY. "the next N rows where embedding is null, ordered by id"
  // gets slower every batch: the already-embedded head of the table has to be scanned past before
  // the first match is found, so the same query that was instant at the start eventually exceeds
  // the statement timeout. That is exactly how the 2026-09-22 album/EP run died -- "canceling
  // statement due to statement timeout" after 11,647 of 107,090 rows. Passing the last id forward
  // keeps every batch the same cost as the first.
  if (afterId) q = q.gt('id', afterId);
  const { data, error } = await q.order('id').limit(batchSize);
  if (error) throw new Error(`embed fetch: ${error.message}`);
  const rows = (data ?? []) as RgRow[];
  if (rows.length === 0) return 0;
  // Advance the cursor BEFORE embedding, so a Jina failure still moves past this batch on the next
  // attempt instead of retrying the same rows forever.
  if (cursor) cursor.after = rows[rows.length - 1].id;

  const vecs = await embedBatch(rows.map(buildText));
  if (!vecs) return -1;

  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const { error: upErr } = await db.from('release_groups')
      .update({ embedding: JSON.stringify(vecs[i]) as unknown as string }).eq('id', rows[i].id);
    if (!upErr) n++;
  }
  return n;
}
