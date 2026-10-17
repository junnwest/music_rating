/**
 * Read-only: reproduce the Taste tab's map (app/api/taste/profile/route.ts) for
 * the users with the most album ratings and print every world, what folded into
 * "Other" and why, sample albums per world, language/primary per album, and how
 * many tiles each album shows under (thumbnail repetition).
 *
 *   npx tsx --env-file=.env.local scripts/dump-taste-map.ts [--top=3] [--user=<username>] [--samples=12] [--all]
 */
import { createClient } from '@supabase/supabase-js';
import { yearOf } from '../lib/taste/albumVector';
import { buildTasteMap, placeAlbum, MAX_WORLDS, MIN_WORLD_ALBUMS, MIN_WORLD_SHARE, OTHER_WORLD, type AlbumPlacement } from '../lib/taste/worlds';
import { qualifiedInfo } from '../lib/genres/language';
import { artistInputFor, loadArtistPriors } from '../lib/taste/artistPrior';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const TOP = Number(arg('top') ?? 3);
const SAMPLES = Number(arg('samples') ?? 12);
const ALL = process.argv.includes('--all');

interface RatingRow {
  score: number | null;
  release_groups: {
    id: string;
    title: string;
    artist_display: string;
    native_title: string | null;
    genres: string[] | null;
    first_release_date: string | null;
    primary_artist_id: string | null;
    title_language: string | null;
    artists: { name: string | null; country: string | null; native_language: string | null } | null;
  } | null;
}

const label = (k: string) => (k === OTHER_WORLD ? 'Other' : qualifiedInfo(k)?.display.en ?? k);

async function topUsers(): Promise<{ id: string; username: string | null; n: number }[]> {
  const only = arg('user');
  let q = db.from('profiles').select('id, username');
  if (only) q = q.eq('username', only);
  const { data, error } = await q;
  if (error) throw error;
  const out = await Promise.all(
    (data ?? []).map(async (p: { id: string; username: string | null }) => {
      const { count } = await db.from('ratings').select('release_group_id', { count: 'exact', head: true }).eq('user_id', p.id);
      return { id: p.id, username: p.username, n: count ?? 0 };
    }),
  );
  return out.sort((a, b) => b.n - a.n).slice(0, only ? 1 : TOP);
}

