"""Atmospheric Perspective data pipeline.

Every module here reads something raw from data/raw/ and writes something small and
site-ready into web/public/. Run modules from the pipeline/ directory:

    uv run python -m ap_pipeline.textures.build_earth_textures_from_nasa
    uv run python -m ap_pipeline.sky.build_star_catalog_from_hyg

or via the root package.json scripts (npm run textures / stars / orbits).
"""

import sys

# Windows consoles default to a legacy code page; our log lines use arrows and degree signs.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")
