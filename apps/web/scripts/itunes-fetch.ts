/**
 * Rate-limited, concurrency-friendly iTunes fetch + a tiny worker pool.
 *
 * Why this exists: the original ingest was fully sequential with a fixed sleep
 * before every call (~60–90 req/min, mostly idle waiting on network latency).
 * This module separates the two controls:
 *   - a GLOBAL token-bucket limiter caps total requests/min (stay under the
 *     ~300/min iTunes 429 ceiling + IP-403 risk — default 220/min),
 *   - a CONCURRENCY pool overlaps request latency so we actually hit that ceiling.
 * A 429/403 sets a SHARED pause so every concurrent worker backs off together.
 */

export function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

// Global min-interval limiter: serializes acquire() calls and spaces them out so
// the aggregate request rate never exceeds `perMin`, regardless of concurrency.
function createLimiter(perMin: number) {
  const intervalMs = 60_000 / perMin;
  let chain: Promise<void> = Promise.resolve();
  let last = 0;
  return function acquire(): Promise<void> {
    chain = chain.then(async () => {
      const wait = Math.max(0, intervalMs - (Date.now() - last));
      if (wait) await sleep(wait);
      last = Date.now();
    });
    return chain;
  };
}

export interface ItunesGet {
  (url: string): Promise<any>;
}

/**
 * Build an iTunes GET bound to a shared rate limiter + shared 429/403 backoff.
 * Returns null on non-OK (after retries) so callers can skip gracefully.
 */
export function makeItunesGet(opts: { perMin?: number; userAgent?: string } = {}): ItunesGet {
  const acquire = createLimiter(opts.perMin ?? 220);
  const userAgent = opts.userAgent ?? 'sillajuku-ingest/2.0';
  let pausedUntil = 0; // shared across all concurrent callers

  async function get(url: string, attempt = 0): Promise<any> {
    // Respect a global pause set by a prior 429/403 (all workers wait together).
    const remaining = pausedUntil - Date.now();
    if (remaining > 0) await sleep(remaining);

    await acquire();
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'User-Agent': userAgent } });
    } catch {
      // transient network error — short backoff, capped retries
      if (attempt >= 5) return null;
      await sleep(Math.min(30_000, 2_000 * 2 ** attempt));
      return get(url, attempt + 1);
    }

    if (res.status === 429 || res.status === 403) {
      const wait = Math.min(120_000, 10_000 * 2 ** attempt); // 10s,20s,40s,80s,120s
      pausedUntil = Math.max(pausedUntil, Date.now() + wait); // make everyone wait
      process.stdout.write(`\n  [${res.status}] iTunes throttled — pausing ${wait / 1000}s… `);
      await sleep(wait);
      if (attempt >= 5) return null;
      return get(url, attempt + 1);
    }
    if (!res.ok) return null;
    try { return await res.json(); } catch { return null; }
  }

  return get;
}

/**
 * Run `worker` over `items` with bounded concurrency. Workers pull from a shared
 * cursor, so a slow item doesn't stall the others.
 */
export async function pool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const n = Math.max(1, Math.min(concurrency, items.length));
  const runners = Array.from({ length: n }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}
