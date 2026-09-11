"""
Build the orbit snapshot the site loads: every validated element set, joined to catalogue
metadata, written column-oriented so the browser can hand whole arrays to the propagator
worker and the GPU without reshaping.

Output (data/orbits/latest/):
  gp-<version>.json   {"schema", "version", "count", "columns": {name: description},
                       "data": {name: [value per object]}}
  manifest.json       what the current version is, when it was made, what went into it,
                      and the validation summary. Short cache life; the gp file is immutable.

Element-set values are carried verbatim under their OMM names, so the browser can rebuild the
OMM record for any object and pass it straight to satellite.js. Derived orbit numbers and the
SATCAT columns ride alongside.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from ap_pipeline.orbits.satcat import CARRY, load_satcat
from ap_pipeline.orbits.validate_element_sets import ValidationReport, validate
from ap_pipeline.paths import ORBITS_LATEST, rel

log = logging.getLogger("snapshot")

SCHEMA = 1
KEEP_VERSIONS = 2

OMM_COLUMNS = {
    "NORAD_CAT_ID": "catalogue number (int)",
    "OBJECT_NAME": "name as catalogued",
    "OBJECT_ID": "international designator YYYY-NNNP",
    "EPOCH": "element-set epoch, UTC ISO string, verbatim",
    "MEAN_MOTION": "rev/day",
    "ECCENTRICITY": "",
    "INCLINATION": "deg",
    "RA_OF_ASC_NODE": "deg",
    "ARG_OF_PERICENTER": "deg",
    "MEAN_ANOMALY": "deg",
    "EPHEMERIS_TYPE": "",
    "CLASSIFICATION_TYPE": "U",
    "ELEMENT_SET_NO": "",
    "REV_AT_EPOCH": "",
    "BSTAR": "1/earth-radii",
    "MEAN_MOTION_DOT": "rev/day²",
    "MEAN_MOTION_DDOT": "rev/day³",
}
DERIVED_COLUMNS = {
    "PERIOD_MIN": "orbital period, minutes, from mean motion",
    "SEMI_MAJOR_AXIS_KM": "from mean motion, two-body",
    "APOGEE_KM": "altitude above the equatorial radius",
    "PERIGEE_KM": "altitude above the equatorial radius",
    "REGIME": "LEO | MEO | GEO | HEO | HIGH — coarse, from the elements",
    "EPOCH_AGE_DAYS": "at build time",
    "FLAGS": "list: stale, placeholder-orbit",
    "GROUPS": "CelesTrak groups this object appeared in",
}
SATCAT_COLUMNS = {
    "OBJECT_TYPE": "PAY | R/B | DEB | UNK (SATCAT)",
    "OPS_STATUS_CODE": "operational status code (SATCAT)",
    "OWNER": "owner code (SATCAT)",
    "LAUNCH_DATE": "YYYY-MM-DD (SATCAT)",
    "LAUNCH_SITE": "site code (SATCAT)",
    "DECAY_DATE": "YYYY-MM-DD or blank (SATCAT)",
    "RCS": "SMALL | MEDIUM | LARGE | blank (SATCAT)",
}
COLUMNS = {**OMM_COLUMNS, **DERIVED_COLUMNS, **SATCAT_COLUMNS}


def load_gp_files(files: dict[str, Path]) -> tuple[list[dict], dict[int, set[str]], dict[str, int]]:
    """Read every group's raw JSON; return all records, group membership by NORAD, counts per group."""
    records: list[dict] = []
    groups_by_norad: dict[int, set[str]] = {}
    counts: dict[str, int] = {}
    for group, path in files.items():
        data = json.loads(path.read_text(encoding="utf-8"))
        counts[group] = len(data)
        for rec in data:
            records.append(rec)
            try:
                groups_by_norad.setdefault(int(rec["NORAD_CAT_ID"]), set()).add(group)
            except (KeyError, TypeError, ValueError):
                pass
        log.info("gp: %s — %d records from %s", group, len(data), path.name)
    return records, groups_by_norad, counts


def build_snapshot(
    gp_files: dict[str, Path],
    satcat_path: Path | None,
    now: datetime,
    sources: dict,
    out_dir: Path = ORBITS_LATEST,
) -> tuple[Path, dict, ValidationReport]:
    records, groups_by_norad, group_counts = load_gp_files(gp_files)
    accepted, report = validate(records, now, groups_by_norad)

    satcat = load_satcat(satcat_path) if satcat_path and satcat_path.exists() else {}
    blank = {dst: "" for dst in CARRY.values()}
    matched = 0
    for rec in accepted:
        meta = satcat.get(int(rec["NORAD_CAT_ID"]))
        if meta:
            matched += 1
        rec.update(meta or blank)

    accepted.sort(key=lambda r: int(r["NORAD_CAT_ID"]))

    data = {col: [rec.get(col, "" if col in SATCAT_COLUMNS else None) for rec in accepted] for col in COLUMNS}
    version = now.strftime("%Y%m%dT%H%MZ")

    by_type: dict[str, int] = {}
    by_regime: dict[str, int] = {}
    for rec in accepted:
        by_type[rec.get("OBJECT_TYPE") or "?"] = by_type.get(rec.get("OBJECT_TYPE") or "?", 0) + 1
        by_regime[rec["REGIME"]] = by_regime.get(rec["REGIME"], 0) + 1

    out_dir.mkdir(parents=True, exist_ok=True)
    gp_name = f"gp-{version}.json"
    gp_path = out_dir / gp_name
    payload = {"schema": SCHEMA, "version": version, "generated_at": now.isoformat(timespec="seconds"),
               "count": len(accepted), "columns": COLUMNS, "data": data}
    gp_path.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    manifest = {
        "schema": SCHEMA,
        "version": version,
        "generated_at": now.isoformat(timespec="seconds"),
        "gp_file": gp_name,
        "gp_bytes": gp_path.stat().st_size,
        "counts": {
            "objects": len(accepted),
            "by_object_type": dict(sorted(by_type.items())),
            "by_regime": dict(sorted(by_regime.items())),
            "by_group": group_counts,
            "satcat_matched": matched,
        },
        "validation": report.summary(),
        "sources": sources,
        "credits": {
            "element_sets": "CelesTrak (celestrak.org), GP data derived from 18 SDS / Space-Track",
            "catalogue": "CelesTrak SATCAT",
        },
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    # Keep the newest few versions so a page that already read the manifest can still fetch its file.
    versions = sorted(out_dir.glob("gp-*.json"), key=lambda p: p.name, reverse=True)
    for old in versions[KEEP_VERSIONS:]:
        old.unlink()
        log.info("snapshot: pruned %s", old.name)

    log.info("snapshot: %s — %d objects, %.2f MB, %d matched in SATCAT",
             rel(gp_path), len(accepted), gp_path.stat().st_size / 1_048_576, matched)
    return gp_path, manifest, report
