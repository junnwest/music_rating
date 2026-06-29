/**
 * Seed external_scores from prestige sources (Grammy AOTY, Mercury Prize, etc.).
 *
 * Each source's raw data lives in scripts/data/<source>.ts.
 * This script resolves MB release-group MBIDs via the MusicBrainz search API,
 * then upserts rows into external_scores. After seeding, call
 * reconcile_prestige_scores() (or npm run prestige:reconcile) to push scores
 * into release_groups.prestige_score.
 *
 * Run:
 *   npm run seed:external -- --source grammy_aoty
 *   npm run seed:external -- --source grammy_aoty --dry-run
 *   npm run seed:external -- --source grammy_aoty --year 2024
 *
 * Re-run safely: ON CONFLICT DO NOTHING on (album_title, artist, source, year).
 * Progress saved to scripts/seed-external-scores-state-<source>.json.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { searchReleaseGroups } from './mb-client';

// ── CLI args ──────────────────────────────────────────────────────────────────

const DRY_RUN    = process.argv.includes('--dry-run');
const SOURCE_ARG = (() => { const i = process.argv.indexOf('--source'); return i !== -1 ? process.argv[i + 1] : null; })();
const YEAR_ARG   = (() => { const i = process.argv.indexOf('--year');   return i !== -1 ? parseInt(process.argv[i + 1]) : null; })();

if (!SOURCE_ARG) {
  console.error('Usage: npm run seed:external -- --source <source> [--dry-run] [--year YYYY]');
  console.error('Available sources: grammy_aoty, grammy_rap, grammy_rnb, grammy_rock, grammy_alternative, grammy_pop_vocal, grammy_dance_electronic, mercury_prize, izm_aoty, mama_aoty, kha_hiphop, kha_rnb, kr_masterpiece_100, kma_aoty, rhythmer_hiphop, rhythmer_rnb, mma_aoty, sma_album, golden_disc_bonsang, golden_disc_daesang, weiv_aoty, pitchfork_perfect, rs500, brit_album');
  process.exit(1);
}

const STATE_PATH      = path.resolve(`scripts/seed-external-scores-state-${SOURCE_ARG}.json`);
const MATCH_THRESHOLD = 0.45;

// ── Source registry ───────────────────────────────────────────────────────────

type ExternalEntry = {
  year:            number;
  album:           string;
  artist:          string;
  scoreType:       'award_win' | 'award_nomination' | 'list_rank' | 'review_score';
  normalizedScore: number;
  rawScore?:       number;
  sourceTier:      number;
  mbid?:           string;  // hardcoded MBID override — skips MB search
};

async function loadEntries(source: string): Promise<ExternalEntry[]> {
  switch (source) {
    case 'grammy_aoty': {
      const { GRAMMY_AOTY } = await import('./data/grammy-aoty');
      return GRAMMY_AOTY.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       e.won ? 'award_win' : 'award_nomination',
        normalizedScore: e.won ? 1.0 : 0.35,
        sourceTier:      3,
        mbid:            e.mbid,
      }));
    }
    case 'mercury_prize': {
      const { MERCURY_PRIZE } = await import('./data/mercury-prize');
      return MERCURY_PRIZE.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       e.won ? 'award_win' : 'award_nomination',
        normalizedScore: e.won ? 1.0 : 0.35,
        sourceTier:      3,
        mbid:            e.mbid,
      }));
    }
    case 'izm_aoty': {
      const { IZM_AOTY } = await import('./data/izm-aoty');
      return IZM_AOTY.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       'list_rank' as const,
        normalizedScore: 0.8,
        sourceTier:      2,
        mbid:            e.mbid,
      }));
    }
    case 'mama_aoty': {
      const { MAMA_AOTY } = await import('./data/mama-aoty');
      return MAMA_AOTY.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       e.won ? 'award_win' : 'award_nomination',
        normalizedScore: e.won ? 1.0 : 0.35,
        sourceTier:      3,
        mbid:            e.mbid,
      }));
    }
    case 'kha_hiphop': {
      const { KHA_HIPHOP } = await import('./data/kha-albums');
      return KHA_HIPHOP.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       e.won ? 'award_win' : 'award_nomination',
        normalizedScore: e.won ? 1.0 : 0.35,
        sourceTier:      3,
        mbid:            e.mbid,
      }));
    }
    case 'kha_rnb': {
      const { KHA_RNB } = await import('./data/kha-albums');
      return KHA_RNB.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       e.won ? 'award_win' : 'award_nomination',
        normalizedScore: e.won ? 1.0 : 0.35,
        sourceTier:      3,
        mbid:            e.mbid,
      }));
    }
    case 'kr_masterpiece_100': {
      const { KR_MASTERPIECE_100 } = await import('./data/kr-masterpiece-100');
      return KR_MASTERPIECE_100.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       'list_rank' as const,
        normalizedScore: (101 - e.rank) / 100,
        rawScore:        e.rank,
        sourceTier:      2,
        mbid:            e.mbid,
      }));
    }
    case 'kma_aoty': {
      const { KMA_AOTY } = await import('./data/kma-aoty');
      return KMA_AOTY.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       e.won ? 'award_win' : 'award_nomination',
        normalizedScore: e.won ? 1.0 : 0.35,
        sourceTier:      3,
        mbid:            e.mbid,
      }));
    }
    case 'rhythmer_hiphop': {
      const { RHYTHMER_HIPHOP } = await import('./data/rhythmer-albums');
      return RHYTHMER_HIPHOP.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       'list_rank' as const,
        normalizedScore: (e.total + 1 - e.rank) / e.total,
        rawScore:        e.rank,
        sourceTier:      2,
        mbid:            e.mbid,
      }));
    }
    case 'rhythmer_rnb': {
      const { RHYTHMER_RNB } = await import('./data/rhythmer-albums');
      return RHYTHMER_RNB.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       'list_rank' as const,
        normalizedScore: (e.total + 1 - e.rank) / e.total,
        rawScore:        e.rank,
        sourceTier:      2,
        mbid:            e.mbid,
      }));
    }
    case 'mma_aoty': {
      const { MMA_AOTY } = await import('./data/mma-aoty');
      return MMA_AOTY.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       'award_win' as const,
        normalizedScore: 1.0,
        sourceTier:      3,
        mbid:            e.mbid,
      }));
    }
    case 'sma_album': {
      const { SMA_ALBUM } = await import('./data/sma-album');
      return SMA_ALBUM.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       'award_win' as const,
        normalizedScore: 1.0,
        sourceTier:      3,
        mbid:            e.mbid,
      }));
    }
    case 'golden_disc_bonsang': {
      const { GOLDEN_DISC_BONSANG } = await import('./data/golden-disc-bonsang');
      return GOLDEN_DISC_BONSANG.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       'award_nomination' as const,
        normalizedScore: 0.35,
        sourceTier:      3,
        mbid:            e.mbid,
      }));
    }
    case 'golden_disc_daesang': {
      const { GOLDEN_DISC_DAESANG } = await import('./data/golden-disc-daesang');
      return GOLDEN_DISC_DAESANG.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       'award_win' as const,
        normalizedScore: 1.0,
        sourceTier:      3,
        mbid:            e.mbid,
      }));
    }
    case 'weiv_aoty': {
      const { WEIV_AOTY } = await import('./data/weiv-aoty');
      return WEIV_AOTY.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       'list_rank' as const,
        normalizedScore: e.rank === null ? 0.8 : (10 + 1 - e.rank) / 10,
        rawScore:        e.rank ?? undefined,
        sourceTier:      2,
        mbid:            e.mbid,
      }));
    }
    case 'grammy_rap': {
      const { GRAMMY_RAP } = await import('./data/grammy-rap');
      return GRAMMY_RAP.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       e.won ? 'award_win' : 'award_nomination',
        normalizedScore: e.won ? 1.0 : 0.35,
        sourceTier:      3,
      }));
    }
    case 'grammy_rnb': {
      const { GRAMMY_RNB } = await import('./data/grammy-rnb');
      return GRAMMY_RNB.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       e.won ? 'award_win' : 'award_nomination',
        normalizedScore: e.won ? 1.0 : 0.35,
        sourceTier:      3,
      }));
    }
    case 'grammy_rock': {
      const { GRAMMY_ROCK } = await import('./data/grammy-rock');
      return GRAMMY_ROCK.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       e.won ? 'award_win' : 'award_nomination',
        normalizedScore: e.won ? 1.0 : 0.35,
        sourceTier:      3,
      }));
    }
    case 'grammy_alternative': {
      const { GRAMMY_ALTERNATIVE } = await import('./data/grammy-alternative');
      return GRAMMY_ALTERNATIVE.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       e.won ? 'award_win' : 'award_nomination',
        normalizedScore: e.won ? 1.0 : 0.35,
        sourceTier:      3,
      }));
    }
    case 'grammy_pop_vocal': {
      const { GRAMMY_POP_VOCAL } = await import('./data/grammy-pop-vocal');
      return GRAMMY_POP_VOCAL.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       e.won ? 'award_win' : 'award_nomination',
        normalizedScore: e.won ? 1.0 : 0.35,
        sourceTier:      3,
      }));
    }
    case 'grammy_dance_electronic': {
      const { GRAMMY_DANCE_ELECTRONIC } = await import('./data/grammy-dance-electronic');
      return GRAMMY_DANCE_ELECTRONIC.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       e.won ? 'award_win' : 'award_nomination',
        normalizedScore: e.won ? 1.0 : 0.35,
        sourceTier:      3,
      }));
    }
    case 'pitchfork_perfect': {
      const { PITCHFORK_PERFECT } = await import('./data/pitchfork-perfect');
      return PITCHFORK_PERFECT.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       'list_rank' as const,
        normalizedScore: 1.0,
        sourceTier:      2,
        mbid:            e.mbid,
      }));
    }
    case 'rs500': {
      const { RS500 } = await import('./data/rs500');
      return RS500.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       'list_rank' as const,
        normalizedScore: (501 - e.rank) / 500,
        rawScore:        e.rank,
        sourceTier:      2,
        mbid:            e.mbid,
      }));
    }
    case 'brit_album': {
      const { BRIT_ALBUM } = await import('./data/brit-album');
      return BRIT_ALBUM.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       e.won ? 'award_win' : 'award_nomination',
        normalizedScore: e.won ? 1.0 : 0.35,
        sourceTier:      3,
        mbid:            e.mbid,
      }));
    }
    default:
      throw new Error(`Unknown source "${source}". Add it to the registry in seed-external-scores.ts`);
  }
}

// ── Fuzzy matching ────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9\s가-힣]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wa = new Set(na.split(' ').filter(w => w.length > 1));
  const wb = new Set(nb.split(' ').filter(w => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return 0;
  const inter = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : inter / union;
}

function matchScore(expTitle: string, actTitle: string, expArtist: string, actArtist: string): number {
  const t = similarity(expTitle, actTitle);
  const a = similarity(expArtist, actArtist);
  if (a < 0.25) return 0;
  return t * 0.75 + a * 0.25;
}

// ── MB search + match ─────────────────────────────────────────────────────────

async function findMbid(title: string, artist: string): Promise<string | null> {
  const results = await searchReleaseGroups(title, artist, 5);
  if (results.length === 0) return null;

  const scored = results.map(rg => ({
    mbid:  rg.id,
    score: matchScore(title, rg.title, artist, rg.artistCredit),
  })).sort((a, b) => b.score - a.score);

  const best = scored[0];
  return best.score >= MATCH_THRESHOLD ? best.mbid : null;
}

// ── State ─────────────────────────────────────────────────────────────────────

function loadState(): Set<string> {
  try { return new Set(JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))); }
  catch { return new Set(); }
}

function saveState(done: Set<string>) {
  fs.writeFileSync(STATE_PATH, JSON.stringify([...done]), 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  }

  const allEntries = await loadEntries(SOURCE_ARG!);
  const entries    = YEAR_ARG ? allEntries.filter(e => e.year === YEAR_ARG) : allEntries;
  const done       = loadState();

  console.log(`\n[seed-external-scores] source=${SOURCE_ARG} entries=${entries.length}${DRY_RUN ? ' DRY-RUN' : ''}${YEAR_ARG ? ` year=${YEAR_ARG}` : ''}\n`);

  let inserted = 0, skipped = 0, unmatched = 0, failed = 0;

  for (const entry of entries) {
    const key = `${SOURCE_ARG}::${entry.year}::${entry.album}::${entry.artist}`;
    if (done.has(key)) { skipped++; continue; }

    process.stdout.write(`  [${entry.year}] ${entry.artist} — ${entry.album} … `);

    // Resolve MBID: hardcoded override → MB search → null (stored as unmatched)
    let mbid: string | null = entry.mbid ?? null;
    if (!mbid) {
      mbid = await findMbid(entry.album, entry.artist);
    }

    if (mbid) {
      process.stdout.write(`✓ ${mbid}`);
    } else {
      process.stdout.write('~ no MB match (stored as pending)');
      unmatched++;
    }

    if (!DRY_RUN) {
      const { error } = await supabase.from('external_scores').upsert({
        album_title:          entry.album,
        artist:               entry.artist,
        source:               SOURCE_ARG,
        raw_score:            entry.rawScore ?? null,
        normalized_score:     entry.normalizedScore,
        score_type:           entry.scoreType,
        source_tier:          entry.sourceTier,
        year:                 entry.year,
        mb_release_group_id:  mbid ?? null,
      }, { onConflict: 'album_title,artist,source,year', ignoreDuplicates: true });

      if (error) {
        console.log(`\n    ✗ DB error: ${error.message}`);
        failed++;
        // Do NOT mark as done — let it retry on next run.
        // Exception: duplicate-key errors are permanent, skip those.
        if (error.code === '23505') { done.add(key); saveState(done); }
        continue;
      }
    }

    console.log(DRY_RUN ? ' (dry)' : '');
    inserted++;
    done.add(key);
    saveState(done);
  }

  console.log(`\nDone. inserted=${inserted} skipped=${skipped} unmatched=${unmatched} failed=${failed}`);
  if (unmatched > 0) {
    console.log(`${unmatched} entries stored without MBID — run prestige:reconcile after pipeline ingests those artists.`);
  }
  if (!DRY_RUN && inserted > 0) {
    console.log('\nRunning reconcile_prestige_scores()…');
    const { data, error } = await supabase.rpc('reconcile_prestige_scores');
    if (error) {
      console.log(`reconcile error: ${error.message}`);
    } else {
      const row = Array.isArray(data) ? data[0] : data;
      console.log(`reconcile done — updated=${row?.updated ?? '?'} pending=${row?.pending ?? '?'}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
