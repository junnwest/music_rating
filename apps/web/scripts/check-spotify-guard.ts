/**
 * Fail the build if a script calls Spotify without cooperating with the shared circuit breaker.
 *
 *   npx tsx scripts/check-spotify-guard.ts
 *
 * WHY THIS IS A CHECK AND NOT A CONVENTION. The Spotify client credentials in .env.local are the
 * PRODUCTION web server's. A script that burns the account's quota does not just slow itself down:
 * it rate-limits live search for every user until the penalty lapses, and those penalties are
 * measured in hours (observed: Retry-After 76816 = 21.3h, then 23.8h on the next attempt).
 *
 * scripts/spotify-circuit.ts has existed for exactly this since 2026-08. Nine scripts called
 * api.spotify.com; six cooperated and three did not, and the one that did not was the one that
 * caused a ~24h production degradation on 2026-10-10. Cooperation was documented, reviewed, and
 * still skipped — so it is enforced here instead.
 *
 * WHAT COUNTS AS COOPERATING: importing ./spotify-client (which checks the breaker before every
 * request and publishes its own 429s) or ./spotify-circuit (to do so directly). Either is fine;
 * neither is optional.
 *
 * Exits 1 with the offending files listed. Wire into CI next to check:vocab and friends.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const DIR = path.resolve(__dirname);
const SPOTIFY_HOST = 'api.spotify.com';
const OK_IMPORTS = ['./spotify-client', './spotify-circuit', 'spotify-client', 'spotify-circuit'];

// The hardened client and the breaker itself are allowed to talk to Spotify directly.
const EXEMPT = new Set(['spotify-client.ts', 'spotify-circuit.ts', 'check-spotify-guard.ts']);

const offenders: string[] = [];
let checked = 0;

for (const name of fs.readdirSync(DIR)) {
  if (!name.endsWith('.ts') || EXEMPT.has(name)) continue;
  const full = path.join(DIR, name);
  let src: string;
  try { src = fs.readFileSync(full, 'utf8'); } catch { continue; }
  if (!src.includes(SPOTIFY_HOST)) continue;
  checked++;
  const cooperates = OK_IMPORTS.some(m => src.includes(`from '${m}'`) || src.includes(`from "${m}"`));
  if (!cooperates) offenders.push(name);
}

if (offenders.length) {
  console.error(`\n  ${offenders.length} script(s) call ${SPOTIFY_HOST} without the shared circuit breaker:\n`);
  for (const o of offenders) console.error(`    scripts/${o}`);
  console.error(`\n  These credentials are production's. Import { recordSpotify429, spotifyCircuitRemainingMs }`);
  console.error(`  from './spotify-circuit' — refuse to call while the breaker is open, and publish your own`);
  console.error(`  429s so the web app stops hammering. Or use ./spotify-client, which does both.\n`);
  process.exit(1);
}

console.log(`  spotify guard: ${checked} script(s) call Spotify, all cooperate with the shared breaker`);
