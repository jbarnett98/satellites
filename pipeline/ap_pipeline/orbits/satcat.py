"""
The CelesTrak satellite catalogue (SATCAT): one row per object ever catalogued, with the
metadata element sets lack — object type, owner, launch date and site, radar cross-section
class, operational status, decay date.

Column names follow celestrak.org/satcat/satcat-format.php. The loader is tolerant of
missing columns so an upstream format tweak degrades to blanks rather than a crash.
"""

from __future__ import annotations

import csv
import logging
from pathlib import Path

log = logging.getLogger("satcat")

# What we carry into the snapshot, and the name it gets there.
CARRY = {
    "OBJECT_TYPE": "OBJECT_TYPE",         # PAY, R/B, DEB, UNK
    "OPS_STATUS_CODE": "OPS_STATUS_CODE", # +, P, B, S, X, D, ? … (blank = unknown)
    "OWNER": "OWNER",
    "LAUNCH_DATE": "LAUNCH_DATE",
    "LAUNCH_SITE": "LAUNCH_SITE",
    "DECAY_DATE": "DECAY_DATE",
    "RCS": "RCS",                         # SMALL, MEDIUM, LARGE or blank
}

OBJECT_TYPE_LABEL = {"PAY": "payload", "R/B": "rocket body", "DEB": "debris", "UNK": "unknown"}


def load_satcat(path: Path) -> dict[int, dict]:
    """NORAD catalogue number → carried metadata."""
    out: dict[int, dict] = {}
    with path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        missing = [c for c in ("NORAD_CAT_ID", *CARRY) if c not in (reader.fieldnames or [])]
        if missing:
            log.warning("satcat: columns missing, will be blank: %s", missing)
        for row in reader:
            try:
                norad = int(row["NORAD_CAT_ID"])
            except (KeyError, ValueError):
                continue
            out[norad] = {dst: (row.get(src) or "").strip() for src, dst in CARRY.items()}
    log.info("satcat: %d objects loaded from %s", len(out), path.name)
    return out
