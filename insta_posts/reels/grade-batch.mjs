// Grade every ranking reel of the batch from the shared sheet reels/data/albums.csv, and write each reel's
// folder (reels/work/<tag>/: graded.json, reel.json, assets/) ready for render-reel.mjs.
//
//   node --env-file=../apps/web/.env.local reels/grade-batch.mjs [tag ...] [--refresh]
//
// Same formula as grade.mjs (60% 평점 / 15% 인기 / 25% 수상), plus the batch rules (decided 2026-11-06):
//   - only albums with a public rating are ranked (RYM or AOTY); a reel with fewer than MIN_RATED is skipped
//   - an AOTY user score from fewer than 10 ratings is ignored (the count is in the notes column:
//     "AOTY score from only N ratings"); RYM alone is used for that album
// Last.fm results are cached in reels/data/auto.json and covers in reels/data/covers/, shared by all reels.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastfm, deezer } from './grade.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DATA = join(ROOT, 'data');
const W = { ratings: 0.6, reach: 0.15, recognition: 0.25 };
const MIN_RATED = 6, MIN_AOTY_COUNT = 10;

// title (two lines), award wording for the caption, hashtags
const KMA_AWARD = '한국대중음악상 수상';
const REELS = {
  'kma-aoty':        ['한대음 올해의 음반\n점수로 줄 세우기', '한국대중음악상 올해의 음반', KMA_AWARD, '#한국대중음악상 #한대음 #올해의음반 #명반'],
  'kma-hiphop':      ['한대음 힙합 앨범 수상작\n점수로 줄 세우기', '한국대중음악상 최우수 랩&힙합 음반', KMA_AWARD, '#한국힙합 #한국대중음악상 #한대음 #힙합앨범'],
  'kma-modernrock':  ['한대음 모던록 수상작\n점수로 줄 세우기', '한국대중음악상 최우수 모던록 음반', KMA_AWARD, '#한국대중음악상 #한대음 #모던록 #인디밴드 #밴드음악'],
  'kma-pop':         ['한대음 팝 앨범 수상작\n점수로 줄 세우기', '한국대중음악상 최우수 팝 음반', KMA_AWARD, '#한국대중음악상 #한대음 #팝 #명반'],
  'kma-rnb':         ['한대음 R&B 수상작\n점수로 줄 세우기', '한국대중음악상 최우수 R&B&소울 음반', KMA_AWARD, '#한국대중음악상 #한대음 #알앤비 #RnB #소울'],
  'kma-electronic':  ['한대음 일렉트로닉 수상작\n점수로 줄 세우기', '한국대중음악상 최우수 일렉트로닉 음반', KMA_AWARD, '#한국대중음악상 #한대음 #일렉트로닉 #전자음악'],
  'kma-folk':        ['한대음 포크 수상작\n점수로 줄 세우기', '한국대중음악상 최우수 포크 음반', KMA_AWARD, '#한국대중음악상 #한대음 #포크'],
  'kma-rock':        ['한대음 록 수상작\n점수로 줄 세우기', '한국대중음악상 최우수 록 음반', KMA_AWARD, '#한국대중음악상 #한대음 #록 #밴드음악'],
  'kha-hiphop':      ['한국힙합어워즈 올해의 앨범\n점수로 줄 세우기', '한국힙합어워즈 올해의 힙합 앨범', KMA_AWARD, '#한국힙합 #한국힙합어워즈 #힙합앨범'],
  'disco-epikhigh':  ['에픽하이 정규 앨범\n점수로 줄 세우기', '에픽하이 정규 앨범', KMA_AWARD, '#에픽하이 #EpikHigh #타블로 #한국힙합'],
  'disco-dynamicduo':['다이나믹 듀오 정규 앨범\n점수로 줄 세우기', '다이나믹 듀오 정규 앨범', KMA_AWARD, '#다이나믹듀오 #개코 #최자 #한국힙합'],
  'disco-blackskirts':['검정치마 정규 앨범\n점수로 줄 세우기', '검정치마 정규 앨범', KMA_AWARD, '#검정치마 #TheBlackSkirts #조휴일 #인디'],
  'disco-hyukoh':    ['혁오 앨범\n점수로 줄 세우기', '혁오 앨범·EP', KMA_AWARD, '#혁오 #HYUKOH #오혁 #밴드'],
  'disco-barbershop':['언니네 이발관 정규 앨범\n점수로 줄 세우기', '언니네 이발관 정규 앨범', KMA_AWARD, '#언니네이발관 #이석원 #한국인디 #명반'],
  'disco-kanye':     ['칸예 웨스트 정규 앨범\n점수로 줄 세우기', '칸예 웨스트 정규 앨범', '그래미 앨범 부문 수상', '#칸예 #칸예웨스트 #KanyeWest #힙합'],
  'disco-radiohead': ['라디오헤드 정규 앨범\n점수로 줄 세우기', '라디오헤드 정규 앨범', '그래미 앨범 부문 수상', '#라디오헤드 #Radiohead #톰요크 #명반'],
  'disco-kendrick':  ['켄드릭 라마 정규 앨범\n점수로 줄 세우기', '켄드릭 라마 정규 앨범', '그래미 앨범 부문 수상', '#켄드릭라마 #KendrickLamar #힙합 #명반'],
  'disco-tyler':     ['타일러 더 크리에이터 정규 앨범\n점수로 줄 세우기', '타일러 더 크리에이터 정규 앨범', '그래미 앨범 부문 수상', '#타일러더크리에이터 #TylerTheCreator #힙합'],
  'disco-beatles':   ['비틀스 정규 앨범\n점수로 줄 세우기', '비틀스 정규 앨범', '그래미 앨범 부문 수상', '#비틀스 #TheBeatles #명반 #올드팝'],
  'disco-arcticmonkeys':['악틱 몽키즈 정규 앨범\n점수로 줄 세우기', '악틱 몽키즈 정규 앨범', '머큐리상·브릿 어워드 앨범 수상', '#악틱몽키즈 #ArcticMonkeys #밴드 #브릿팝'],
};

