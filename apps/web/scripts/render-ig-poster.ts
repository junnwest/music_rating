/**
 * Poster rendering for the Instagram "out now" pipeline — renders a finished
 * 1080x1350 PNG per detected release (cover art + artist/title/date + the real
 * brand wordmark, matching the app's on-brand look — see ShareCardView.swift's
 * card design). Uses the actual `public/logo-text.svg` asset, recolored white
 * via CSS fill inheritance (its paths carry no inline fill, so setting `fill`
 * on the root `<svg>` cascades to all of them) — not a hand-drawn placeholder.
 *
 * No caption is generated — the user writes captions by hand when posting
 * (draft-ig-caption.ts, which called OpenAI for this, was removed since it
 * needs separate API billing beyond a ChatGPT Plus subscription).
 *
 * No rasterizer existed in this repo before (generate-trend-posters.ts only ever
 * outputs HTML, never a PNG) — this uses Playwright to screenshot an HTML/CSS
 * template, reusing the same Noto Sans KR + Latin font pairing already proven
 * there, since a real browser engine gets correct mixed Korean/Latin text shaping
 * for free. Requires a one-time `npx playwright install chromium`.
 *
 *   npx tsx --env-file=.env.local scripts/render-ig-poster.ts
 *   npx tsx --env-file=.env.local scripts/render-ig-poster.ts --limit=10
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { getDB, type DB } from './itunes-ingest-core';

const OUT_DIR = path.resolve('scripts/output/ig-out-now');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const W = 1080, H = 1350;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9가-힣]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';
}

// Real wordmark asset, recolored white for the dark poster background. Its
// paths have no inline fill attribute, so setting fill on the root <svg> (a
// CSS presentation attribute) cascades to every path via normal inheritance —
// no per-path rewriting needed. Width/height attrs are stripped so the CSS
// wrapper controls size while the intrinsic viewBox keeps the aspect ratio.
const WORDMARK_SVG = fs.readFileSync(path.resolve('public/logo-text.svg'), 'utf8')
  .replace(/<\?xml[^>]*\?>/, '')
  .replace(/<svg /, '<svg fill="#F5F0E8" ')
  .replace(/\s(width|height)="[^"]*"/g, '');

function posterHtml(r: { artist: string; title: string; releaseDate: string; primaryType: string; coverUrl: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@500;700;900&family=Plus+Jakarta+Sans:wght@500;700;800&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  #card { position:relative; width:${W}px; height:${H}px; overflow:hidden; background:#1A1A1A;
          font-family:'Plus Jakarta Sans','Noto Sans KR',sans-serif; }
  #cover { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  #scrim { position:absolute; inset:0; background:linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.05) 55%, rgba(0,0,0,0.88) 100%); }
  #brand { position:absolute; top:48px; right:44px; width:150px; filter:drop-shadow(0 1px 4px rgba(0,0,0,0.35)); }
  #brand svg { display:block; width:100%; height:auto; }
  #tag { position:absolute; top:44px; left:44px; background:#E8A020; color:#1A1A1A; font-weight:800;
         font-size:20px; letter-spacing:0.06em; padding:8px 18px; border-radius:999px; text-transform:uppercase; }
  #meta { position:absolute; left:52px; right:52px; bottom:56px; color:#F5F0E8; }
  #artist { font-size:34px; font-weight:700; opacity:0.88; margin-bottom:10px; word-break:keep-all; }
  #title { font-size:56px; font-weight:900; line-height:1.15; margin-bottom:22px; word-break:keep-all; }
  #date { font-size:24px; font-weight:500; opacity:0.72; }
</style></head>
<body>
  <div id="card">
    <img id="cover" src="${r.coverUrl}" crossorigin="anonymous" />
    <div id="scrim"></div>
    <div id="tag">OUT NOW · ${r.primaryType}</div>
    <div id="brand">${WORDMARK_SVG}</div>
    <div id="meta">
      <div id="artist">${r.artist}</div>
      <div id="title">${r.title}</div>
      <div id="date">${r.releaseDate}</div>
    </div>
  </div>
</body></html>`;
}

async function main() {
  const args = process.argv.slice(2);
  const LIMIT = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 25);
  const db: DB = getDB();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { data: rows, error } = await db
    .from('ig_detected_releases')
    .select('id, title, artist_credit, release_date, primary_type, cover_url')
    .eq('status', 'new').not('cover_url', 'is', null).limit(LIMIT);
  if (error) throw new Error(error.message);
  if (!rows?.length) { console.log('No rows are ready to render (need cover_url).'); return; }

  console.log(`Rendering ${rows.length} poster(s)…\n`);
  const browser = await chromium.launch();
  const manifest: any[] = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : [];

  try {
    for (const r of rows as any[]) {
      const page = await browser.newPage({ viewport: { width: W, height: H } });
      try {
        const html = posterHtml({
          artist: r.artist_credit, title: r.title,
          releaseDate: r.release_date ?? '', primaryType: (r.primary_type ?? 'release').toUpperCase(),
          coverUrl: r.cover_url,
        });
        await page.setContent(html, { waitUntil: 'networkidle', timeout: 30_000 });
        const filename = `${r.release_date ?? 'unknown'}-${slug(r.artist_credit)}-${slug(r.title)}.png`;
        const outPath = path.join(OUT_DIR, filename);
        await page.locator('#card').screenshot({ path: outPath });

        const { error: upErr } = await db.from('ig_detected_releases')
          .update({ poster_path: outPath, status: 'rendered', rendered_at: new Date().toISOString() }).eq('id', r.id);
        if (upErr) throw new Error(upErr.message);

        manifest.push({ artist: r.artist_credit, title: r.title, releaseDate: r.release_date, posterPath: outPath, coverUrl: r.cover_url });
        console.log(`  ✓ ${r.artist_credit} — ${r.title} → ${filename}`);
      } catch (e) {
        console.log(`  ✗ ${r.artist_credit} — ${r.title}: ${(e as Error).message}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nWrote ${MANIFEST_PATH}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
