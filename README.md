# Atmospheric Perspective

A real-time, browser-rendered globe of everything in Earth orbit, with the data platform
behind it. Static-first: the browser does the orbital mechanics; a small pipeline refreshes
the data; hosting costs ~nothing.

Project plan and working brief: `CLAUDE.md`. Stage briefs: `docs/briefs/`.

## Layout

| Path | What |
|---|---|
| `web/` | The site — Svelte 5 + Vite + TypeScript + Three.js |
| `pipeline/` | Python data pipeline (stdlib-only so far) |
| `docs/` | Stage briefs, build journal, plan |
| `data/` | Local raw downloads and snapshots (git-ignored) |

## Run it

```bash
npm --prefix web install
npm run dev          # http://localhost:5173
npm run check        # svelte-check / TypeScript
npm run build        # production bundle in web/dist
npm run stars        # rebuild web/public/data/stars.json from data/raw/bsc5.dat.gz
```

Requires Node.js ≥ 24 and Python ≥ 3.12 (`py` launcher on Windows).

## Data credits

- Earth imagery: NASA Blue Marble Next Generation (Dec 2004, topo + bathy) and Black Marble 2016 — public domain.
- Stars: Yale Bright Star Catalogue, 5th revised edition (Hoffleit & Warren 1991), VizieR V/50.
- Earth figure: WGS84.
