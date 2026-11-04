import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../../../lib/authGuard';
import { rateLimit } from '../../../../../../lib/rateLimit';
import { loadArtistInputs } from '../../../../../../lib/tasteMap/load';
import { eraView, parseEraPut, validateSplits } from '../../../../../../lib/tasteMap/eraEdit';
import { isUuid, readJson } from '../../../../../../lib/tasteMap/validatePhase4';

// GET /api/taste/map/eras/[artistId] → EraGetResponse: the artist's whole
// discography (chronological, rated albums marked), the stored override and what
// the automatic detector would do.
// PUT /api/taste/map/eras/[artistId] (EraPutBody) → { ok: true, count }:
//   null → delete the override (back to automatic); [] → merge into one node;
//   ids → split BEFORE each (eras.ts splitEras). Each id must be an album of
//   this artist that counts for the map and isn't its first.
// The map route's input hash includes overrides, so the next map load re-solves.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Ctx = { params: { artistId: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  const limited = await rateLimit(req, 'taste-map-eras', 30, 60);
  if (limited) return limited;
  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  if (!isUuid(params.artistId)) return NextResponse.json({ error: 'invalid artist id' }, { status: 400 });

  const [artists, overrideRes] = await Promise.all([
    loadArtistInputs(db, [params.artistId], { userId }),
    db.from('taste_map_eras').select('split_rg_ids').eq('user_id', userId).eq('artist_id', params.artistId).maybeSingle(),
  ]);
  if (overrideRes.error) return NextResponse.json({ error: 'could not read era override' }, { status: 500 });
  const artist = artists[0];
  if (!artist) return NextResponse.json({ error: 'artist not found' }, { status: 404 });
  const override = overrideRes.data ? ((overrideRes.data.split_rg_ids ?? []) as string[]) : null;
  return NextResponse.json(eraView(artist, override));
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const limited = await rateLimit(req, 'taste-map-eras', 30, 60);
  if (limited) return limited;
  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  if (!isUuid(params.artistId)) return NextResponse.json({ error: 'invalid artist id' }, { status: 400 });

  const body = await readJson(req);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
  const parsed = parseEraPut(body.value);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if (parsed.value === null) {
    const { error } = await db.from('taste_map_eras').delete().eq('user_id', userId).eq('artist_id', params.artistId);
    if (error) return NextResponse.json({ error: 'could not reset eras' }, { status: 500 });
    return NextResponse.json({ ok: true, count: 0 });
  }

  // Rated flags matter: a rated compilation counts for the map and may start an era.
  const [artist] = await loadArtistInputs(db, [params.artistId], { userId, embeddings: false });
  if (!artist) return NextResponse.json({ error: 'artist not found' }, { status: 404 });
  const checked = validateSplits(artist, parsed.value);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const { error } = await db.from('taste_map_eras').upsert(
    { user_id: userId, artist_id: params.artistId, split_rg_ids: checked.value, manual: true, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,artist_id' },
  );
  if (error) return NextResponse.json({ error: 'could not save eras' }, { status: 500 });
  return NextResponse.json({ ok: true, count: checked.value.length });
}
