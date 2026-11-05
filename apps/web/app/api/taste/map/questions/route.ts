import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../../lib/authGuard';
import { rateLimit } from '../../../../../lib/rateLimit';
import { readJsonBody } from '../../../../../lib/tasteMap/store';
import { isNodeKey, isPlainObject } from '../../../../../lib/tasteMap/validatePhase4';
import { loadGhostContext } from '../../../../../lib/tasteMap/ghostContext';
import { buildQuestions, isAnswerable } from '../../../../../lib/tasteMap/questions';
import { getNodeAnswer, setNodeAnswer } from '../../../../../lib/tasteMap/nodeState';
import { loadArtistInputs } from '../../../../../lib/tasteMap/load';
import { splitEras } from '../../../../../lib/tasteMap/eras';
import { canSeeTasteMap, isTasteMapAllowlisted } from '../../../../../lib/tasteMap/access';
import { catalogTargets, readGenreSources, writeManualGenre } from '../../../../../lib/tasteMap/answerCatalog';
import type { AnswerPostResponse, NodeAnswer, QuestionsResponse } from '../../../../../lib/tasteMap/ghostApi';

// Ghost questions (lib/tasteMap/questions.ts, thin.ts).
//
// GET  /api/taste/map/questions → QuestionsResponse: one "Is X closer to A, B
//      or C?" per thin ghost on the user's map that isn't hidden or answered.
// POST /api/taste/map/questions  { key, genreId } | { key, none: true }
//      → AnswerPostResponse. Always stored per user (taste_map_node_state.answer):
//      the answered genre becomes that node's tag override in the map's features,
//      so the next GET /api/taste/map moves it (the answer is in the input hash).
//      For allowlisted users only (access.ts), a genre answer is ALSO written to
//      the catalog as release_genres source 'manual' on the node's untagged /
//      store-genre-only albums (answerCatalog.ts); never for anyone else.
//   404 when the key isn't a node on the user's map; 503 when the node-state
//   table is missing (migration 20261105000000 not applied).
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BODY_BYTES = 2_000;

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'taste-map-questions', 20, 60);
  if (limited) return limited;
  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!canSeeTasteMap(userId)) return NextResponse.json({ error: 'not available' }, { status: 403 });
  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const ctx = await loadGhostContext(db, userId);
  const answered = new Set([...ctx.states].filter(([, s]) => s.answer).map(([k]) => k));
  const res: QuestionsResponse = { questions: buildQuestions(ctx.input, ctx.space, ctx.S, ctx.ghosts, answered) };
  return NextResponse.json(res);
}

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'taste-map-answer', 30, 60);
  if (limited) return limited;
  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!canSeeTasteMap(userId)) return NextResponse.json({ error: 'not available' }, { status: 403 });

  const body = await readJsonBody(req, MAX_BODY_BYTES);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const v = body.value;
  if (!isPlainObject(v)) return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
  if (!isNodeKey(v.key)) return NextResponse.json({ error: 'key is not a node key' }, { status: 400 });
  const none = v.none === true;
  if (!none && !(typeof v.genreId === 'string' && isAnswerable(v.genreId)))
    return NextResponse.json({ error: 'genreId must be a genre id, or send none: true' }, { status: 400 });
  if (none && v.genreId !== undefined) return NextResponse.json({ error: 'send genreId or none, not both' }, { status: 400 });
  const key = v.key;
  const genreId = none ? null : (v.genreId as string);

  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  // The node must be on this user's map: its artist rated, the key one of its eras.
  const artistId = key.split(':')[1];
  const [artists, eraRes, prev] = await Promise.all([
    loadArtistInputs(db, [artistId], { userId, embeddings: false }),
    db.from('taste_map_eras').select('split_rg_ids').eq('user_id', userId).eq('artist_id', artistId).maybeSingle(),
    getNodeAnswer(db, userId, key),
  ]);
  if (prev.error && !prev.error.ok && prev.error.missing)
    return NextResponse.json({ error: 'ghost questions are not available yet' }, { status: 503 });
  const artist = artists[0];
  const split = (eraRes.data as { split_rg_ids: string[] | null } | null)?.split_rg_ids;
  const segment = artist ? splitEras(artist, split ? { artistId, splitAlbumIds: split } : undefined).find((s) => s.key === key) : undefined;
  const byId = new Map((artist?.albums ?? []).map((a) => [a.id, a]));
  const albums = (segment?.albumIds ?? []).map((id) => byId.get(id)).filter((a): a is NonNullable<typeof a> => !!a);
  if (!segment || !albums.some((a) => a.rated)) return NextResponse.json({ error: 'not a node on your map' }, { status: 404 });

  const at = new Date().toISOString();
  const prevOwn = prev.answer?.catalogRgIds ?? [];
  const allowlisted = isTasteMapAllowlisted(userId);

  // Catalog targets first (read-only), so the stored answer remembers which albums it may later replace.
  let targets: string[] = [];
  if (genreId && allowlisted) {
    try {
      const sources = await readGenreSources(db, albums.map((a) => a.id));
      targets = catalogTargets(albums, sources, new Set(prevOwn));
    } catch (e) {
      console.error('[taste-map] answer: catalog read failed, storing the answer only:', (e as Error).message);
    }
  }

  const answer: NodeAnswer = genreId
    ? { genreId, at, ...([...new Set([...prevOwn, ...targets])].length ? { catalogRgIds: [...new Set([...prevOwn, ...targets])] } : {}) }
    : { none: true, at, ...(prevOwn.length ? { catalogRgIds: prevOwn } : {}) };
  const saved = await setNodeAnswer(db, userId, key, answer);
  if (!saved.ok) {
    if (saved.missing) return NextResponse.json({ error: 'ghost questions are not available yet' }, { status: 503 });
    console.error('[taste-map] answer save failed:', saved.message);
    return NextResponse.json({ error: 'could not save' }, { status: 500 });
  }

  let catalog: AnswerPostResponse['catalog'] = null;
  if (genreId && targets.length) {
    try {
      const written = await writeManualGenre(db, albums.filter((a) => targets.includes(a.id)), genreId);
      catalog = { releaseGroups: written };
    } catch (e) {
      console.error('[taste-map] answer: catalog write failed (answer kept for this user):', (e as Error).message);
    }
  }
  const res: AnswerPostResponse = { ok: true, key, catalog };
  return NextResponse.json(res);
}
