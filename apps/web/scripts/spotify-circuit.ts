/**
 * Shared circuit-breaker helpers for scripts that call Spotify directly.
 *
 * Background: scripts in this directory use raw fetch() against the Spotify
 * API rather than going through lib/spotify.ts. They share the same app
 * credentials as the production web server, so a script burst can trigger
 * an account-wide 429 that breaks production for hours.
 *
 * These helpers let scripts cooperate with the same Redis key the web app's
 * circuit breaker uses:
 *   - assertSpotifyCircuitClosed(): refuse to start if prod is already in
 *     cooldown (running would prolong the outage).
 *   - recordSpotify429(retryAfterSec): publish a script-side 429 to the
 *     shared key so the web app stops hammering Spotify too.
 */

import { Redis } from '@upstash/redis';

const CIRCUIT_KEY = 'spotify:rate-limited-until';

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function assertSpotifyCircuitClosed(): Promise<void> {
  const remainingMs = await spotifyCircuitRemainingMs();
  if (remainingMs <= 0) return;
  const mins = Math.ceil(remainingMs / 60_000);
  throw new Error(
    `Spotify circuit breaker is OPEN (~${mins}min remaining). ` +
    `Production is currently rate-limited; running this script would prolong the outage. ` +
    `Wait until the breaker clears, then retry.`
  );
}

/** Non-throwing check: how long until the shared circuit clears (0 if already closed). */
export async function spotifyCircuitRemainingMs(): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  const until = await redis.get<number>(CIRCUIT_KEY);
  if (!until) return 0;
  return Math.max(0, until - Date.now());
}

export async function recordSpotify429(retryAfterSec: number, source: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const until = Date.now() + retryAfterSec * 1000;
  try {
    await redis.set(CIRCUIT_KEY, until, { ex: Math.max(retryAfterSec, 1) });
    console.error(
      `[scriptCircuit] published 429 from ${source}: retryAfter=${retryAfterSec}s untilUtc=${new Date(until).toISOString()}`
    );
  } catch (err) {
    console.error('[scriptCircuit] failed to set breaker:', err);
  }
}
