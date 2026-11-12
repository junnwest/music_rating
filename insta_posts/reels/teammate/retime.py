"""Re-edit the teammate's "앨범 평점 모음" reels (2026-11-06 request):
  1. faster pacing: transitions play TRANSITION_SPEED x faster and each card hold is cut to HOLD_CAP seconds
  2. overall score (scores.json, critics/users 50/50): blurred on the first slide, revealed on the last slide

    python -I retime.py [name-substring ...]

Reads src/<name>.mp4, writes out/<name>.mp4 (+ caption with the score line). The videos are static cards joined by
animated transitions, so holds are found with ffmpeg freezedetect: a still stretch of >= 1 s is a hold.
"""
import json, os, re, subprocess, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, OUT, OV = (os.path.join(HERE, d) for d in ('src', 'out', 'overlays'))
TRANSITION_SPEED = 0.85
HOLD_CAP = 2.6          # content cards
TITLE_CAP = 2.2         # first slide (cover + title + blurred score)
SUMMARY_CAP = 3.0       # the all-scores card before the end
END_MIN = 3.6           # last slide (logo + revealed score) is held at least this long
FPS = 30
LEVELS = 20   # focus-pull steps rendered by overlays.mjs

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding='utf8', errors='replace')

def probe_duration(f):
    return float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).stdout.strip())

def has_audio(f):
    return 'audio' in run(['ffprobe', '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', f]).stdout

def holds(f, dur):
    err = run(['ffmpeg', '-v', 'info', '-i', f, '-vf', 'freezedetect=n=0.003:d=0.25', '-map', '0:v', '-f', 'null', '-']).stderr
    starts = [float(x) for x in re.findall(r'freeze_start: ([0-9.]+)', err)]
    ends = [float(x) for x in re.findall(r'freeze_end: ([0-9.]+)', err)]
    iv = [(s, ends[i] if i < len(ends) else dur) for i, s in enumerate(starts)]
    # merge freezes separated by < 0.12 s (freezedetect splits a hold when one frame flickers)
    merged = []
    for s, e in iv:
        if merged and s - merged[-1][1] < 0.12: merged[-1] = (merged[-1][0], e)
        else: merged.append((s, e))
    return [(s, e) for s, e in merged if e - s >= 1.0]

