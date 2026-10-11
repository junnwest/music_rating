/**
 * Paged reads for scripts. Use these instead of a bare `.select()` whenever a result could exceed
 * 1,000 rows.
 *
 * THE BUG THIS EXISTS TO END. PostgREST caps every response at 1,000 rows and says nothing about it:
 * no error, no flag, no truncation notice. A `.select()` over 543,000 rows returns 1,000 and the
 * caller reports a total of 1,000. It has now cost five separate scripts:
 *   - backfill-fast-covers.ts  reported "Total with CAA: 1000" against 543,393
 *   - backfill-native-names-from-aliases.ts  measured 204 candidates of a real 1,432
 *   - backfill-native-titles-maniadb.ts, audit-caa-covers.ts  same shape
 *   - release_tracks counting (2026-10-11), where a truncated page would have understated an
 *     album's track count and mispaired a Korean title onto the wrong release
 * Every one was a silent undercount that looked like a finished job, which is the worst failure
 * mode available: the numbers are plausible, so nobody re-checks them.
 *
 * WHICH PAGER TO USE:
 *   pageByKeyset  — preferred. Walks `id > last` and is stable even while the script WRITES to the
 *                   table it is scanning, which several backfills do (they set cover_url on
 *                   release_groups while paging release_groups). Requires a unique, orderable column.
 *   pageByRange   — for reads with no usable cursor column (join tables like release_tracks, which
 *                   has no id). Uses .range(); rows can shift under a concurrent writer, so prefer
 *                   keyset where a cursor exists.
 *
 * Both stop on a short page, so a caller never has to reason about the cap again.
 */

const PAGE = 1000;

type Builder<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
};

/**
 * Walk a table by a strictly increasing cursor column.
 *
 * `build(after)` must return a query already filtered, ordered by `cursor` ascending, and limited to
 * `PAGE` — `after` is the last value seen, or '' on the first call.
 */
export async function pageByKeyset<T extends Record<string, unknown>>(
  build: (after: string) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  cursor: keyof T & string,
  opts: { max?: number; onPage?: (total: number) => void } = {},
): Promise<T[]> {
  const out: T[] = [];
  let after = '';
  for (;;) {
    const { data, error } = await build(after);
    if (error) throw new Error(`pageByKeyset(${cursor}): ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    opts.onPage?.(out.length);
    const last = String(data[data.length - 1][cursor] ?? '');
    // A page where the cursor did not advance would loop forever; bail rather than spin.
    if (!last || last === after) break;
    after = last;
    if (data.length < PAGE) break;
    if (opts.max && out.length >= opts.max) break;
  }
  return out;
}

/** Walk a query with .range() for tables with no usable cursor column. */
export async function pageByRange<T>(
  q: Builder<T>,
  opts: { max?: number; onPage?: (total: number) => void } = {},
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`pageByRange: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    opts.onPage?.(out.length);
    if (data.length < PAGE) break;
    if (opts.max && out.length >= opts.max) break;
  }
  return out;
}

/** True when a row count is suspiciously exactly the cap — i.e. probably truncated. */
export function looksTruncated(n: number): boolean {
  return n > 0 && n % PAGE === 0;
}
