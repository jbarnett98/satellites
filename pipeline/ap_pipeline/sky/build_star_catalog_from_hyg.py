"""
Build the plotted-star catalogue the globe draws, from the HYG database.

HYG (Hipparcos + Yale Bright Star + Gliese, by David Nash, CC-BY-SA 4.0) lists 119,614 stars
with J2000 positions, visual magnitude and B−V colour index. Every one of them becomes a
point in the night sky.

Input : data/raw/hyg_v44.csv.gz
Output: web/public/data/sky/stars-hyg.bin    one little-endian Int16 quadruple per star:
                                             [ra_centideg − 18000, dec_centideg, mag×100, bv×100]
                                             → 8 bytes per star, ~0.9 MB, sorted brightest first
        web/public/data/sky/stars-hyg.json   metadata, licence, counts, and names for the
                                             brightest / proper-named stars keyed by row index

0.01° positional precision (36″) is 30× finer than a pixel at the globe's field of view.
Run from pipeline/:  uv run python -m ap_pipeline.sky.build_star_catalog_from_hyg
"""

from __future__ import annotations

import csv
import gzip
import json
import time

import numpy as np

from ap_pipeline.paths import RAW, SKY_DATA, ensure_dirs, rel

SRC = RAW / "hyg_v44.csv.gz"
OUT_BIN = SKY_DATA / "stars-hyg.bin"
OUT_META = SKY_DATA / "stars-hyg.json"

NAME_MAG_LIMIT = 4.0  # keep Bayer/Flamsteed names down to this magnitude; proper names always


def main() -> int:
    ensure_dirs()
    t0 = time.perf_counter()

    ra: list[float] = []
    dec: list[float] = []
    mag: list[float] = []
    bv: list[float] = []
    names: list[tuple[int, str]] = []  # (row, name) — row resolved after sorting
    skipped = 0

    with gzip.open(SRC, "rt", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        required = {"ra", "dec", "mag", "ci", "proper", "bf", "id"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"HYG columns missing: {sorted(missing)}; have {reader.fieldnames}")

        for row in reader:
            if row["id"] == "0":  # the Sun
                skipped += 1
                continue
            try:
                m = float(row["mag"])
                r = float(row["ra"]) * 15.0  # HYG stores RA in hours
                d = float(row["dec"])
            except ValueError:
                skipped += 1
                continue
            ci = row["ci"].strip()
            c = float(ci) if ci else 0.65
            ra.append(r)
            dec.append(d)
            mag.append(m)
            bv.append(c)
            proper = row["proper"].strip()
            bf = row["bf"].strip()
            if proper:
                names.append((len(ra) - 1, proper))
            elif bf and m <= NAME_MAG_LIMIT:
                names.append((len(ra) - 1, bf))

    ra_a = np.asarray(ra)
    dec_a = np.asarray(dec)
    mag_a = np.asarray(mag)
    bv_a = np.asarray(bv)

    order = np.argsort(mag_a, kind="stable")
    inverse = np.empty_like(order)
    inverse[order] = np.arange(len(order))

    quads = np.empty((len(order), 4), dtype="<i2")
    quads[:, 0] = np.round((ra_a[order] - 180.0) * 100.0)
    quads[:, 1] = np.round(dec_a[order] * 100.0)
    quads[:, 2] = np.round(np.clip(mag_a[order], -32.0, 32.0) * 100.0)
    quads[:, 3] = np.round(np.clip(bv_a[order], -3.0, 3.0) * 100.0)
    OUT_BIN.write_bytes(quads.tobytes())

    name_map = {int(inverse[i]): n for i, n in names}
    meta = {
        "source": "HYG Database v4.4 (David Nash, astronexus.com) — Hipparcos, Yale BSC5 and Gliese",
        "license": "CC BY-SA 4.0",
        "epoch": "J2000",
        "count": int(len(order)),
        "layout": "Int16 little-endian ×4 per star: ra*100-18000 (deg), dec*100 (deg), mag*100, bv*100; sorted by magnitude ascending",
        "magnitude_range": [float(mag_a.min()), float(mag_a.max())],
        "names": {str(k): v for k, v in sorted(name_map.items())},
    }
    OUT_META.write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")

    print(f"stars written : {len(order):,}  (skipped {skipped})")
    print(f"brightest     : {name_map.get(0, '?')}  V={mag_a[order][0]:.2f}")
    print(f"faintest      : V={mag_a[order][-1]:.2f}")
    print(f"named         : {len(name_map):,}")
    print(f"→ {rel(OUT_BIN)}  {OUT_BIN.stat().st_size / 1024:.0f} KB")
    print(f"→ {rel(OUT_META)}  {OUT_META.stat().st_size / 1024:.0f} KB")
    print(f"done in {time.perf_counter() - t0:.1f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
