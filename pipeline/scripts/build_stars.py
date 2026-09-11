"""
build_stars.py — turn the Yale Bright Star Catalogue (BSC5) into the night sky the globe draws.

Input : data/raw/bsc5.dat.gz        (fixed-width, 9,110 records, Hoffleit & Warren 1991, V/50)
Output: web/public/data/stars.json  (column-oriented JSON the browser turns into a point cloud)

Column positions are 1-based byte columns from the V/50 ReadMe:
  76-77 RAh, 78-79 RAm, 80-83 RAs           (J2000)
  84 DE-, 85-86 DEd, 87-88 DEm, 89-90 DEs   (J2000)
  103-107 Vmag, 110-114 B-V, 5-14 Name, 128-147 SpType

Records with no J2000 position (novae, non-stellar entries — 14 of them) are skipped.
Standard library only; run with `py pipeline/scripts/build_stars.py` from the repo root.
"""

from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "raw" / "bsc5.dat.gz"
OUT = ROOT / "web" / "public" / "data" / "stars.json"

# Keep proper names only for stars bright enough that a label could ever matter.
NAME_MAG_LIMIT = 3.5


def col(line: str, start: int, end: int) -> str:
    """1-based inclusive byte columns, like the catalogue ReadMe."""
    return line[start - 1 : end]


def parse(line: str) -> dict | None:
    line = line.rstrip("\n")
    if len(line) < 114:
        line = line.ljust(150)

    rah, ram, ras = col(line, 76, 77), col(line, 78, 79), col(line, 80, 83)
    if not rah.strip():
        return None  # no J2000 position

    ra_deg = 15.0 * (int(rah) + int(ram) / 60.0 + float(ras) / 3600.0)

    sign = -1.0 if col(line, 84, 84) == "-" else 1.0
    ded, dem, des = col(line, 85, 86), col(line, 87, 88), col(line, 89, 90)
    dec_deg = sign * (int(ded) + int(dem) / 60.0 + int(des) / 3600.0)

    vmag_s = col(line, 103, 107).strip()
    if not vmag_s:
        return None
    vmag = float(vmag_s)

    bv_s = col(line, 110, 114).strip()
    bv = float(bv_s) if bv_s else 0.65  # missing colour → treat as sun-like

    return {
        "hr": int(col(line, 1, 4)),
        "name": col(line, 5, 14).strip(),
        "ra": round(ra_deg, 4),
        "dec": round(dec_deg, 4),
        "mag": round(vmag, 2),
        "bv": round(bv, 2),
        "sp": col(line, 128, 147).strip(),
    }


def main() -> int:
    if not SRC.exists():
        print(f"missing {SRC}", file=sys.stderr)
        return 1

    stars: list[dict] = []
    skipped = 0
    with gzip.open(SRC, "rt", encoding="latin-1") as fh:
        for raw in fh:
            rec = parse(raw)
            if rec is None:
                skipped += 1
            else:
                stars.append(rec)

    stars.sort(key=lambda s: s["mag"])  # brightest first; handy for any "top N" use

    names = {i: s["name"] for i, s in enumerate(stars) if s["name"] and s["mag"] <= NAME_MAG_LIMIT}

    out = {
        "source": "Yale Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren 1991), VizieR V/50",
        "epoch": "J2000",
        "units": {"ra": "deg", "dec": "deg", "mag": "V", "bv": "B-V colour index"},
        "count": len(stars),
        "hr": [s["hr"] for s in stars],
        "ra": [s["ra"] for s in stars],
        "dec": [s["dec"] for s in stars],
        "mag": [s["mag"] for s in stars],
        "bv": [s["bv"] for s in stars],
        "names": names,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")

    brightest = stars[0]
    faintest = stars[-1]
    print(f"stars written : {len(stars):,}  (skipped {skipped} without a position)")
    print(f"brightest     : HR {brightest['hr']} {brightest['name']!r} V={brightest['mag']}")
    print(f"faintest      : HR {faintest['hr']} V={faintest['mag']}")
    print(f"named         : {len(names)} stars at V <= {NAME_MAG_LIMIT}")
    print(f"output        : {OUT.relative_to(ROOT)}  ({OUT.stat().st_size/1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
