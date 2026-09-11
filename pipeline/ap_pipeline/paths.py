"""Where things live. Every pipeline module imports its inputs and outputs from here."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # the repository root
RAW = ROOT / "data" / "raw"                 # downloaded originals, git-ignored
WEB_PUBLIC = ROOT / "web" / "public"        # served verbatim by the site

EARTH_TEXTURES = WEB_PUBLIC / "textures" / "earth"
SKY_TEXTURES = WEB_PUBLIC / "textures" / "sky"
SKY_DATA = WEB_PUBLIC / "data" / "sky"


def ensure_dirs() -> None:
    for d in (EARTH_TEXTURES, SKY_TEXTURES, SKY_DATA):
        d.mkdir(parents=True, exist_ok=True)


def rel(p: Path) -> str:
    """Repository-relative path for log lines."""
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)
