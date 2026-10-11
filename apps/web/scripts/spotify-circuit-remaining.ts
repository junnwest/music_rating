/**
 * Print the seconds remaining on the shared Spotify circuit breaker (0 if closed).
 *
 *   npx tsx --env-file=.env.local scripts/spotify-circuit-remaining.ts
 *
 * WHY THIS EXISTS AS ITS OWN SCRIPT. The breaker lives in Redis and is the one piece of state that
 * decides whether a Spotify-dependent backfill can usefully run at all. Shell glue that waits for a
 * cooldown to lapse needs to ASK rather than assume: a quota ban can be extended while you are
 * sleeping through the first one, so a blind `sleep <retry-after>` can resume straight into another
 * penalty. Exits 0 and prints an integer, so `[ "$(…)" = "0" ]` is a valid readiness test.
 *
 * Prints 0 when Redis is unconfigured — "cannot tell" degrades to "not blocked", matching
 * spotifyCircuitRemainingMs()'s own behaviour, because the alternative is a script that never runs.
 */
import { spotifyCircuitRemainingMs } from './spotify-circuit';

spotifyCircuitRemainingMs()
  .then(ms => console.log(Math.max(0, Math.ceil(ms / 1000))))
  .catch(() => console.log(0));