async function dump(user: { id: string; username: string | null; n: number }) {
  const { data, error } = await db
    .from('ratings')
    .select(
      'score, release_groups(id, title, artist_display, native_title, genres, first_release_date, primary_artist_id, title_language, artists!release_groups_primary_artist_id_fkey(name, country, native_language))',
    )
    .eq('user_id', user.id)
    .limit(500);
  if (error) throw error;
  const rows = ((data as unknown as RatingRow[]) ?? []).filter((r) => r.release_groups);
  const priors = await loadArtistPriors(db, rows.map((r) => r.release_groups!.primary_artist_id));
  const placed = rows.map((r) => {
    const rg = r.release_groups!;
    const placement: AlbumPlacement = placeAlbum({
      genres: rg.genres,
      title: rg.title,
      nativeTitle: rg.native_title,
      artistCountry: rg.artists?.country ?? null,
      artistNativeLanguage: rg.artists?.native_language ?? null,
      titleLanguage: rg.title_language,
      artistName: rg.artists?.name ?? null,
      ...artistInputFor(priors, rg.primary_artist_id, rg.id, rg.artists?.country),
    });
    return { r, rg, placement, inferred: !rg.genres?.length && placement.world != null };
  });
  const rated = placed
    .filter((p) => p.r.score != null)
    .map((p) => ({
      id: p.rg.id,
      score: p.r.score!,
      year: yearOf(p.rg.first_release_date),
      country: p.rg.artists?.country ?? null,
      placement: p.placement,
      confidence: p.inferred ? 0.5 : 1,
    }));
  const map = buildTasteMap(rated);

  // Raw (pre-fold) worlds, to explain the folding.
  const raw = new Map<string, { mass: number; n: number }>();
  for (const a of rated) {
    if (!a.placement.world) continue;
    const e = raw.get(a.placement.world) ?? { mass: 0, n: 0 };
    e.mass += a.confidence;
    e.n += 1;
    raw.set(a.placement.world, e);
  }
  const total = [...raw.values()].reduce((s, e) => s + e.mass, 0);
  const unplaced = rated.filter((a) => !a.placement.world).length;
  console.log(`\n════ ${user.username} — ${user.n} ratings (${rows.length} fetched, ${rated.length} scored, ${unplaced} unplaced, total mass ${total}) ════`);
  console.log(`Raw worlds (${raw.size}), rank order — MAX_WORLDS=${MAX_WORLDS}, MIN_WORLD_SHARE=${MIN_WORLD_SHARE}, MIN_WORLD_ALBUMS=${MIN_WORLD_ALBUMS}:`);
  // Where each raw world's albums ended up on the emitted map.
  const finalWorld = new Map<string, string>();
  for (const w of map.worlds) for (const id of w.albumIds) finalWorld.set(id, w.key);
  [...raw.entries()]
    .sort((x, y) => y[1].mass - x[1].mass)
    .forEach(([k, e], i) => {
      const share = e.mass / total;
      const dest = new Map<string, number>();
      for (const a of rated) {
        if (a.placement.world !== k) continue;
        const f = finalWorld.get(a.id) ?? '?';
        dest.set(f, (dest.get(f) ?? 0) + 1);
      }
      const fate =
        dest.size === 1 && dest.has(k)
          ? 'kept'
          : [...dest.entries()].map(([d, n]) => (d === k ? `${n} kept` : `${n} → ${label(d)}`)).join(', ');
      console.log(`  ${String(i + 1).padStart(2)}. ${label(k).padEnd(28)} ${k.padEnd(22)} n=${String(e.n).padStart(3)} mass=${e.mass.toFixed(1).padStart(5)} ${(share * 100).toFixed(1).padStart(5)}%  ${fate}`);
    });

  console.log(`\nEmitted worlds (${map.worlds.length}):`);
  for (const w of map.worlds) {
    console.log(`  ${w.label.en.padEnd(28)} mass=${String(w.mass).padStart(5)} share=${w.share} tiles=${w.tiles.map((t) => `${t.key ?? t.id}:${t.mass}`).join(', ')}`);
  }

  // Tiles per album as the route ships them (graph.albums[].tags: only the
  // worlds' shipped tile keys — top 8 holding a thumbnail — at most 5): how often
  // one thumbnail repeats. (`?? ` fallbacks let this run against older lib code.)
  const shipped = (w: (typeof map.worlds)[number]) => w.tiles.slice(0, 8).filter((t) => (t.albums ?? 1) > 0);
  const vocab = new Set(map.worlds.flatMap((w) => shipped(w).map((t) => t.key ?? t.id)));
  const counts = map.worlds
    .flatMap((w) => w.albumIds)
    .map((id) => (map.albumTiles.get(id) ?? []).filter((k) => vocab.has(k)).slice(0, 5).length);
  const hist = new Map<number, number>();
  for (const c of counts) hist.set(c, (hist.get(c) ?? 0) + 1);
  console.log(
    `\nTiles per album: mean ${(counts.reduce((s, c) => s + c, 0) / (counts.length || 1)).toFixed(2)}, max ${Math.max(0, ...counts)}, histogram ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' ')}`,
  );

  // What a client sees: each world's mosaic is the union of albumsByTag over its
  // top tiles (TasteGraph.tsx / TasteMapView.swift). Count albums pulled in from
  // other worlds (a tile key shared across worlds) and shipped tiles with no
  // thumbnail; and top-8 tiles left out because nothing shows under them.
  const byTag = new Map<string, string[]>();
  for (const [id, tags] of map.albumTiles) for (const t of tags) byTag.set(t, [...(byTag.get(t) ?? []), id]);
  let leaks = 0;
  let emptyTiles = 0;
  let hidden = 0;
  for (const w of map.worlds) {
    const mine = new Set(w.albumIds);
    const shown = new Set<string>();
    hidden += Math.min(8, w.tiles.length) - shipped(w).length;
    for (const t of shipped(w)) {
      const list = byTag.get(t.key ?? t.id) ?? [];
      if (list.length === 0) emptyTiles++;
      for (const id of list) shown.add(id);
    }
    leaks += [...shown].filter((id) => !mine.has(id)).length;
  }
  console.log(
    `Cross-world thumbnails (album shown in a world it isn't in): ${leaks}; shipped tiles with no thumbnail: ${emptyTiles}; top-8 tiles not shipped: ${hidden}; albums with no thumbnail: ${counts.filter((c) => c === 0).length}`,
  );

  // Samples per world.
  const byWorld = new Map<string, typeof placed>();
  for (const p of placed) {
    const k = p.placement.world ?? '(none)';
    const list = byWorld.get(k) ?? [];
    list.push(p);
    byWorld.set(k, list);
  }
  for (const [k, list] of [...byWorld.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ── ${label(k)} [${k}] (${list.length}) ──`);
    for (const p of ALL ? list : list.slice(0, SAMPLES)) {
      const pl = p.placement;
      console.log(
        `    ${(p.rg.artist_display + ' — ' + (p.rg.native_title ?? p.rg.title)).slice(0, 60).padEnd(60)} ${String(p.rg.artists?.country ?? '--').padEnd(2)} lang=${String(pl.lang).padEnd(4)}(${String(pl.langSource ?? '-').padEnd(13)}) prim=${String(pl.primary).padEnd(22)} alt=${(pl.alternates ?? []).map((x) => `${x.world}:${x.support}`).join('/') || '-'} tags=[${(p.rg.genres ?? []).join(', ')}]${p.inferred ? ' (inferred)' : ''} tiles=${map.albumTiles.get(p.rg.id)?.join('|') ?? '-'}`,
      );
    }
  }
}

async function main() {
  const users = await topUsers();
  console.log('Top users:', users.map((u) => `${u.username}(${u.n})`).join(', '));
  for (const u of users) await dump(u);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
