/**
 * Retry a PostgREST call on TRANSIENT failures — statement timeouts (the Supabase Micro
 * under ingest load) and network drops ("fetch failed", resets) — with linear backoff.
 * Anything else, or the last attempt, throws. Returns the response `data`, so reads use
 * it too. Shared by the genre writer and the display sync (long catalog-wide runs).
 */
const TRANSIENT = /timeout|57014|canceling statement|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network/i;
const ATTEMPTS = 6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pgRetry<T = unknown>(
  label: string,
  fn: () => PromiseLike<{ data?: T | null; error: { message: string } | null }>,
): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    if (attempt > 0) await sleep(1000 * attempt);
    let message: string;
    try {
      const { data, error } = await fn();
      if (!error) return data ?? null;
      message = error.message;
    } catch (e) {
      message = (e as Error).message; // a thrown network error
    }
    if (!TRANSIENT.test(message) || attempt >= ATTEMPTS - 1) throw new Error(`${label}: ${message}`);
  }
}
