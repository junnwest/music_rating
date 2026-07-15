/**
 * READ-ONLY audit — how many collaborators appear ONLY as track-level `feat.` credit text
 * (recordings.artist_display) with no artist row of their own? Quantifies the "credit-graph
 * discovery blind spot" that hid Masta Wu.
 */
import { getDB } from './itunes-ingest-core';

const db = getDB();

// Normalize for membership testing: NFKC, lowercase, strip everything but alphanumerics + CJK.
function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

async function pageAll(table: string, columns: string, orderBy: string): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order(orderBy).range(from, from + 999);
    if (error) throw new Error(`${table} page@${from}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

async function main() {
  // 1) Build the set of every name we could resolve a collaborator to.
  console.log('Loading artist names + aliases…');
  const known = new Set<string>();
  const artists = await pageAll('artists', 'id,name,name_native,name_phonetic_ko', 'id');
  for (const a of artists) {
    for (const v of [a.name, a.name_native, a.name_phonetic_ko]) if (v) known.add(norm(v));
  }
  const aliases = await pageAll('artist_aliases', 'alias', 'id');
  for (const a of aliases) if (a.alias) known.add(norm(a.alias));
  console.log(`  ${artists.length} artists, ${aliases.length} aliases → ${known.size} normalized name keys`);

  // 2) Pull distinct artist_display strings that contain a feature marker, with occurrence counts.
  //    Done in SQL (aggregation over 3.16M recordings) via the Management API.
  console.log('Aggregating feat-containing artist_display strings…');
  const token = process.env.SUPABASE_ACCESS_TOKEN!;
  const ref = process.env.NEXT_PUBLIC_SUPABASE_URL!.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)![1];
  async function sql(q: string): Promise<any[]> {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    });
    if (!res.ok) throw new Error(`SQL ${res.status}: ${await res.text()}`);
    return res.json();
  }

  const rows: { artist_display: string; c: number }[] = [];
  const PAGE = 5000;
  for (let off = 0; ; off += PAGE) {
    const batch = await sql(
      `select r.artist_display, count(*)::int as c
       from recordings r join artists a on a.id = r.primary_artist_id
       where a.country = 'KR' and r.artist_display ~* '(feat| featuring|\\(ft)'
       group by r.artist_display order by c desc limit ${PAGE} offset ${off}`,
    );
    rows.push(...batch);
    process.stdout.write(`\r  pulled ${rows.length} distinct display strings…`);
    if (batch.length < PAGE) break;
  }
  console.log('  (scoped to KR-primary releases)');

  // 3) Parse featured names out of each display string and test membership.
  const FEAT = /\b(feat\.?|ft\.?|featuring)\b/i;
  const missing = new Map<string, { display: string; recCount: number }>(); // normName → sample + weight
  let totalFeatStrings = 0;
  for (const { artist_display: disp, c } of rows) {
    const m = disp.match(FEAT);
    if (!m) continue;
    totalFeatStrings++;
    let tail = disp.slice(m.index! + m[0].length);
    tail = tail.replace(/[()\[\]]/g, ' '); // drop bracket wrappers
    // Split on comma, ampersand, slash, and the words "and"/"x"/"with"
    const parts = tail.split(/,|&|\/|\bx\b|\band\b|\bwith\b/i);
    for (let p of parts) {
      p = p.replace(/\bprod\.?.*$/i, '').trim(); // drop "prod. by …" tails
      const key = norm(p);
      if (key.length < 2) continue;
      if (known.has(key)) continue;
      const cur = missing.get(key);
      if (cur) cur.recCount += c;
      else missing.set(key, { display: p.trim(), recCount: c });
    }
  }

  const ranked = [...missing.entries()].sort((a, b) => b[1].recCount - a[1].recCount);
  console.log(`\n=== RESULTS ===`);
  console.log(`Distinct feat-containing display strings parsed: ${totalFeatStrings}`);
  console.log(`Distinct featured names with NO artist-row match: ${ranked.length}`);
  console.log(`\nTop 40 missing feat-only collaborators (by # of track-rows crediting them):`);
  for (const [, v] of ranked.slice(0, 40)) {
    console.log(`  ${String(v.recCount).padStart(5)}  ${v.display}`);
  }

  // Where does Masta Wu land? (sanity — should be gone now if we run post-ingest, present now)
  const mw = ranked.find(([k]) => k === norm('Masta Wu'));
  console.log(`\nMasta Wu in list: ${mw ? `yes (${mw[1].recCount} rows)` : 'no'}`);

  // Dump the full ranked list for downstream classification.
  const { writeFileSync } = await import('node:fs');
  writeFileSync('scripts/_feat-gaps-kr.json',
    JSON.stringify(ranked.map(([, v]) => ({ name: v.display, recCount: v.recCount })), null, 0));
  console.log(`\nWrote ${ranked.length} names to scripts/_feat-gaps-kr.json`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
