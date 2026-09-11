"""Where things live. Every pipeline module imports its inputs and outputs from here."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # the repository root
RAW = ROOT / "data" / "raw"                 # downloaded originals, git-ignored
WEB_PUBLIC = ROOT / "web" / "public"        # served verbatim by the site

# Sky and Earth assets (committed to git; rebuilt only when sources or parameters change).
EARTH_TEXTURES = WEB_PUBLIC / "textures" / "earth"
SKY_TEXTURES = WEB_PUBLIC / "textures" / "sky"
SKY_DATA = WEB_PUBLIC / "data" / "sky"

# Orbit data (never committed; refreshed on a schedule; served by the dev middleware now,
# by object storage later).
ORBITS = ROOT / "data" / "orbits"
ORBITS_LATEST = ORBITS / "latest"           # the snapshot the site loads: manifest.json + gp-<ver>.json
ORBITS_STATE = ORBITS / "state.json"        # the fetcher's memory of what it downloaded when
ORBITS_LAST_RUN = ORBITS / "last-run.json"  # summary of the most recent scheduled run
RAW_CELESTRAK = RAW / "celestrak"           # every response we received, pruned after RAW_KEEP_DAYS
ARCHIVE = ROOT / "data" / "archive"         # one gzipped copy per dataset per day, kept forever
LOGS = ROOT / "data" / "logs"

RAW_KEEP_DAYS = 7


def ensure_dirs() -> None:
    for d in (EARTH_TEXTURES, SKY_TEXTURES, SKY_DATA, ORBITS_LATEST, RAW_CELESTRAK, ARCHIVE, LOGS):
        d.mkdir(parents=True, exist_ok=True)


def rel(p: Path) -> str:
    """Repository-relative path for log lines."""
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)
