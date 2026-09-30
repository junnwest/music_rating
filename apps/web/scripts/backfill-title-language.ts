/**
 * Backfill release_groups.title_language — the NON-English MusicBrainz tracklist
 * language (migration 20260928000003; see lib/genres/language.ts). mb-ingest fills
 * it going forward on every ingest / freshness re-poll; this fills the existing
 * catalog without waiting for the freshness lane to come round.
 *
 * One light MB call per 100 releases per artist (browseArtistReleaseLanguages —
 * no tracklists), shared 1 req/s limiter. Writes only non-English values, only
 * where they differ, via the same trackTitleLanguage rule the ingest uses.
 *
 * Order (most valuable first): artists with rated albums → artists with prestige
 * albums → artists outside the English-speaking countries (or with no country)
 * → the rest. Resumable: finished artist ids are kept in
 * scripts/data/backfill-title-language-state.json (gitignored).
 *
 *   npx tsx --env-file=.env.local scripts/backfill-title-language.ts [--limit=N] [--gap-ms=0] [--dry-run]
 *
 * --gap-ms adds a pause between artists on top of the 1 req/s limiter — raise it
 * if this machine shares an IP with the running pipeline (MB limits per IP).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { browseArtistReleaseLanguages } from './mb-client';
import { getDB, trackTitleLanguage } from './mb-ingest';
import { pgRetry } from '../lib/genres/pgRetry';

const arg = (f: string) => process.argv.find((a) => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const LIMIT = Number(arg('--limit') ?? Infinity);
const GAP_MS = Number(arg('--gap-ms') ?? 0);
const DRY = process.argv.includes('--dry-run');
const STATE = resolve(__dirname, 'data/backfill-title-language-state.json');
const ENGLISH = new Set(['US', 'GB', 'CA', 'AU', 'IE', 'NZ']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface State {
  done: string[];
  written: number;
  artists: number;
}

function loadState(): State {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    return { done: [], written: 0, artists: 0 };
  }
}
function saveState(s: State) {
  if (!existsSync(resolve(__dirname, 'data'))) mkdirSync(resolve(__dirname, 'data'));
  writeFileSync(STATE, JSON.stringify(s));
}

async function pageAll<T>(label: string, q: (from: number, to: number) => PromiseLike<any>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = (await pgRetry<T[]>(label, () => q(from, from + 999))) ?? [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function main() {
  const db = getDB();
  const state = loadState();
  const done = new Set(state.done);

  // Every MB-linked artist (stable order — PostgREST paging needs it).
  const links = await pageAll<{ artist_id: string; external_id: string; artists: { country: string | null } | null }>(
    'artists',
    (a, b) =>
      db
        .from('artist_external_ids')
        .select('artist_id, external_id, artists(country)')
        .eq('source', 'musicbrainz')
        .order('artist_id')
        .range(a, b),
  );
  const rated = new Set(
    (
      await pageAll<{ release_groups: { primary_artist_id: string } | null }>('rated', (a, b) =>
        db.from('ratings').select('release_groups(primary_artist_id)').order('id').range(a, b),
      )
    ).map((r) => r.release_groups?.primary_artist_id),
  );
  const prestige = new Set(
    (
      await pageAll<{ primary_artist_id: string }>('prestige', (a, b) =>
        db
          .from('release_groups')
          .select('primary_artist_id')
          .not('prestige_score', 'is', null)
          .order('id')
          .range(a, b),
      )
    ).map((r) => r.primary_artist_id),
  );
  const tier = (l: (typeof links)[number]) => {
    if (rated.has(l.artist_id)) return 0;
    if (prestige.has(l.artist_id)) return 1;
    const c = l.artists?.country;
    return !c || !ENGLISH.has(c) ? 2 : 3;
  };
  const queue = links.filter((l) => !done.has(l.artist_id)).sort((x, y) => tier(x) - tier(y));
  console.log(
    `${links.length} MB artists · ${done.size} already done · ${queue.length} to go ` +
      `(tiers: rated ${queue.filter((l) => tier(l) === 0).length}, prestige ${queue.filter((l) => tier(l) === 1).length}, ` +
      `non-English/unknown ${queue.filter((l) => tier(l) === 2).length}, English ${queue.filter((l) => tier(l) === 3).length})${DRY ? ' · DRY RUN' : ''}`,
  );

  const started = Date.now();
  let n = 0;
  for (const l of queue) {
    if (n >= LIMIT) break;
    n++;
    try {
      const groups =
        (await pgRetry<{ id: string; mb_release_group_id: string | null; title_language: string | null }[]>('rgs', () =>
          db
            .from('release_groups')
            .select('id, mb_release_group_id, title_language')
            .eq('primary_artist_id', l.artist_id)
            .not('mb_release_group_id', 'is', null),
        )) ?? [];
      if (groups.length > 0) {
        const eds = await browseArtistReleaseLanguages(l.external_id);
        const byRg = new Map<string, { status: string | null; language: string | null }[]>();
        for (const e of eds) {
          const arr = byRg.get(e.rgId);
          if (arr) arr.push(e);
          else byRg.set(e.rgId, [e]);
        }
        // language → group ids that need it written
        const writes = new Map<string, string[]>();
        for (const g of groups) {
          const lang = trackTitleLanguage(byRg.get(g.mb_release_group_id!) ?? []);
          if (lang && lang !== g.title_language) writes.set(lang, [...(writes.get(lang) ?? []), g.id]);
        }
        for (const [lang, ids] of writes) {
          if (!DRY) {
            await pgRetry('write', () => db.from('release_groups').update({ title_language: lang }).in('id', ids));
          }
          state.written += ids.length;
        }
      }
      done.add(l.artist_id);
      state.done.push(l.artist_id);
      state.artists++;
    } catch (e) {
      // MB unavailable / persistent DB error: leave the artist for the next run.
      console.warn(`\n  skip ${l.external_id}: ${(e as Error).message}`);
    }
    if (n % 25 === 0) {
      if (!DRY) saveState(state);
      const rate = n / ((Date.now() - started) / 3_600_000);
      process.stdout.write(
        `\r  ${n}/${Math.min(queue.length, LIMIT)} artists · tier ${tier(l)} · ${state.written} groups written · ~${Math.round(rate)}/hr   `,
      );
    }
    if (GAP_MS > 0) await sleep(GAP_MS);
  }
  if (!DRY) saveState(state);
  console.log(`\ndone: ${n} artists this run · ${state.written} groups written in total`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