function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/).filter((l) => l.trim())) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); rows.push(out);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const logScale = (x, lo, hi) => (x == null || x <= 0 ? null : Math.max(0, Math.min(100, ((Math.log10(x) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * 100)));
const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const aotyCount = (notes) => { const m = /AOTY score from only (\d+) rating/.exec(notes || ''); return m ? Number(m[1]) : null; };

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes('--refresh');
  const tags = args.filter((a) => !a.startsWith('--'));
  const sheet = parseCsv(await readFile(join(DATA, 'albums.csv'), 'utf8'));
  const autoPath = join(DATA, 'auto.json');
  const auto = existsSync(autoPath) && !refresh ? JSON.parse(await readFile(autoPath, 'utf8')) : {};
  await mkdir(join(DATA, 'covers'), { recursive: true });
  const summary = [];

  for (const tag of tags.length ? tags : Object.keys(REELS)) {
    const [title, poolName, awardWord, hashtags] = REELS[tag];
    const pool = sheet.filter((r) => r.reels.split(';').includes(tag));
    const rated = pool.filter((r) => num(r.rym) != null || num(r.aoty_user) != null);
    if (rated.length < MIN_RATED && rated.length < pool.length) { summary.push(`${tag}: SKIPPED (${rated.length}/${pool.length} rated, need ${MIN_RATED})`); continue; }
    const dir = join(ROOT, 'work', tag);
    await mkdir(join(dir, 'assets'), { recursive: true });
    const graded = [];
    for (const a of rated) {
      if (!auto[a.id]) {
        const names = [a.artist_en, a.artist_ko, a.aliases].filter(Boolean);
        const variants = (a.album_search || a.album).split('|').map((x) => x.trim()).filter(Boolean);
        auto[a.id] = { lastfm: await lastfm(names, variants), deezer: await deezer([a.artist_en, a.artist_ko].filter(Boolean), variants[0]), fetched: new Date().toISOString().slice(0, 10) };
        await writeFile(autoPath, JSON.stringify(auto, null, 2));
      }
      const au = auto[a.id];
      const cover = join(DATA, 'covers', `${a.id}.jpg`);
      if (!existsSync(cover)) {
        const url = au.deezer?.cover || au.lastfm?.entries?.find((e) => e.image)?.image;
        if (url) { const r = await fetch(url); if (r.ok) await writeFile(cover, Buffer.from(await r.arrayBuffer())); }
      }
      const art = existsSync(cover) ? `assets/${a.id}.jpg` : null;
      if (art) await copyFile(cover, join(dir, art));
      const rym = num(a.rym), cnt = aotyCount(a.notes);
      const aoty = cnt != null && cnt < MIN_AOTY_COUNT ? null : num(a.aoty_user);
      const wins = num(a.award_wins) ?? 0;
      const parts = {
        ratings: mean([rym != null ? rym * 20 : null, aoty]),
        reach: logScale(au.lastfm?.listeners, 1e1, 1e5),
        recognition: Math.min(100, 25 * wins),
      };
      const used = Object.keys(W).filter((k) => parts[k] != null);
      const ws = used.reduce((s, k) => s + W[k], 0);
      graded.push({
        id: a.id, artist: a.artist_ko, artist_en: a.artist_en, album: a.album, year: a.year, art,
        inputs: { rym, aoty_user: num(a.aoty_user), aoty_used: aoty != null, award_wins: wins, lastfm_listeners: au.lastfm?.listeners ?? null },
        matched: { lastfm: au.lastfm ? `${au.lastfm.entries.length} entries, top: ${au.lastfm.entries[0].artist} — ${au.lastfm.entries[0].name}` : null },
        parts, grade: used.reduce((s, k) => s + (W[k] / ws) * parts[k], 0), draft: false, no_lastfm: parts.reach == null,
      });
    }
    graded.sort((x, y) => y.grade - x.grade);
    await writeFile(join(dir, 'graded.json'), JSON.stringify({ weights: W, generated: new Date().toISOString().slice(0, 10), albums: graded }, null, 2));
    const top = Math.min(10, graded.length);
    const left = pool.length - rated.length;
    const reel = {
      type: 'countdown', data: 'graded.json', top,
      title, sub: `${poolName} ${rated.length}장`,
      end: '여러분의 1위는?',
      caption: `${poolName} ${pool.length}장 가운데 RYM·AOTY 평점이 공개된 ${rated.length}장을 같은 공식으로 점수 매겨봤습니다.\n\n` +
        `점수 = RYM·AOTY 유저 평점 60% + 인기(Last.fm 청취자 수) 15% + ${awardWord} 25%. 평점은 각 사이트에 공개된 값이고, AOTY 평가가 10건 미만인 앨범은 RYM 평점만 썼습니다. 청취자 수는 Last.fm에 표기가 다른 항목까지 합산했습니다.` +
        `${left ? ` 평점이 없는 ${left}장은 제외했습니다.` : ''} (2026년 11월 기준)\n\n여러분의 1위는?`,
      hashtags,
      ...(tag.startsWith('disco-') ? { lineTitle: `${poolName.replace(/ (정규 )?앨범.*$/, '')}
앨범 평점 추이`, lineSub: 'RYM·AOTY 유저 평점 평균 (0–100)', lineEnd: '여러분이 가장 좋아하는 앨범은?' } : {}),
    };
    await writeFile(join(dir, 'reel.json'), JSON.stringify(reel, null, 2));
    summary.push(`${tag}: ${rated.length}/${pool.length} rated → top ${top}: ` + graded.slice(0, 3).map((g) => `${g.album} ${g.grade.toFixed(1)}`).join(' / ') +
      (graded.some((g) => !g.art) ? `  ! no cover: ${graded.filter((g) => !g.art).map((g) => g.album).join(', ')}` : '') +
      (graded.some((g) => g.no_lastfm) ? `  ! no Last.fm: ${graded.filter((g) => g.no_lastfm).map((g) => g.album).join(', ')}` : ''));
  }
  console.log(summary.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
