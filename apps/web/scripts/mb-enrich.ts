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
export async function embedReleaseGroupsBatch(db: DB, batchSize = 64): Promise<number> {
  if (!JINA_KEY) return 0;
  const { data, error } = await db.from('release_groups')
    .select('id, title, native_title, artist_display, genres, first_release_date')
    .is('embedding', null).order('id').limit(batchSize);
  if (error) throw new Error(`embed fetch: ${error.message}`);
  const rows = (data ?? []) as RgRow[];
  if (rows.length === 0) return 0;

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