def accent(f, t):
    """Colour of the sillajuku wordmark on the last slide (each video uses its own accent)."""
    png = os.path.join(OV, '_frame.png')
    run(['ffmpeg', '-v', 'error', '-y', '-ss', str(t), '-i', f, '-frames:v', '1', png])
    im = Image.open(png).convert('RGB').crop((250, 850, 830, 1120))
    px = [p for p in im.get_flattened_data() if sum(p) < 330]
    if not px: return '#3a2a22'
    px.sort(key=sum)
    px = px[: max(1, len(px) // 3)]
    r, g, b = (sum(c[i] for c in px) // len(px) for i in range(3))
    return f'#{r:02x}{g:02x}{b:02x}'


def compose_end(f, t, od):
    """New last slide: the original end frame with its logo + CTA erased (clean_end), the same logo moved down and
    scaled, and the text/badge layer from overlays.mjs on top. Writes end.png and end_blur.png (opaque)."""
    import numpy as np
    from PIL import ImageFilter
    from clean_end import clean
    raw = os.path.join(od, '_end_raw.png'); bgp = os.path.join(od, '_end_bg.png')
    run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.3f}', '-i', f, '-frames:v', '1', raw])
    clean(raw, bgp)
    fr = np.asarray(Image.open(raw).convert('RGB'), dtype=np.float32)
    bg = Image.open(bgp).convert('RGB')
    diff = np.abs(fr - np.asarray(bg, dtype=np.float32)).sum(axis=2)
    alpha = np.clip((diff - 12) / 50, 0, 1)
    ys, xs = np.nonzero(alpha[300:1700, 100:980] > 0.3)
    y0, y1, x0, x1 = ys.min() + 300 - 8, ys.max() + 300 + 8, xs.min() + 100 - 8, xs.max() + 100 + 8
    logo = np.dstack([fr[y0:y1, x0:x1], alpha[y0:y1, x0:x1] * 255]).astype(np.uint8)
    li = Image.fromarray(logo, 'RGBA')
    k = 0.72
    li = li.resize((int(li.width * k), int(li.height * k)), Image.LANCZOS)
    base = bg.convert('RGBA'); base.alpha_composite(li, ((1080 - li.width) // 2, 1150))
    for i in range(LEVELS + 1):
        canvas = base.copy()
        canvas.alpha_composite(Image.open(os.path.join(od, f'lvl_{i:02d}.png')).convert('RGBA'))
        canvas.convert('RGB').save(os.path.join(od, f'end_{i:02d}.png'))

def end_clip(od, length, hold=0.45, pull=0.9):
    """The end slide as a clip: blurred for `hold` s, then an eased focus pull over `pull` s, then sharp."""
    lst = os.path.join(od, '_end.txt')
    frames = []
    n_hold, n_pull = round(hold * FPS), round(pull * FPS)
    frames += [0] * n_hold
    for k in range(1, n_pull + 1):
        u = k / n_pull
        e = 1 - (1 - u) ** 3  # ease-out
        frames.append(round(e * LEVELS))
    frames += [LEVELS] * max(1, round(length * FPS) - len(frames))
    with open(lst, 'w', encoding='utf8') as fh:
        for i in frames:
            path = os.path.join(od, f'end_{i:02d}.png').replace(chr(92), '/')
            fh.write(f"file '{path}'\nduration {1 / FPS:.6f}\n")
        path = os.path.join(od, f'end_{LEVELS:02d}.png').replace(chr(92), '/')
        fh.write(f"file '{path}'\n")
    clip = os.path.join(od, '_end.mp4')
    r = run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-vf', f'fps={FPS},format=yuv420p', '-c:v', 'libx264', '-crf', '14', '-t', f'{length:.3f}', clip])
    if r.returncode: raise RuntimeError(r.stderr[-800:])
    return clip

def plan(f):
    dur = probe_duration(f)
    hs = holds(f, dur)
    if len(hs) < 3: raise RuntimeError(f'{f}: only {len(hs)} holds found')
    segs, t = [], 0.0  # (start, end, speed or None for hold, kind)
    for i, (s, e) in enumerate(hs):
        if s > t: segs.append((t, s, TRANSITION_SPEED, 'tr'))
        kind = 'title' if i == 0 else 'end' if i == len(hs) - 1 else 'summary' if i == len(hs) - 2 else 'card'
        segs.append((s, e, None, kind))
        t = e
    if t < dur - 0.05: segs.append((t, dur, TRANSITION_SPEED, 'tr'))
    return dur, hs, segs

def process(name, score, jobs_only=False):
    f = os.path.join(SRC, name + '.mp4')
    dur, hs, segs = plan(f)
    acc = accent(f, hs[-1][0] + 0.5)
    od = os.path.join(OV, name)
    m = META[name]
    job = {'out_dir': od, 'score': score['overall'], 'critic': score['critic_avg'], 'user': score['user_avg'], 'accent': acc,
           'album': m['album'], 'artist': m['artist'], 'year': m['year']}
    if jobs_only: return job
    parts, new_t, marks = [], 0.0, {}
    for k, (s, e, sp, kind) in enumerate(segs):
        if sp and k + 1 < len(segs) and segs[k + 1][3] == 'end':
            # the transition into the old logo slide: hold the summary card's last frame instead, and let the new
            # end card crossfade in over it (so the old logo never shows)
            ln = max(0.9, (e - s) / sp)  # first half: summary fades out; second half: end card fades in
            parts.append(f'[0:v]trim=start={max(0, s - 0.05):.3f}:end={s:.3f},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={ln:.3f},trim=duration={ln:.3f}[v{k}]')
            marks['pre_end'] = (new_t, ln)
        elif sp:
            ln = (e - s) / sp
            parts.append(f'[0:v]trim=start={s:.3f}:end={e:.3f},setpts=(PTS-STARTPTS)/{sp}[v{k}]')
        else:
            cap = {'title': TITLE_CAP, 'card': HOLD_CAP, 'summary': SUMMARY_CAP, 'end': None}[kind]
            keep = e - s if cap is None else min(e - s, cap)
            ln = keep
            pad = max(0.0, END_MIN - keep) if kind == 'end' else 0.0
            parts.append(f'[0:v]trim=start={s:.3f}:end={s + keep:.3f},setpts=PTS-STARTPTS' + (f',tpad=stop_mode=clone:stop_duration={pad:.3f}' if pad else '') + f'[v{k}]')
            ln += pad
            if kind == 'title': marks['title_end'] = new_t + ln
            if kind == 'end': marks['end_start'] = new_t
        new_t += ln
    total = new_t
    n = len(segs)
    parts.append(''.join(f'[v{k}]' for k in range(n)) + f'concat=n={n}:v=1:a=0,fps={FPS}[base]')
    te, es = marks['title_end'], marks['end_start']
    # overlays: 1 = first (blurred), 2 = last blurred, 3 = last sharp
    parts.append(f'[1:v]format=rgba,fade=t=out:st={te - 0.25:.3f}:d=0.25:alpha=1[o1]')
    ps, pl = marks.get('pre_end', (es - 0.35, 0.35))
    # the new end slide (a clip with the focus pull) crossfades in over the summary card's held frame
    # sequential: the summary card fades out to the bare background, then the new end card fades in
    h = pl / 2
    parts.append(f'[3:v]format=rgba,fade=t=in:st={ps:.3f}:d={h:.3f}:alpha=1[o3]')
    parts.append(f'[2:v]format=rgba,setpts=PTS-STARTPTS+{ps:.3f}/TB,fade=t=in:st={ps + h:.3f}:d={h:.3f}:alpha=1[o2]')
    parts.append(f"[base][o1]overlay=0:0:enable='lte(t,{te:.3f})'[b1];[b1][o3]overlay=0:0:enable='gte(t,{ps:.3f})'[b3];[b3][o2]overlay=0:0:eof_action=pass:enable='gte(t,{ps:.3f})'[vout]")
    cmd = ['ffmpeg', '-v', 'error', '-y', '-i', f]
    compose_end(f, hs[-1][0] + 0.4, od)
    cmd += ['-loop', '1', '-t', f'{total:.3f}', '-framerate', str(FPS), '-i', os.path.join(od, 'first.png')]
    cmd += ['-i', end_clip(od, total - ps, hold=pl + 0.45, pull=0.9)]
    cmd += ['-loop', '1', '-t', f'{total:.3f}', '-framerate', str(FPS), '-i', os.path.join(od, '_end_bg.png')]
    audio = has_audio(f)
    if audio:  # the video's own track, kept
        parts.append(f'[0:a]atrim=0:{total:.3f},afade=t=out:st={max(0, total - 1.2):.3f}:d=1.2[aout]')
    else:      # the album's most-played track (music.mjs: Apple 30 s preview), under the whole video
        mj = os.path.join(HERE, 'music.json')
        mf = (json.load(open(mj, encoding='utf8')).get(name) or {}).get('file') if os.path.exists(mj) else None
        if mf:
            off = max(0.0, min(6.0, 29.5 - total))  # skip a quiet intro when the preview is long enough
            cmd += ['-ss', f'{off:.2f}', '-i', os.path.join(HERE, 'music', mf)]
            parts.append(f'[4:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100,afade=t=in:st=0:d=0.6,apad,atrim=0:{total:.3f},'
                         f'afade=t=out:st={max(0, total - 1.8):.3f}:d=1.8[aout]')
            audio = True
    cmd += ['-filter_complex', ';'.join(parts), '-map', '[vout]'] + (['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k'] if audio else []) + \
           ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', '-t', f'{total:.3f}', os.path.join(OUT, name + '.mp4')]
    r = run(cmd)
    if r.returncode: raise RuntimeError(r.stderr[-1500:])
    cap = os.path.join(SRC, name + '.caption.txt')
    if os.path.exists(cap):
        txt = open(cap, encoding='utf8').read()
        s5 = f"{round(job['score'] / 20, 1):.1f}"
        line = f"종합 점수 {s5} / 5 = 평론가 평균과 유저 평균을 반씩 반영 (100점 만점 점수는 20으로 나눔)" if job['critic'] is not None and job['user'] is not None else f"종합 점수 {s5} / 5 = 유저 평점 평균 (100점 만점 점수는 20으로 나눔)"
        open(os.path.join(OUT, name + '.caption.txt'), 'w', encoding='utf8').write(txt.replace('\n\n', f'\n\n{line}\n\n', 1))
    return f'{name}: {dur:.1f}s -> {total:.1f}s, {len(hs)} holds, score {job["score"]}, accent {acc}{", audio" if audio else ""}'

META = json.load(open(os.path.join(HERE, 'meta.json'), encoding='utf8'))

if __name__ == '__main__':
    scores = json.load(open(os.path.join(HERE, 'scores.json'), encoding='utf8'))
    names = [n for n in sorted(scores) if not sys.argv[1:] or any(a in n for a in sys.argv[1:])]
    os.makedirs(OUT, exist_ok=True); os.makedirs(OV, exist_ok=True)
    jobs = [process(n, scores[n], jobs_only=True) for n in names]
    jp = os.path.join(OV, 'jobs.json'); json.dump(jobs, open(jp, 'w', encoding='utf8'), ensure_ascii=False)
    r = subprocess.run(['node', os.path.join(HERE, 'overlays.mjs'), jp], cwd=HERE, capture_output=True, text=True, encoding='utf8')
    print(r.stdout.strip(), r.stderr.strip()[-500:])
    for n in names:
        try: print(process(n, scores[n]), flush=True)
        except Exception as e: print(f'{n}: FAILED {e}', flush=True)
