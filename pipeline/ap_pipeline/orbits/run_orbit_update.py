"""
The scheduled orbit update — the one entry point the scheduler runs every hour.

  1. Fetch, under CelesTrak's rules: each configured GP group at most once per two-hour
     window, SATCAT only when its directory listing says it changed.
  2. If anything new arrived (or no snapshot exists yet), validate everything and rebuild
     the snapshot in data/orbits/latest/.
  3. Archive: one gzipped copy of each dataset per UTC day in data/archive/ — overwritten
     within the day, so the archive holds each day's last state, forever.
  4. Prune raw responses older than RAW_KEEP_DAYS.
  5. Write data/orbits/last-run.json and append to data/logs/orbits.log.

Usage (from pipeline/):
  uv run python -m ap_pipeline.orbits.run_orbit_update            # the scheduled behaviour
  uv run python -m ap_pipeline.orbits.run_orbit_update --status   # print the fetch state
  uv run python -m ap_pipeline.orbits.run_orbit_update --rebuild  # rebuild the snapshot from
                                                                    # the newest raw files, no fetch
  --force ignores the pacing gates. It exists for debugging and WILL earn 403s if misused.
"""

from __future__ import annotations

import argparse
import gzip
import json
import logging
import shutil
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ap_pipeline.orbits.build_orbit_snapshot import build_snapshot
from ap_pipeline.orbits.celestrak_client import CelestrakClient, ClientState, FetchResult, ObsoleteEndpoint, iso, utcnow
from ap_pipeline.paths import ARCHIVE, LOGS, ORBITS_LAST_RUN, ORBITS_LATEST, RAW_CELESTRAK, RAW_KEEP_DAYS, ROOT, ensure_dirs, rel

log = logging.getLogger("orbits")

# CelesTrak groups we track. 'active' is the primary dataset; the rest add objects or tags.
GP_GROUPS = [
    "active",              # every active satellite (~16k)
    "stations",            # crewed stations and their visitors
    "last-30-days",        # recent launches, incl. objects not yet flagged active
    "fengyun-1c-debris",   # the three great fragmentation clouds CelesTrak publishes
    "iridium-33-debris",
    "cosmos-2251-debris",
]


def setup_logging() -> None:
    LOGS.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(name)-10s %(message)s", "%Y-%m-%dT%H:%M:%SZ")
    fmt.converter = time.gmtime
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()
    fh = logging.FileHandler(LOGS / "orbits.log", encoding="utf-8")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    root.addHandler(fh)
    root.addHandler(sh)


def archive_daily(src: Path, kind: str, name: str, day: datetime) -> Path:
    """data/archive/<kind>/YYYY/MM/DD/<name>.gz — the last copy written on that day wins."""
    dest_dir = ARCHIVE / kind / day.strftime("%Y") / day.strftime("%m") / day.strftime("%d")
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{name}{src.suffix}.gz"
    with src.open("rb") as fin, gzip.open(dest, "wb", compresslevel=6) as fout:
        shutil.copyfileobj(fin, fout)
    return dest


def prune_raw(now: datetime, keep: set[Path]) -> int:
    cutoff = now - timedelta(days=RAW_KEEP_DAYS)
    removed = 0
    for p in RAW_CELESTRAK.rglob("*"):
        if p.is_file() and p not in keep and datetime.fromtimestamp(p.stat().st_mtime, timezone.utc) < cutoff:
            p.unlink()
            removed += 1
    return removed


def current_files(state: ClientState) -> tuple[dict[str, Path], Path | None]:
    gp: dict[str, Path] = {}
    for group in GP_GROUPS:
        ds = state.datasets.get(f"gp:{group}")
        if ds and ds.last_path and Path(ds.last_path).exists():
            gp[group] = Path(ds.last_path)
    sc = state.datasets.get("satcat")
    satcat = Path(sc.last_path) if sc and sc.last_path and Path(sc.last_path).exists() else None
    return gp, satcat


