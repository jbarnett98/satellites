# Atmospheric Perspective

A real-time, browser-rendered globe of everything in Earth orbit, with the data platform
behind it. Static-first: the browser does the orbital mechanics; a small pipeline refreshes
the data; hosting costs ~nothing.

Today: 19,247 tracked objects (every active satellite plus three debris clouds), propagated
with SGP4 in a Web Worker and drawn as GPU points that the vertex shader carries between
ticks. Hover names an object; click for its orbit and catalogue record; search by name or
number (`/`); pick out any of 43 constellations, an owner, or an object type; say where you
are (**Above you**) to see what is over your head, a sky chart, and tonight's passes of the
stations and Hubble with naked-eye visibility; links such as `?sat=25544&group=stations` or
`?obs=55.86,-4.25` open the site on that object or that sky.

Project plan and working brief: `CLAUDE.md`. Stage briefs: `docs/briefs/`.

## Layout

| Path | What |
|---|---|
| `web/` | The site — Svelte 5 + Vite + TypeScript + Three.js + satellite.js (worker) |
| `pipeline/` | Python data pipeline (`uv` project; NumPy + Pillow + httpx + sgp4) |
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

Both read originals from `data/raw/` (downloaded once, not in git) and write small
site-ready files into `web/public/`.

```bash
npm run textures   # NASA Blue Marble / Black Marble / clouds → web/public/textures/earth/*.webp
npm run stars      # HYG v4.4 → web/public/data/sky/stars-hyg.{bin,json}
```

## Orbit data (scheduled)

Element sets come from CelesTrak under its one-download-per-two-hour rule; the pipeline
paces itself and never lets a browser talk to CelesTrak. Output lands in `data/orbits/latest/`
(git-ignored) and the dev server serves it at `/data/orbits/`. The page reads
`manifest.json`, then the immutable `gp-<version>.json` it names, and re-checks the manifest
every ten minutes so a new snapshot is swapped in without a reload.

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
- Orbital element sets and satellite catalogue: CelesTrak (celestrak.org), GP data derived from 18 SDS / Space-Track.
- Propagation: SGP4/SDP4 via satellite.js (MIT) in the browser; the `sgp4` package (Brandon Rhodes) in the pipeline.
- Earth figure: WGS84.
