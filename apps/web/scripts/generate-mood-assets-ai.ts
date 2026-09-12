/**
 * Generates photographic-style "mood" object images via OpenAI's image API
 * for the same curated object list as fetch-mood-assets-stock.ts, using one
 * consistent prompt template so results don't feel like disconnected
 * one-offs. Saves raw generations + a manifest for a human to review and
 * pick from. Does NOT auto-select or treat anything — that's
 * treat-mood-asset.ts, run by hand on whichever candidate is picked.
 *
 * Costs real money per call — always dry-run first to read the prompts.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/generate-mood-assets-ai.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/generate-mood-assets-ai.ts --term="a cassette tape"
 *   npx tsx --env-file=.env.local scripts/generate-mood-assets-ai.ts
 *
 * Requires: OPENAI_API_KEY in environment.
 */

import fs from 'fs';
import path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const N_PER_TERM = Number(process.argv.find((a) => a.startsWith('--n='))?.split('=')[1] ?? 2);
const ONLY_TERM = process.argv.find((a) => a.startsWith('--term='))?.slice('--term='.length);

const OUT_DIR = path.resolve('scripts/output/mood-assets/raw');
const MANIFEST_PATH = path.resolve('scripts/output/mood-assets/manifest.json');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY && !DRY_RUN) {
  console.error('OPENAI_API_KEY is not set. Add it to .env.local.');
  process.exit(1);
}

// Same curated objects as fetch-mood-assets-stock.ts, phrased as subjects —
// the AI prompt needs a full descriptive sentence, not a search keyword.
const OBJECTS = [
  'a single vinyl record, partially out of its sleeve',
  'a cassette tape',
  'a turntable tonearm and needle',
  'a pair of over-ear headphones',
  'a reel-to-reel tape deck',
  'a portable boombox',
  'acoustic guitar strings, extreme close up',
  'a mixing console with knobs and faders',
];

function buildPrompt(subject: string): string {
  return (
    `Studio product photograph of ${subject}, shot on a 50mm lens, ` +
    `shallow depth of field, moody directional lighting, dark uncluttered ` +
    `background, high detail, no text, no logos, no people, no watermark.`
  );
}

interface ManifestEntry {
  term: string;
  source: 'ai';
  prompt: string;
  file: string;
  fetchedAt: string;
}

async function generate(prompt: string): Promise<Buffer[]> {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      size: '1024x1536', // portrait, closest to the poster's 4:5 art slot
      n: 1,
    }),
  });
  if (!res.ok) {
    console.error(`  [${res.status}] generation failed: ${await res.text()}`);
    return [];
  }
  const data = await res.json();
  return (data.data ?? []).map((d: { b64_json: string }) => Buffer.from(d.b64_json, 'base64'));
}

async function main() {
  const objects = ONLY_TERM ? [ONLY_TERM] : OBJECTS;
  const manifest: ManifestEntry[] = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
    : [];

  if (!DRY_RUN) fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const subject of objects) {
    const prompt = buildPrompt(subject);
    const slug = subject.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40);
    console.log(`\n${subject}`);
    console.log(`  prompt: ${prompt}`);

    if (DRY_RUN) continue;

    for (let i = 0; i < N_PER_TERM; i++) {
      const images = await generate(prompt);
      for (const [j, buf] of images.entries()) {
        const file = `ai-${slug}-${Date.now()}-${i}${j}.png`;
        fs.writeFileSync(path.join(OUT_DIR, file), buf);
        manifest.push({ term: subject, source: 'ai', prompt, file, fetchedAt: new Date().toISOString() });
        console.log(`  saved ${file}`);
      }
    }
  }

  if (!DRY_RUN) {
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(`\nManifest: ${MANIFEST_PATH}`);
    console.log('Review the candidates, pick the best per term, then run treat-mood-asset.ts on each pick.');
  }
}

main();
