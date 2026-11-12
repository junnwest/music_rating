#!/usr/bin/env bash
# Overnight run (2026-11-07): finish every reel without supervision. Log: reels/overnight.log, report: reels/OVERNIGHT.md
cd "$(dirname "$0")"
ENV=../../apps/web/.env.local
TASKS="$TEMP/claude/68c23c9a5d1d441b/be7b03e9-db8f-49cf-941d-c955ae8896e0/tasks"
export PYTHONIOENCODING=utf-8
log() { echo "=== $(date '+%H:%M:%S') $*"; }

log "1. wait for the teammate song download"
until grep -q 'misses' "$TASKS/bup9oc1ak.output" 2>/dev/null; do sleep 30; done
cat "$TASKS/bup9oc1ak.output" | tail -15

log "2. teammate reels, all 47"
(cd teammate && python retime.py 2>&1 | grep -v Deprecation)

log "3. retry missing songs: our reels"
node --env-file=$ENV fetch-tracks.mjs 2>&1 | tail -25
log "3b. retry missing songs: teammate reels"
(cd teammate && node --env-file=../$ENV music.mjs 2>&1 | tail -15)
NEW=$(cd teammate && python - <<'PY'
import json, os, subprocess
m = json.load(open('music.json', encoding='utf8'))
names = []
for n, v in m.items():
    if not v.get('file'): continue
    out = os.path.join('out', n + '.mp4')
    probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out], capture_output=True, text=True).stdout
    if 'audio' not in probe: names.append(n)
print(' '.join(names))
PY
)
if [ -n "$NEW" ]; then log "3c. re-run teammate videos that got a song on the retry: $NEW"; (cd teammate && python retime.py $NEW 2>&1 | grep -v Deprecation); fi

log "4. regrade (writes timeline titles), render timeline reels"
node --env-file=$ENV grade-batch.mjs 2>&1 | tail -25
for d in work/disco-*; do [ -f $d/reel.json ] || continue; node render-reel.mjs $(basename $d) line 2>&1 | tail -1; done

log "5. mix audio into every ranking reel (countdown, barrace, line)"
for d in work/kma-* work/kha-* work/disco-*; do [ -f $d/reel.json ] || continue; node add-audio.mjs $(basename $d) 2>&1 | tail -4; done

log "6. report"
python - <<'PY'
import glob, json, os, subprocess
def has_audio(f):
    return 'audio' in subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout
def dur(f):
    try: return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout.strip())
    except: return 0
lines = ['# Overnight run', '', '## Ranking reels (`reels/out/<reel>/`)', '', '| reel | countdown | barrace | timeline |', '|---|---|---|---|']
tracks = json.load(open('data/tracks.json', encoding='utf8'))
for d in sorted(glob.glob('out/*/')):
    tag = os.path.basename(d.rstrip('/\\'))
    if not tag.startswith(('kma-', 'kha-', 'disco-')): continue
    cells = []
    for t in ('countdown', 'barrace', 'line'):
        f = os.path.join(d, f'reel-{t}.mp4')
        cells.append('—' if not os.path.exists(f) else f"{dur(f):.0f}s {'♪' if has_audio(f) else 'silent'}")
    lines.append(f'| {tag} | ' + ' | '.join(cells) + ' |')
miss = sorted(k for k, v in tracks.items() if not v.get('file'))
lines += ['', f'Albums with no song (their card is silent): {len(miss)}', '', ', '.join(miss) or 'none', '',
          '## Teammate reels (`reels/teammate/out/`)', '']
tm = sorted(glob.glob('teammate/out/*.mp4'))
silent = [os.path.basename(f) for f in tm if not has_audio(f)]
lines += [f'{len(tm)} videos, {len(tm) - len(silent)} with music.', '', 'Silent: ' + (', '.join(silent) or 'none')]
open('OVERNIGHT.md', 'w', encoding='utf8').write('\n'.join(lines) + '\n')
print('\n'.join(lines))
PY
log "ALL DONE"