def print_status(state: ClientState) -> None:
    print(f"blocked_until       : {iso(state.blocked_until)}")
    print(f"satcat dir checked  : {iso(state.satcat_dir_checked)}  (mtime {state.satcat_dir_mtime})")
    for key, ds in sorted(state.datasets.items()):
        print(f"{key:24s} last_success={iso(ds.last_success)}  status={ds.last_status}  "
              f"next_allowed={iso(ds.next_allowed)}  403s={ds.consecutive_403}  file={ds.last_path and Path(ds.last_path).name}")
    manifest = ORBITS_LATEST / "manifest.json"
    if manifest.exists():
        m = json.loads(manifest.read_text(encoding="utf-8"))
        print(f"snapshot            : {m['version']}  objects={m['counts']['objects']}  gp={m['gp_file']} ({m['gp_bytes']/1_048_576:.2f} MB)")
    else:
        print("snapshot            : none yet")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Scheduled CelesTrak fetch, validation, snapshot and archive.")
    ap.add_argument("--status", action="store_true", help="print the fetch state and exit")
    ap.add_argument("--rebuild", action="store_true", help="rebuild the snapshot from the newest raw files without fetching")
    ap.add_argument("--force", action="store_true", help="ignore pacing gates (debug only; risks 403s)")
    args = ap.parse_args(argv)

    ensure_dirs()
    setup_logging()
    now = utcnow()
    state = ClientState.load()

    if args.status:
        print_status(state)
        return 0

    started = time.perf_counter()
    results: list[FetchResult] = []
    changed = False
    halted: str | None = None

    if not args.rebuild:
        client = CelestrakClient(state, now=now, force=args.force)
        try:
            for group in GP_GROUPS:
                res = client.fetch_gp(group)
                results.append(res)
                log.info("%-24s %s", res.key, res.reason)
                changed |= res.changed
                if res.status is not None and res.status >= 500:
                    halted = res.reason
                    break
            if not halted:
                res = client.fetch_satcat()
                results.append(res)
                log.info("%-24s %s", res.key, res.reason)
                changed |= res.changed
        except ObsoleteEndpoint as e:
            log.error("OBSOLETE ENDPOINT — %s", e)
            halted = str(e)
        finally:
            client.close()
            state.save()

    gp_files, satcat_path = current_files(state)
    manifest_exists = (ORBITS_LATEST / "manifest.json").exists()
    snapshot_info: dict | None = None

    if gp_files and (changed or args.rebuild or not manifest_exists):
        sources = {
            "celestrak_gp": {g: {"file": rel(p), "fetched_at": iso(state.datasets[f"gp:{g}"].last_success)} for g, p in gp_files.items()},
            "celestrak_satcat": {"file": rel(satcat_path), "fetched_at": iso(state.datasets["satcat"].last_success),
                                 "upstream_mtime": state.datasets["satcat"].remote_mtime} if satcat_path else None,
        }
        gp_path, manifest, report = build_snapshot(gp_files, satcat_path, now, sources)
        snapshot_info = {"version": manifest["version"], "objects": manifest["counts"]["objects"],
                         "gp_file": manifest["gp_file"], "bytes": manifest["gp_bytes"], "validation": report.summary()}
    elif not gp_files:
        log.warning("no raw GP files yet — nothing to build")
    else:
        log.info("nothing new — snapshot %s kept", json.loads((ORBITS_LATEST / "manifest.json").read_text())["version"])

    # Archive today's last state of every dataset we have.
    archived: list[str] = []
    for group, p in gp_files.items():
        archived.append(rel(archive_daily(p, "gp", group, now)))
    if satcat_path:
        archived.append(rel(archive_daily(satcat_path, "satcat", "satcat", now)))

    keep = set(gp_files.values()) | ({satcat_path} if satcat_path else set())
    pruned = prune_raw(now, keep)

    summary = {
        "ran_at": iso(now),
        "duration_s": round(time.perf_counter() - started, 1),
        "halted": halted,
        "fetches": [{"key": r.key, "attempted": r.attempted, "status": r.status, "changed": r.changed, "reason": r.reason} for r in results],
        "snapshot": snapshot_info,
        "archived": archived,
        "raw_pruned": pruned,
    }
    ORBITS_LAST_RUN.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    log.info("run complete in %.1f s — %s", summary["duration_s"],
             "HALTED: " + halted if halted else ("new snapshot " + snapshot_info["version"] if snapshot_info else "no changes"))
    return 2 if halted else 0


if __name__ == "__main__":
    raise SystemExit(main())
