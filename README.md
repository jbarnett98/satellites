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
| `data/` | Local raw downloads, orbit snapshots, daily archive, logs (git-ignored) |

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

## Orbit data (scheduled)

Element sets come from CelesTrak under its one-download-per-two-hour rule; the pipeline
paces itself and never lets a browser talk to CelesTrak. Output lands in `data/orbits/latest/`
(git-ignored) and the dev server serves it at `/data/orbits/`.

```bash
npm run orbits                  # one run: fetch if allowed, validate (sgp4), snapshot, archive
npm run orbits:status           # fetch state, next-allowed times, current snapshot
npm run orbits:rebuild          # rebuild the snapshot from the newest raw files, no fetch
npm run orbits:schedule         # register the hourly Windows Task Scheduler job (:17 past)
npm run orbits:schedule:status  # is it registered / when did it last run
npm run orbits:unschedule       # remove it
```

Requires Node.js ≥ 24, Python ≥ 3.12 (`py` launcher on Windows) and `uv`.

## Data credits

- Earth imagery: NASA Blue Marble Next Generation (Dec 2004, topography + bathymetry), Black Marble 2016, Blue Marble cloud composite — public domain.
- Plotted stars: HYG Database v4.4 (David Nash, astronexus.com) — CC BY-SA 4.0.
- Milky Way glow: summed light of the Tycho-2 catalogue (Høg et al. 2000, CDS I/259).
- Orbital element sets and satellite catalogue: CelesTrak (celestrak.org), GP data derived from 18 SDS / Space-Track.
- Earth figure: WGS84.
