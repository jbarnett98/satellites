# Atmospheric Perspective — project brief for Claude

This file is my standing brief. It is loaded into context every session in this folder.
Read it before doing anything. If something here conflicts with what Jack says in chat,
Jack wins — then update this file so it stays true.

Last updated: 2026-09-12 (Stage 5 complete: search and groups — see §10).

Visual calibration notes (so I don't re-derive them): star size/alpha curves live in
`stars.ts` (`magToSize`, `magToAlpha`). Cloud opacity 0.42 was Jack's "very subtle". Orbit
drag speed factor 0.55 (was 1.3 — "too quick"). **The Milky Way is gone (Jack, 2026-09-12):**
the Tycho-2 star-count glow map looked like blobs at 4096/σ7 and grain at 8192/σ5; he chose
removal over a photographic image. Don't reintroduce it without a fundamentally better
source (Gaia-scale density) and his ask.
Satellites (Stage 4, after Jack's first look): **no white in the satellite palette** — stars
are white and the two must stay tellable apart (payload `#7fdbe8`, R/B `#f4b860`, debris
`#a99ccf`, unknown `#ee8fc6`); point size scales by view depth `(17000/depth)^0.6` clamped
0.6–4× ("too small when I zoom in"); base sizes 3.4/3.4/2.5/3.0 px were "a good size at
15,000 km". Jack's machine, measured: 240 fps with the layer, 4.8 MB in 158 ms, parse
10 ms, worker init 62 ms, 6.9 ms per full-catalogue SGP4 tick.

---

## 1. What we are building

**Atmospheric Perspective** is a browser-based satellite data platform. The centrepiece is a
real-time 3D globe showing every publicly tracked object in Earth orbit, propagated live in
the browser from fresh element sets, with orbit paths, ground tracks, per-object detail, and
a set of data explorers, dashboards, and observer tools built on the same dataset.

Deliverable: a hosted website, eventually live on the public internet, with infrastructure
cost as close to $0/month as possible.

The full pre-build plan (data sources, architecture, feature tiers, roadmap, risks) is the
"Satellite Platform Game Plan" artifact:
https://claude.ai/code/artifact/9a32dbe7-c38d-44f3-819f-ae3ba44c1bd5
Treat it as the reference for *what* and *why*; this file is the reference for *how we work*.

## 2. Who I am working with, and how

Jack (barnettjack29@gmail.com) is building this as a personal project. He built a previous
version that worked but went wrong in specific ways I must not repeat:

- **Hosting cost.** Everything sat on AWS and got expensive fast.
- **Premature complexity.** Docker, Airflow, APIs, and other machinery were added before the
  project needed them. Performance was poor early and fixed later; code structure was fine.
- He is *not* opposed to those tools later — only to adding them before a feature demands it.

**Jack dictates what we build and when.** I propose options and trade-offs; he chooses the
component and the order. I do not start the next component on my own initiative. Within a
component I make routine engineering calls myself and ask only when readings would lead to
materially different work.

Working principles (agreed 2026-09-11):

1. **Static-first.** Before any feature earns a server, ask: can the pipeline pre-compute it,
   or can the browser compute it? Almost always yes.
2. **The browser does the maths.** Propagation, frame transforms, pass prediction, filtering:
   client-side, in a Web Worker where heavy.
3. **Lightweight by default.** Add complexity only when a concrete need appears, and say so
   when I think we have reached that point.
4. **Cite everything.** The data is other people's work; the site credits them visibly.
5. **Archive from day one.** The pipeline keeps daily snapshots; later history features
   depend on how long the archive has run.
6. **Desktop browser only, for now.** Ignore phone/tablet layouts and budgets until Jack says
   otherwise. Do not spend time on mobile.

## 3. Decisions already made (2026-09-11)

| Topic | Decision |
|---|---|
| Name | **Atmospheric Perspective** (repo slug `atmospheric-perspective`) |
| UI framework | **Svelte 5** + Vite + TypeScript |
| Renderer | **Three.js** with custom shader point cloud (not Cesium) |
| Propagation | **satellite.js** (SGP4/SDP4, OMM via `json2satrec`) in a Web Worker |
| Default catalog | **Active satellites (~16k) by default; rocket bodies + debris as a toggle** |
| Pipeline language | **Python 3.14**, managed with `uv` |
| Pipeline host | **Jack's machine for now** (Windows Task Scheduler when scheduled); move to GitHub Actions later when we choose to |
| Repo | **Public** GitHub repo |
| Storage/hosting (planned) | Cloudflare R2 for data, Cloudflare Pages for the site — free tiers |
| Audience | Desktop browsers only, for now |

## 4. Non-negotiable technical facts

- **CelesTrak policy (since 2026-03-26): one download per dataset per update window.** GP and
  SupGP update every 2 hours; a second request in the same window returns HTTP 403. Check
  `jsonDir.php` (at most hourly) to see whether new data exists before downloading. Treat
  403 as "wait for the next window", never retry in a loop. On 50x, stop entirely.
  **Browsers must never call CelesTrak directly.** Only the pipeline talks to upstream sources.
- **Space-Track** requires an account; ≤30 requests/min, ≤300/hour; redistribution of raw
  data needs an Orbital Data Request. Use pipeline-side for history/re-entries; publish only
  derived products unless we file the ODR.
- **GCAT** (J. McDowell) is CC-BY: cite as "data from GCAT (J. McDowell, planet4589.org/space/gcat)".
  SatNOGS is CC-BY-SA. NASA imagery and Natural Earth are public domain.
- **Precision:** element sets carry 7–8 significant decimals. Keep them as text or float64
  through to the propagator; never pass them through `Float32Array`.
- **Catalog numbers will exceed 99,999.** Use OMM JSON internally, not TLE text.
- **Time:** UTC everywhere. SGP4 outputs TEME; TEME → Earth-fixed via GMST. Render the scene
  in the inertial frame and rotate the Earth mesh by sidereal time.
- **JS `Date` truncates CelesTrak's microsecond epochs to milliseconds** (satellite.js
  `json2satrec` goes through `Date`): ≤ 0.5 ms → ≤ 4 m along-track. Fine for the globe; parse
  the fraction ourselves before any precision feature.
- **Constellation shells pile up at their inclination latitude** (dwell at the turning
  point): 5,134 Starlinks at 53°, 3,620 at 43° → visible bands at 3,600×. Real, not a bug;
  parallax (550 km up) shifts them poleward from the viewer.
- Catalog scale (2026-09-10): 35,090 objects on orbit; 20,075 payloads; 15,015 debris/rocket
  bodies; ~16k active; Starlink ~11,100 operational.

## 5. Architecture (target shape)

```
sources ──(1 fetch/update)──► pipeline (Python, hourly) ──► R2 (versioned snapshot + manifest + archive)
                                                                 │  GET (edge-cached)
Cloudflare Pages (static Svelte app) ──► browser ◄───────────────┘
                                          ├─ Web Worker: parse OMM → SGP4 all objects @ ~1 Hz → pos+vel
                                          └─ Main thread: p = p₀ + v·Δt per frame → THREE.Points + UI
```

Until we move to the cloud, "R2" is `data/orbits/latest/`, served at `/data/orbits/` by a Vite
middleware (`web/vite.config.ts`) with production cache semantics: manifest `no-cache`,
`gp-<version>.json` immutable.

**Browser side (implemented Stage 4, verified):** `loadOrbitSnapshot` (manifest → gp file,
streamed) → `SatelliteCatalog` (per-object Uint8 codes, counts, NORAD map, filter mask) →
`PropagationEngine` owns ONE module worker (`propagation.worker.ts`, satellite.js 7 pure JS —
measured 7–10 ms for all 19,247 objects; WASM 5 ms but its glue embeds the binary as a raw
byte-string, so not used; pthreads slower + needs COOP/COEP) → `SatelliteLayer` (Three
`Points`, vertex shader extrapolates `p = p0 + v·dt + ½a·dt²`, a = −μp/|p|³; CPU picking with
the same formula; `OrbitPath` one revolution, phase-fading). Tick cadence: `1000/rate` ms
clamped 33–1000 ms, one in flight, requests aimed at the display-interval midpoint
(`now + rate × (rtt + interval/2)`); jump tolerance `max(1.5 s sim, rate × 60 ms)` (a fixed
1.5 s tolerance re-ticked spuriously at 3,600× — Jack saw 36 Hz). Buffers transfer
worker→main→worker (recycled). Page polls the manifest every 10 min + on tab focus and
hot-swaps the layer (selection kept by NORAD). Worker emits scene-frame (x, z, −y) km. The snapshot is column-oriented JSON: 17 OMM fields verbatim
(EPOCH as CelesTrak's ISO string — feed straight to satellite.js `json2satrec`), 8 derived
(PERIOD_MIN, SEMI_MAJOR_AXIS_KM, APOGEE_KM, PERIGEE_KM, REGIME, EPOCH_AGE_DAYS, FLAGS, GROUPS),
7 SATCAT (OBJECT_TYPE, OPS_STATUS_CODE, OWNER, LAUNCH_DATE, LAUNCH_SITE, DECAY_DATE, RCS).

**Fetch discipline (implemented in `celestrak_client.py`, verified 2026-09-11):** gp.php sends no
Last-Modified/ETag → purely temporal pacing: per dataset, no request < 58 min after the last
attempt, no request < 1 h 50 after the last success (the hourly task then fetches every 2nd
run — a locked 2-hour cadence), 403 → next try in 58 min (not an error), 5xx → all datasets
blocked 6 h, 301/404 → ObsoleteEndpoint (exit 2). SATCAT via `satcat/jsonDir.php` hourly,
download only when FILE_MTIME changes. Groups: active, stations, last-30-days,
fengyun-1c-debris, iridium-33-debris, cosmos-2251-debris. **CelesTrak has no all-objects group**;
rocket bodies + remaining debris (~16k) need Space-Track (Jack's account; ODR before public).
`--force` bypasses gates and WILL cause 403s — never use it against the real endpoint casually.
Windows Task Scheduler job "Atmospheric Perspective - orbit update" registered 2026-09-11,
hourly at :17 local, tested (exit 0).

## 6. Planned repo layout

```
atmospheric-perspective/            (folder is literally "Satellite Platform" on disk)
  CLAUDE.md · README.md · package.json (root scripts delegate to web/ and pipeline/)
  .gitignore · .gitattributes (LF everywhere; images/bin binary)
  .claude/launch.json               dev-server launch config (node.exe, absolute paths)
  web/                              Svelte 5 + Vite 8 + TS 5.9 + Three r186
    public/textures/earth/          day-{2048,4096,8192}, night-{2048,8192}, clouds-{2048,4096} .webp
    public/data/sky/                stars-hyg.bin (Int16×4 per star, 934 KB) + stars-hyg.json (meta, names)
    src/lib/astro/                  time.ts (JD, GMST), sun.ts, frames.ts (WGS84, ECI↔scene, ECI→ECEF→geodetic)
    src/lib/orbits/                 loadOrbitSnapshot.ts, SatelliteCatalog.ts (codes, masks, group index, owner counts),
                                    propagation.worker.ts, PropagationEngine.ts, satcatCodes.ts,
                                    constellations.ts (43 GROUPS rules, assignGroups, summariseObjects),
                                    searchCatalog.ts (ranked scan + aliases) — plain data + worker, no Three/Svelte
    src/lib/globe/                  Globe.ts (loop, scene graph, setSatellites/pickSatellite), earth.ts, clouds.ts,
                                    atmosphere.ts, stars.ts, sun.ts, graticule.ts,
                                    satellites.ts (SatelliteLayer: aEmphasis dimming, worldPosition), orbitPath.ts;
                                    Globe.flyToSatellite — Three only, no Svelte
    src/lib/state/                  clock / settings / status / catalog (.svelte.ts, runes classes)
    src/ui/                         GlobeCanvas (the one Svelte↔Three bridge; loads satellites, pointer
                                    picking, hot-swap poll, masks, URL ?sat=&group=), TopBar (+SearchBox, Groups),
                                    TimeControls, LayersPanel, GroupsPanel, StatusBar, ObjectCard (Locate, group chip),
                                    HoverLabel, SearchBox
  pipeline/                         uv project (pyproject.toml, uv.lock, .venv ignored)
    ap_pipeline/paths.py            ROOT / RAW / WEB_PUBLIC and output folders
    ap_pipeline/textures/build_earth_textures_from_nasa.py
    ap_pipeline/sky/build_star_catalog_from_hyg.py
    ap_pipeline/orbits/             celestrak_client.py (gates + state), validate_element_sets.py (sgp4),
                                    satcat.py, build_orbit_snapshot.py, run_orbit_update.py (hourly entry)
    scheduling/register_windows_task.ps1   register / -Status / -Remove the hourly task
  docs/briefs/NN-<slug>.html        stage briefs
  docs/journal/                     the build journal (single HTML, grows)
  docs/plan/                        copy of the game plan
  data/raw/                         downloaded originals (git-ignored): NASA 21600×10800 Blue Marble,
                                    Black Marble 3km, cloud TIFF, hyg_v44.csv.gz, tycho2/ (20 parts),
                                    celestrak/gp/<group>/<stamp>.json + celestrak/satcat/ (7-day retention)
  data/orbits/                      state.json (fetch memory — never delete casually), last-run.json,
                                    latest/{manifest.json, gp-<version>.json} ← the site loads these
  data/archive/gp|satcat/YYYY/MM/DD/  one .gz per dataset per UTC day, forever (started 2026-09-11)
  data/logs/orbits.log
  .github/workflows/                added when we move the pipeline to Actions
```
Dependency direction is strict: `ui → state → globe → astro`, with `orbits` beside `astro`
at the bottom (globe and state import it; it imports nothing of ours). satellite.js is
imported only in the worker. Satellites live under the `world` group (ECI), never under
`earthGroup`. `vite.config.ts` sets `worker.format = 'es'`.

**Naming rule (Jack, 2026-09-11):** file and module names must say what they do —
`build_star_catalog_from_hyg.py`, not `build_stars.py`. Applies to pipeline modules, data
files (`stars-hyg.bin`, `clouds-4096.webp`) and future workers/routes.

## 7. Environment

- Windows 11 Home, PowerShell primary; Git Bash available.
- Python **3.14.3** via the `py` launcher (`python` alias is the Store stub — use `py` or `uv run`).
- **Node.js 24.19.0 / npm 11.17** installed 2026-09-11 via winget at `C:\Program Files\nodejs`.
  It is **not on the PATH of shells the Claude app spawns** — prefix commands with
  `$env:Path += ";C:\Program Files\nodejs"` (PowerShell) or
  `export PATH="$PATH:/c/Program Files/nodejs"` (Bash). `.claude/launch.json` therefore
  calls `node.exe` with absolute paths rather than `npm`.
- **uv 0.12.13** installed 2026-09-11 via winget at
  `C:\Users\Jack\AppData\Local\Microsoft\WinGet\Packages\astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe\uv.exe`
  (same PATH caveat as Node). Pipeline venv: `pipeline/.venv` (numpy 2.5, pillow 12.3 on Python 3.14).
  Run pipeline modules with `uv run --directory pipeline python -m ap_pipeline.<pkg>.<module>`.
- GPU: NVIDIA RTX 5070; Jack measured **240 fps** for the Stage 1 globe in his own browser.
- `gh` (GitHub CLI) is **not** installed; Jack creates GitHub repos himself. HTTPS push works from this shell (credential manager).
- Git identity is set repo-locally (Jack Barnett / barnettjack29@gmail.com).
- Working directory: `C:\Users\Jack\Downloads\reboot\Personal\Satellite Platform`
- Git repo initialised on `main` (2026-09-11). Remote `origin` = https://github.com/jbarnett98/satellites
  (public; first push 2026-09-12, seven commits). Commit at stage ends; push only when Jack asks.
- **The Claude Browser pane pauses `requestAnimationFrame` when not displayed**, so fps read
  there is meaningless (1–4), and anything that needs the frame loop (worker ticks, "first
  frame" timings) stalls between my tool calls — batch a screenshot with the actions that
  need the loop, and ask Jack for real numbers. Clicks in the pane use the *screenshot*
  coordinate frame (800×450) even when the viewport is emulated larger — scale accordingly.
  Dev-only handles: `window.__globe` (Globe) and `window.__state` ({catalog, settings,
  clock, status}). Don't JSON-dump the engine or layer — they hold megabytes of buffers.
- **Bash heredocs with large Python/TS bodies sometimes fail to parse in this harness**
  ("unexpected EOF while looking for matching quote"); write the script with the Write tool
  and run the file instead.
- Dev server: `preview_start` with name `web` → http://localhost:5173. **The app stops this
  server when its Browser-pane tab closes** (happened 2026-09-11; Jack found localhost down).
  Before telling Jack to look at localhost, verify with `curl -s -o /dev/null -w "%{http_code}"
  http://localhost:5173/` and restart via `preview_start` if needed. Jack can instead run
  `npm run dev` in his own terminal for a server that outlives the pane.

## 8. Recurring deliverables Jack requires from me

At the end of **every stage** — a stage being the completion of a new component or the
rejuvenation of an existing one, not minor fixes — I produce two things:

### (a) Stage brief — always, without being asked
An HTML document Jack reads to know exactly where the project stands.
- File: `docs/briefs/NN-<stage-slug>.html` (NN zero-padded, sequential). Also published as
  an Artifact so he has a link.
- Contents, in this order: **Where the project is** (one screen: status of every component,
  what's live, what's stubbed) → **What we just completed** (what, how, decisions taken,
  measurements) → **Under the hood** (see below) → **Decisions taken** (with the alternative
  not taken) → **Immediate next avenues** (2–4 concrete options with trade-offs, no
  recommendation pushed unless asked) → **Open questions / risks** → **Running it**.
- **Under the hood is mandatory (Jack, 2026-09-11):** he wants to understand how the thing
  is built at every stage, not just what changed — the folder structure (annotated tree,
  every file), the toolchain and what each tool does, the data flow / runtime mechanism
  (a diagram where it helps), and how the pieces talk to each other. **No code listings** —
  explain mechanisms in prose and diagrams, not Python/TS lines.
- Tone: direct, specific numbers, no filler. He should be able to read it in 5–10 minutes.
- Publish as an Artifact with favicon 🌍 (keep the same favicon for all briefs).

### (b) Build journal section — ask first
One continuous document, part diary, part workflow log, part scientific paper, that will
eventually describe the entire build end to end.
- File: `docs/journal/atmospheric-perspective-journal.html` — a **single** file that grows.
  Published as **one** Artifact, redeployed to the same URL each time. Record that URL in
  §10 once it exists.
- **When a stage completes, ask Jack: "Add Part N to the journal?"** Do not write the section
  unless he says yes. Do not offer for minor work.
- **Parts are per *component*, not per stage (Jack, 2026-09-11).** Stages 1 and 2 became one
  part, "The Globe", with the review revisions told inside it. When a later stage rejuvenates
  an existing component, ask whether to *extend* its part or start a new one; default to
  extending. Number figures `Figure N.M`, subsections `N.1 … N.6`, and add a Revision-log row
  every time the document changes.
- The journal's shared CSS is `docs/_shared/docs.css`; briefs and the journal are assembled as
  `<title>` + Google Fonts link + `<style>`(docs.css)`</style>` + body. Journal-specific CSS
  sits in a second `<style>` at the top of the body.
- Each part follows the same skeleton so the document reads as one process:
  `Part N — <Component>` · Context (why now) · What was built · How it works · Decisions and
  alternatives considered · Measurements · What this enables next.
- Consistency is a hard requirement: same naming, same heading structure, same voice
  (first-person plural, past tense for what happened, present tense for how it works), same
  CSS. Re-read the previous part before writing a new one.

### Shared document design system
All three document types (plan, briefs, journal) use one visual family so they read as a set.
- Type: headings **Barlow Semi Condensed** 600/700; body **Source Serif 4**; data and code
  **IBM Plex Mono**. Google Fonts link, with real fallback stacks.
- Palette (light): paper `#F4F6F9`, surface `#FFFFFF`, ink `#1A2230`, muted `#5B6677`,
  line `#D3DAE3`, accent teal `#0B7580` (+ soft `#DFEFF0`), amber for warnings `#B45A10`
  (+ soft `#FBEEDD`), code bg `#EAEFF4`.
- Palette (dark): paper `#0E131A`, surface `#151C26`, ink `#E3E8EF`, muted `#97A3B4`,
  line `#263141`, accent `#4FC6D0` (+ soft `#113039`), amber `#E8984F` (+ soft `#33210F`),
  code bg `#1A2330`.
- Layout: sticky left contents nav (200px) + 760px reading column; tables in `overflow-x:auto`
  wrappers; callouts are a coloured top rule + tinted ground with an uppercase eyebrow label
  (no card chrome); numbered markers only where order carries meaning (phases, journal parts).
- Masthead carries an eyebrow with the document type and date, a balanced headline, and a
  mono "telemetry" strip of the key numbers.
- Theme tokens defined on `:root`, redefined under `prefers-color-scheme: dark` guarded with
  `:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]`.

## 9. Things I must not do

- Fetch CelesTrak (or any upstream) from browser code, or more than once per update window.
- Commit data snapshots to git. They go to `data/` (ignored) and later R2.
- Introduce Docker, Airflow, a database, an API server, or a paid service without naming the
  concrete need and getting Jack's yes.
- Spend effort on mobile layouts or budgets.
- Start a component Jack hasn't asked for, or write a journal part he hasn't approved.
- Skip the stage brief.

## 10. Stage log (maintain this)

| # | Stage | Completed | Brief | Journal part |
|---|---|---|---|---|
| 0 | Game plan (pre-build) | 2026-09-11 | Game Plan artifact (link in §1) | — |
| 1 | Framework: local site, globe, night sky, first UI | 2026-09-11 | `docs/briefs/01-framework.html` · https://claude.ai/code/artifact/341aff22-9767-47b6-ba8f-4c25eda26706 | Part 1 — The Globe |
| 2 | Globe polish: 8k textures, clouds, Sun, HYG stars, Milky Way, controls | 2026-09-11 | `docs/briefs/02-globe-polish.html` · https://claude.ai/code/artifact/5bda8a5d-9661-4d3d-9c9c-2ef8edb6196d | Part 1 — The Globe |
| 3 | Orbit pipeline: CelesTrak fetch discipline, sgp4 validation, snapshot, archive, hourly schedule | 2026-09-11 | `docs/briefs/03-orbit-pipeline.html` · https://claude.ai/code/artifact/41f64269-6dc4-4b45-9839-fe02ce9e2b54 | Part 2 — The Orbit Pipeline |
| 4 | Satellite layer: worker SGP4, GPU points, hover/select/orbit/card, filters, hot-swap | 2026-09-11 | `docs/briefs/04-satellite-layer.html` · https://claude.ai/code/artifact/65925fba-5555-4a1e-a97f-49754d13c95b | Part 3 — The Satellite Layer |
| 5 | Search and groups: search box + aliases, 43 constellations/fleets, owners, type chips, dim/hide, fly-to, ?sat=&group= links | 2026-09-12 | `docs/briefs/05-search-and-groups.html` · https://claude.ai/code/artifact/b81b3441-6fbb-4263-85de-4e26dcc857ac | pending Jack's yes (would be Part 4 — Finding Things) |

Commits: Stage 1 `7a3e84d`, Stage 2 `f16d9b8`, journal `d097609`, Stage 3 `a0ba44a`, Stage 4
`2749616`, Milky Way removal `05b5893`, journal 2+3 `2f96f9a`, Stage 5 (see git log). Jack said
"yes commit" at the end of Stage 1 → **commit at the end of every stage** (one commit per
stage, message "Stage N: <name>"). Since 2026-09-12 (remote added at Jack's request) I also
**push at the end of each stage** — I told him so and he didn't object; stop if he says so.

Open with Jack after Stage 5: journal Part 4 approval; Space-Track — he has an account, needs the
ODR before the public snapshot can carry Space-Track data; credentials go in git-ignored
`pipeline/.env`, never chat. Stage 5 facts: CelesTrak names Hubble `HST` and Tiangong
`CSS (TIANHE)` etc. — the alias table in `searchCatalog.ts` covers that; constellation rules
are payload-only (IRIDIUM/FENGYUN would otherwise catch their debris); the app shell is
`overflow: clip` because a programmatic focus once scrolled it sideways.

Journal: `docs/journal/atmospheric-perspective-journal.html` ·
https://claude.ai/code/artifact/52b246d3-75b9-42f9-88e2-5dfd3fb9de1e (redeploy this same file
path from this conversation, or pass this URL as `url` from another, so the link never changes).
Parts so far: 1 — The Globe (2026-09-11), 2 — The Orbit Pipeline and 3 — The Satellite Layer
(both 2026-09-12; Part 1 carries a postscript on the Milky Way's removal). Figure ids used:
markers a/aa/b/bb (Part 1), c/cc (Part 2), d/dd (Part 3) — pick fresh letters for Part 4.

## 11. Data source quick reference

| Source | Use | Access |
|---|---|---|
| CelesTrak GP / SupGP (`gp.php`, `FORMAT=json`) | orbits | no auth; 1 fetch per 2 h window |
| CelesTrak SATCAT (`satcat.csv`) | metadata | no auth; 1–2×/day |
| CelesTrak SOCRATES Plus (`table-socrates.php`, CSV) | conjunctions | no auth; ~every 10 h |
| Space-Track.org | GP history, TIP, decay | account; 30/min, 300/h |
| GCAT (planet4589.org/space/gcat) | launches/objects since 1957 | CC-BY |
| UCS Satellite Database | purpose/users (paused, current to 2023-05-01) | static file |
| SatNOGS DB | transmitters | API, CC-BY-SA |
| Launch Library 2 | launches | 15 req/h free; `lldev` for dev |
| NOAA SWPC | space weather | JSON, public |
| NASA Blue/Black Marble, Natural Earth | textures | public domain |
