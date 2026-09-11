# Atmospheric Perspective

A real-time, browser-rendered globe of everything in Earth orbit, with the data platform
behind it. Static-first: the browser does the orbital mechanics; a small pipeline refreshes
the data; hosting costs ~nothing.

Project plan and working brief: `CLAUDE.md`. Stage briefs: `docs/briefs/`.

## Layout

| Path | What |
|---|---|
| `web/` | The site — Svelte 5 + Vite + TypeScript + Three.js |
| `pipeline/` | Python data pipeline (`uv` project; NumPy + Pillow) |
| `docs/` | Stage briefs, build journal, plan |
| `data/` | Local raw downloads and snapshots (git-ignored) |

## Run it

```bash
npm --prefix web install      # once
npm run dev                   # http://localhost:5173
npm run check                 # svelte-check / TypeScript
npm run build                 # production bundle in web/dist
```

## Rebuild the data the site ships

All three read originals from `data/raw/` (downloaded once, not in git) and write small
site-ready files into `web/public/`.

```bash
npm run textures   # NASA Blue Marble / Black Marble / clouds → web/public/textures/earth/*.webp
npm run stars      # HYG v4.4 → web/public/data/sky/stars-hyg.{bin,json}
npm run milkyway   # Tycho-2 (2.5M stars) → web/public/textures/sky/milky-way-glow-4096.webp
```

Requires Node.js ≥ 24, Python ≥ 3.12 (`py` launcher on Windows) and `uv`.

## Data credits

- Earth imagery: NASA Blue Marble Next Generation (Dec 2004, topography + bathymetry), Black Marble 2016, Blue Marble cloud composite — public domain.
- Plotted stars: HYG Database v4.4 (David Nash, astronexus.com) — CC BY-SA 4.0.
- Milky Way glow: summed light of the Tycho-2 catalogue (Høg et al. 2000, CDS I/259).
- Earth figure: WGS84.
