"""
Build the Earth textures the globe loads, from NASA's full-resolution originals.

Inputs (data/raw/, public domain):
  world.topo.bathy.200412.3x21600x10800.jpg   Blue Marble Next Generation, Dec 2004, with
                                              topography and bathymetry — the day surface
  BlackMarble_2016_3km.jpg                    Black Marble 2016 night lights, 13500×6750
  cloud_combined_8192.tif                     Blue Marble cloud cover composite, 8192×4096

Outputs (web/public/textures/earth/, WebP, equirectangular, width×width/2):
  day-2048 / day-4096 / day-8192              progressive tiers: the site shows 2048 within
  night-2048 / night-8192                     a second, then swaps in the largest tier
  clouds-2048 / clouds-4096                   single-channel cloud opacity

Resampling is Lanczos, which keeps coastlines crisp at each tier. Run from pipeline/:
  uv run python -m ap_pipeline.textures.build_earth_textures_from_nasa
"""

from __future__ import annotations

import sys
import time

from PIL import Image

from ap_pipeline.paths import EARTH_TEXTURES, RAW, ensure_dirs, rel

# The Blue Marble source is 233 megapixels; Pillow's decompression-bomb guard would refuse it.
Image.MAX_IMAGE_PIXELS = None

JOBS: list[dict] = [
    {
        "name": "day",
        "source": RAW / "world.topo.bathy.200412.3x21600x10800.jpg",
        "mode": "RGB",
        "widths": [8192, 4096, 2048],
        "quality": 86,
    },
    {
        "name": "night",
        "source": RAW / "BlackMarble_2016_3km.jpg",
        "mode": "RGB",
        "widths": [8192, 2048],
        "quality": 80,
    },
    {
        "name": "clouds",
        "source": RAW / "cloud_combined_8192.tif",
        "mode": "L",
        "widths": [4096, 2048],
        "quality": 82,
    },
]


def build(job: dict) -> list[str]:
    src = job["source"]
    if not src.exists():
        print(f"  missing source {rel(src)} — skipped", file=sys.stderr)
        return []

    t0 = time.perf_counter()
    with Image.open(src) as im:
        im = im.convert(job["mode"])
        print(f"  {rel(src)}  {im.width}×{im.height} {im.mode}")
        written: list[str] = []
        for width in job["widths"]:
            height = width // 2
            if width > im.width:
                print(f"    skip {width}: source is smaller", file=sys.stderr)
                continue
            out = EARTH_TEXTURES / f"{job['name']}-{width}.webp"
            resized = im if (im.width, im.height) == (width, height) else im.resize((width, height), Image.Resampling.LANCZOS)
            resized.save(out, "WEBP", quality=job["quality"], method=6)
            written.append(f"{rel(out)}  {out.stat().st_size / 1_048_576:.2f} MB")
            print(f"    → {written[-1]}")
    print(f"  done in {time.perf_counter() - t0:.1f} s")
    return written


def main() -> int:
    ensure_dirs()
    total: list[str] = []
    for job in JOBS:
        print(f"{job['name']}:")
        total.extend(build(job))
    print(f"\n{len(total)} textures written to {rel(EARTH_TEXTURES)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
