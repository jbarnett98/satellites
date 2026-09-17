"""
Build the place list the observer tools use to set a location by name, from Natural Earth.

Natural Earth's 1:10m populated places (public domain) lists 7,343 cities and towns with a
coordinate, a country, and population estimates. The site loads this once, on demand, so a
visitor can type "Glasgow" instead of a latitude and longitude — and so a picked point on
the globe can be described as "near Glasgow".

Input : data/raw/natural_earth/ne_10m_populated_places_simple.geojson
        (downloaded here if absent — one file, one time, ~4 MB)
Output: web/public/data/places/places-ne10m.json
        rows of [name, country, lat, lon, population], most populous first, ~300 KB

Run from pipeline/:  uv run python -m ap_pipeline.places.build_places_from_natural_earth
"""

from __future__ import annotations

import json
import time
import urllib.request

from ap_pipeline.paths import RAW, WEB_PUBLIC, rel

SRC_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
    "ne_10m_populated_places_simple.geojson"
)
SRC = RAW / "natural_earth" / "ne_10m_populated_places_simple.geojson"
OUT = WEB_PUBLIC / "data" / "places" / "places-ne10m.json"


def download() -> None:
    SRC.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {SRC_URL}")
    req = urllib.request.Request(SRC_URL, headers={"User-Agent": "atmospheric-perspective-pipeline"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(SRC, "wb") as out:
        out.write(resp.read())
    print(f"saved {rel(SRC)} ({SRC.stat().st_size / 1_048_576:.1f} MB)")


def main() -> int:
    t0 = time.perf_counter()
    if not SRC.exists():
        download()

    with open(SRC, encoding="utf-8") as fh:
        geo = json.load(fh)

    rows: list[list[object]] = []
    skipped = 0
    for feat in geo["features"]:
        p = feat.get("properties") or {}
        geom = feat.get("geometry") or {}
        coords = geom.get("coordinates")
        name = p.get("name") or p.get("nameascii")
        if not name or not coords or len(coords) < 2:
            skipped += 1
            continue
        lon, lat = float(coords[0]), float(coords[1])
        country = p.get("adm0name") or p.get("sov0name") or ""
        pop = p.get("pop_max") or p.get("pop_min") or 0
        try:
            pop = int(pop)
        except (TypeError, ValueError):
            pop = 0
        # Capitals and big cities first, so a bare "London" means the one people mean.
        rows.append([name, country, round(lat, 3), round(lon, 3), pop])

    rows.sort(key=lambda r: -int(r[4]))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        "source": "Natural Earth 1:10m populated places (public domain), naturalearthdata.com",
        "columns": ["name", "country", "latDeg", "lonDeg", "population"],
        "count": len(rows),
        "rows": rows,
    }
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))

    print(
        f"{len(rows):,} places ({skipped} skipped) → {rel(OUT)} "
        f"({OUT.stat().st_size / 1024:.0f} KB) in {time.perf_counter() - t0:.1f} s"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
