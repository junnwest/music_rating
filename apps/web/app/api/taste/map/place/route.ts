import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../../lib/authGuard';
import { rateLimit } from '../../../../../lib/rateLimit';
import { loadArtistInputs, loadMapUserInput } from '../../../../../lib/tasteMap/load';
import { onMapKeys, placeArtist } from '../../../../../lib/tasteMap/place';
import { loadStoredState, mapPositions } from '../../../../../lib/tasteMap/storedState';
import { isUuid } from '../../../../../lib/tasteMap/validatePhase4';
import { canSeeTasteMap } from '../../../../../lib/tasteMap/access';

// GET /api/taste/map/place?artistId=<uuid> → PlaceResponse: where an artist the
// user hasn't rated would land (kNN barycentre in the user's stored metric) and
// why (lib/tasteMap/place.ts). Read-only: never writes.
//   409 { error, key, keys } when the artist is already on the map;
//   409 when there is no stored layout yet (open the map first);
//   422 when the artist has no albums that count for the map.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'taste-map-place', 20, 60);
  if (limited) return limited;
  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!canSeeTasteMap(userId)) return NextResponse.json({ error: 'not available' }, { status: 403 });
  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const artistId = req.nextUrl.searchParams.get('artistId');
  if (!isUuid(artistId)) return NextResponse.json({ error: 'artistId must be an artist id' }, { status: 400 });

  const [input, state] = await Promise.all([loadMapUserInput(db, userId), loadStoredState(db, userId)]);
  const already = onMapKeys(input, artistId, state.overrides);
  if (already.length) return NextResponse.json({ error: 'artist is already on your map', key: already[0], keys: already }, { status: 409 });

  const positions = mapPositions(state);
  if (!positions || !Object.keys(positions).length)
    return NextResponse.json({ error: 'no saved layout yet: open the map first' }, { status: 409 });

  const [candidate] = await loadArtistInputs(db, [artistId]);
  if (!candidate) return NextResponse.json({ error: 'artist not found' }, { status: 404 });

  const res = placeArtist({ input, candidate, overrides: state.overrides, positions, metricRow: state.metric });
  if (res.kind === 'on-map')
    return NextResponse.json({ error: 'artist is already on your map', key: res.keys[0], keys: res.keys }, { status: 409 });
  if (res.kind === 'no-data') return NextResponse.json({ error: 'not enough catalog data to place this artist' }, { status: 422 });
  return NextResponse.json(res.response);
}
