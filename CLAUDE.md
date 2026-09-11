# Atmospheric Perspective — project brief for Claude

This file is my standing brief. It is loaded into context every session in this folder.
Read it before doing anything. If something here conflicts with what Jack says in chat,
Jack wins — then update this file so it stays true.

Last updated: 2026-09-11 (Stage 1 complete: framework, globe, night sky, first UI).

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

Until we move to the cloud, "R2" is a local `data/` output folder and the dev server reads it.

## 6. Planned repo layout

```
atmospheric-perspective/            (folder is literally "Satellite Platform" on disk)
  CLAUDE.md · README.md · package.json (root scripts delegate to web/) · .gitignore
  .claude/launch.json               dev-server launch config (node.exe, absolute paths)
  web/                              Svelte 5 + Vite 8 + TS 5.9 + Three r186
    public/textures/                earth-day-blue-marble-5400.jpg, earth-night-black-marble-3600.jpg
    public/data/stars.json          built by the pipeline (9,096 stars, 287 KB)
    src/lib/astro/                  time.ts (JD, GMST), sun.ts, frames.ts (WGS84, ECI↔scene)
    src/lib/globe/                  Globe.ts (loop, scene graph), earth.ts, atmosphere.ts,
                                    stars.ts, graticule.ts — Three only, no Svelte
    src/lib/state/                  clock / settings / status (.svelte.ts, runes classes)
    src/ui/                         GlobeCanvas (the one Svelte↔Three bridge), TopBar,
                                    TimeControls, LayersPanel, StatusBar
  pipeline/scripts/build_stars.py   BSC5 → stars.json (stdlib only)
  docs/briefs/NN-<slug>.html        stage briefs
  docs/journal/                     the build journal (single HTML, grows)
  docs/plan/                        copy of the game plan
  data/raw/                         downloaded originals (git-ignored)
  .github/workflows/                added when we move the pipeline to Actions
```
Dependency direction is strict: `ui → state → globe → astro`. Satellites go under the
`world` group (ECI), never under `earthGroup`.

## 7. Environment

- Windows 11 Home, PowerShell primary; Git Bash available.
- Python **3.14.3** via the `py` launcher (`python` alias is the Store stub — use `py` or `uv run`).
- **Node.js 24.19.0 / npm 11.17** installed 2026-09-11 via winget at `C:\Program Files\nodejs`.
  It is **not on the PATH of shells the Claude app spawns** — prefix commands with
  `$env:Path += ";C:\Program Files\nodejs"` (PowerShell) or
  `export PATH="$PATH:/c/Program Files/nodejs"` (Bash). `.claude/launch.json` therefore
  calls `node.exe` with absolute paths rather than `npm`.
- `uv` not installed yet (pipeline is stdlib-only so far). GPU: NVIDIA RTX 5070.
- Working directory: `C:\Users\Jack\Downloads\reboot\Personal\Satellite Platform`
- Git repo initialised on `main` (2026-09-11). Commit only when Jack says so.
- **The Claude Browser pane pauses `requestAnimationFrame` when not displayed**, so fps read
  there is meaningless (1–4). Use screenshots to check rendering; ask Jack for real fps.
  Dev-only handle: `window.__globe` exposes the Globe instance for console inspection.
- Dev server: `preview_start` with name `web` → http://localhost:5173.

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
| 1 | Framework: local site, globe, night sky, first UI | 2026-09-11 | `docs/briefs/01-framework.html` · https://claude.ai/code/artifact/341aff22-9767-47b6-ba8f-4c25eda26706 | pending Jack's yes |

Journal artifact URL: *(not yet created)*

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
