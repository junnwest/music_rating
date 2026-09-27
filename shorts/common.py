"""Shared helpers. No side effects on import."""
from __future__ import annotations

import json
import re
import subprocess
import unicodedata
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
FONTS = ASSETS / "fonts"
CACHE = ROOT / "cache"
COVERS = CACHE / "covers"
CARDS = CACHE / "cards"
CLIPS = CACHE / "clips"
INTRO = CACHE / "intro"
GROUND = CACHE / "ground"
OUT = ROOT / "out"

W, H = 1080, 1920
FPS = 30

for _d in (COVERS, CARDS, CLIPS, INTRO, GROUND, OUT):
    _d.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------------
# text / ids
# --------------------------------------------------------------------------
def slugify(*parts: str) -> str:
    """Filesystem-safe cache key. Folds accents, keeps non-latin scripts.

    Dropping everything non-ascii would slug a Korean artist/album to "untitled",
    and every Korean review in a batch would then collide on one cover, one card
    and one clip. So NFKD only to strip combining accents (café -> cafe), then
    NFC to put Hangul syllables back together from the jamo NFKD split them into.
    Pure-ascii input round-trips unchanged, so existing slugs and caches hold.
    """
    s = " ".join(p for p in parts if p)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = unicodedata.normalize("NFC", s)
    s = re.sub(r"[^\w\s-]", "", s).strip().lower()
    return re.sub(r"[\s_-]+", "-", s)[:60] or "untitled"


def load_album(path: str | Path = ROOT / "reviews.json") -> dict | None:
    """The optional top-level `album` block: one album, many comments about it.

    Present -> the reel is about a single record, so the album identity is hoisted
    out of the comment cards into an intro and a persistent header. Absent -> the
    old shape, one album per comment, and every card carries its own header.
    """
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return data.get("album") if isinstance(data, dict) else None


def load_reviews(path: str | Path = ROOT / "reviews.json") -> list[dict]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    album = data.get("album") if isinstance(data, dict) else None
    if isinstance(data, dict):
        data = data.get("reviews", [])

    for r in data:
        if album:
            # Comments inherit the record they're about; they only carry the
            # things that differ between them.
            r.setdefault("artist", album.get("artist", ""))
            r.setdefault("album", album.get("album", ""))
            if album.get("cover_url") and not r.get("cover_url"):
                r["cover_url"] = album["cover_url"]

        # Two keys, deliberately. The cover is a property of the record, so all
        # the comments about one album share it and it's fetched once; the card
        # and clip are per comment. Collapsing them would make every comment in a
        # single-album reel overwrite the others' card.
        r.setdefault("cover_slug", slugify(r.get("artist", ""), r.get("album", "")))
        r.setdefault("slug", slugify(r.get("artist", ""), r.get("album", ""),
                                     r.get("username", "")) if album
                     else r["cover_slug"])
        r["text"] = " ".join(r.get("text", "").split())
        # Optional translation, drawn under the original on the same card.
        r["text_ko"] = " ".join((r.get("text_ko") or "").split())
    return data


# --------------------------------------------------------------------------
# fonts
# --------------------------------------------------------------------------
# Preference order, per script. Drop Inter (or your face of choice) into
# assets/fonts to override the latin fallbacks -- Liberation Sans is
# metric-compatible with Arial, which is what RYM itself renders in, so it reads
# as authentic.
#
# The latin faces carry no Hangul at all: every Korean codepoint comes out as
# the .notdef box. So Korean is a separate family, picked per run by compose.py.
# Malgun Gothic is the default here for the same reason Arial is the latin
# default -- it's the face Korean UI is actually rendered in, and its cap height
# matches Arial's at the same pixel size, so mixed runs sit together cleanly.
_FONT_CANDIDATES = {
    "latin": {
        "regular": [
            FONTS / "Inter-Regular.ttf",
            FONTS / "Inter_18pt-Regular.ttf",
            Path("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
            Path("/System/Library/Fonts/Helvetica.ttc"),
            Path("C:/Windows/Fonts/arial.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        ],
        "bold": [
            FONTS / "Inter-Bold.ttf",
            FONTS / "Inter_18pt-Bold.ttf",
            Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
            Path("/System/Library/Fonts/Helvetica.ttc"),
            Path("C:/Windows/Fonts/arialbd.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ],
        "italic": [
            FONTS / "Inter-Italic.ttf",
            Path("/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf"),
            Path("C:/Windows/Fonts/ariali.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf"),
        ],
    },
    "ko": {
        "regular": [
            FONTS / "Pretendard-Regular.ttf",
            FONTS / "NotoSansKR-Regular.ttf",
            Path("C:/Windows/Fonts/malgun.ttf"),
            Path("C:/Windows/Fonts/NotoSansKR-VF.ttf"),
            Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
            Path("/System/Library/Fonts/AppleSDGothicNeo.ttc"),
        ],
        "bold": [
            FONTS / "Pretendard-Bold.ttf",
            FONTS / "NotoSansKR-Bold.ttf",
            Path("C:/Windows/Fonts/malgunbd.ttf"),
            Path("C:/Windows/Fonts/NotoSansKR-VF.ttf"),
            Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"),
            Path("/System/Library/Fonts/AppleSDGothicNeo.ttc"),
        ],
        # Korean faces have no true italic; the upright is the honest fallback.
        "italic": [
            FONTS / "Pretendard-Regular.ttf",
            Path("C:/Windows/Fonts/malgun.ttf"),
            Path("C:/Windows/Fonts/NotoSansKR-VF.ttf"),
            Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        ],
    },
}


@lru_cache(maxsize=None)
def font_path(weight: str = "regular", script: str = "latin") -> Path:
    for p in _FONT_CANDIDATES[script][weight]:
        if p.exists():
            return p
    raise FileNotFoundError(
        f"No {script} {weight} font found. Put a .ttf in {FONTS} and add it to "
        f"_FONT_CANDIDATES."
    )


@lru_cache(maxsize=None)
def font(weight: str, size: int, script: str = "latin"):
    from PIL import ImageFont

    return ImageFont.truetype(str(font_path(weight, script)), size)


# --------------------------------------------------------------------------
# subprocess
# --------------------------------------------------------------------------
def run(cmd: list[str], quiet: bool = True) -> None:
    """Run a command, raising with ffmpeg's own stderr tail on failure.

    encoding is pinned to utf-8: ffmpeg echoes input filenames back in its
    stderr, and with `text=True` alone Python decodes that with the locale codec
    -- cp1252 on Windows -- which blows up on any Hangul slug. The reader thread
    dies, `proc.stderr` comes back None, and the failure path below then raises
    AttributeError instead of showing you what ffmpeg actually said.
    """
    proc = subprocess.run(cmd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        tail = "\n".join(proc.stderr.strip().splitlines()[-25:])
        raise RuntimeError(f"command failed: {' '.join(cmd[:4])} ...\n{tail}")
    if not quiet and proc.stderr:
        print(proc.stderr[-2000:])


def probe_duration(path: str | Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    try:
        return float(out.stdout.strip())
    except ValueError:
        raise RuntimeError(f"ffprobe could not read duration of {path}")
