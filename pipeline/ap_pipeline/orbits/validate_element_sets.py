"""
Validate OMM element sets before they are allowed anywhere near the site.

Three layers of checks, each cheap and each catching something the previous one cannot:

  1. Shape and range — every field the propagator needs is present and numeric, and the
     orbital elements are physically possible (0 ≤ e < 1, 0° ≤ i ≤ 180°, n > 0, …).
  2. Initialisation — the reference SGP4 implementation (the `sgp4` package, the same
     algorithm the browser will run) accepts the set without error.
  3. Propagation — the set propagates cleanly at its epoch, right now, and a day from now.
     SGP4's own error codes catch decayed objects (code 6), sub-orbital sets (5) and the
     numerical pathologies (1–4) that a range check cannot see.

Duplicates across groups are resolved by keeping the newest epoch. Sets whose epoch is more
than STALE_DAYS old are kept but flagged, so the site can show a warning; sets older than
DROP_DAYS are dropped — the propagator would place them kilometres wrong anyway.
"""

from __future__ import annotations

import logging
import math
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import numpy as np
from sgp4 import omm
from sgp4.api import Satrec, SatrecArray, jday

log = logging.getLogger("validate")

REQUIRED = (
    "OBJECT_NAME", "OBJECT_ID", "EPOCH", "MEAN_MOTION", "ECCENTRICITY", "INCLINATION",
    "RA_OF_ASC_NODE", "ARG_OF_PERICENTER", "MEAN_ANOMALY", "NORAD_CAT_ID", "BSTAR",
    "MEAN_MOTION_DOT", "MEAN_MOTION_DDOT",
)
STALE_DAYS = 14
DROP_DAYS = 60

MU_KM3_S2 = 398600.4418
R_EARTH_KM = 6378.137
GEO_PERIOD_MIN = 1436.07

SGP4_ERRORS = {
    1: "mean eccentricity out of range or mean motion too small",
    2: "mean motion less than zero",
    3: "perturbed eccentricity out of range",
    4: "semi-latus rectum less than zero",
    5: "epoch elements are sub-orbital",
    6: "satellite has decayed",
}


@dataclass
class ValidationReport:
    input_records: int = 0
    duplicates_removed: int = 0
    accepted: int = 0
    rejected: Counter = field(default_factory=Counter)   # reason → count
    flagged: Counter = field(default_factory=Counter)    # flag → count
    epoch_age_days: list[float] = field(default_factory=list)

    def summary(self) -> dict:
        ages = np.asarray(self.epoch_age_days) if self.epoch_age_days else np.asarray([0.0])
        return {
            "input_records": self.input_records,
            "duplicates_removed": self.duplicates_removed,
            "accepted": self.accepted,
            "rejected": dict(self.rejected),
            "rejected_total": sum(self.rejected.values()),
            "flagged": dict(self.flagged),
            "epoch_age_days": {
                "median": round(float(np.median(ages)), 2),
                "p95": round(float(np.percentile(ages, 95)), 2),
                "max": round(float(ages.max()), 2),
            },
        }


def parse_epoch(s: str) -> datetime:
    """CelesTrak writes 'YYYY-MM-DDTHH:MM:SS.ffffff'; tolerate a missing fraction."""
    if "." not in s:
        s = s + ".000000"
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%S.%f").replace(tzinfo=timezone.utc)


def derived_orbit(rec: dict) -> dict:
    """Period, semi-major axis, apogee/perigee altitude and a coarse regime, from the elements."""
    n_rev_day = float(rec["MEAN_MOTION"])
    e = float(rec["ECCENTRICITY"])
    i = float(rec["INCLINATION"])
    n_rad_s = n_rev_day * 2.0 * math.pi / 86400.0
    a = (MU_KM3_S2 / (n_rad_s * n_rad_s)) ** (1.0 / 3.0)
    apogee = a * (1.0 + e) - R_EARTH_KM
    perigee = a * (1.0 - e) - R_EARTH_KM
    period = 1440.0 / n_rev_day

    if e >= 0.25:
        regime = "HEO"
    elif apogee < 2000.0:
        regime = "LEO"
    elif abs(period - GEO_PERIOD_MIN) < 15.0 and i < 25.0:
        regime = "GEO"
    elif apogee < 34000.0:
        regime = "MEO"
    else:
        regime = "HIGH"

    return {
        "PERIOD_MIN": round(period, 3),
        "SEMI_MAJOR_AXIS_KM": round(a, 3),
        "APOGEE_KM": round(apogee, 1),
        "PERIGEE_KM": round(perigee, 1),
        "REGIME": regime,
    }


def _shape_ok(rec: dict) -> str | None:
    for k in REQUIRED:
        if k not in rec or rec[k] is None or rec[k] == "":
            return f"missing {k}"
    try:
        e = float(rec["ECCENTRICITY"])
        i = float(rec["INCLINATION"])
        n = float(rec["MEAN_MOTION"])
        for k in ("RA_OF_ASC_NODE", "ARG_OF_PERICENTER", "MEAN_ANOMALY"):
            float(rec[k])
        float(rec["BSTAR"]); float(rec["MEAN_MOTION_DOT"]); float(rec["MEAN_MOTION_DDOT"])
        int(rec["NORAD_CAT_ID"])
    except (TypeError, ValueError):
        return "non-numeric field"
    if not (0.0 <= e < 1.0):
        return "eccentricity out of range"
    if not (0.0 <= i <= 180.0):
        return "inclination out of range"
    if not (0.0 < n <= 20.0):
        return "mean motion out of range"
    return None


def validate(records: list[dict], now: datetime, groups_by_norad: dict[int, set[str]] | None = None) -> tuple[list[dict], ValidationReport]:
    """Return (accepted records with derived fields and flags, report)."""
    report = ValidationReport(input_records=len(records))

    # --- 1. shape/range + epoch, and dedupe by NORAD keeping the newest epoch
    best: dict[int, tuple[datetime, dict]] = {}
    for rec in records:
        if why := _shape_ok(rec):
            report.rejected[why] += 1
            continue
        try:
            epoch = parse_epoch(str(rec["EPOCH"]))
        except ValueError:
            report.rejected["unparseable epoch"] += 1
            continue
        norad = int(rec["NORAD_CAT_ID"])
        cur = best.get(norad)
        if cur is None or epoch > cur[0]:
            if cur is not None:
                report.duplicates_removed += 1
            best[norad] = (epoch, rec)
        else:
            report.duplicates_removed += 1

    # --- 2. initialise every set in the reference propagator
    sats: list[Satrec] = []
    kept: list[tuple[int, datetime, dict]] = []
    for norad, (epoch, rec) in best.items():
        age_days = (now - epoch).total_seconds() / 86400.0
        if age_days > DROP_DAYS:
            report.rejected[f"epoch older than {DROP_DAYS} days"] += 1
            continue
        sat = Satrec()
        try:
            fields = dict(rec)
            if "." not in str(fields["EPOCH"]):
                fields["EPOCH"] = str(fields["EPOCH"]) + ".000000"
            omm.initialize(sat, fields)
        except Exception as e:  # noqa: BLE001 — anything the propagator refuses is a rejection
            report.rejected[f"sgp4init failed: {type(e).__name__}"] += 1
            continue
        sats.append(sat)
        kept.append((norad, epoch, rec))

    if not sats:
        return [], report

    # --- 3. propagate at epoch, now, now + 1 day (vectorised, all objects at once)
    arr = SatrecArray(sats)
    t_now = now
    t_later = now + timedelta(days=1)
    jd_now, fr_now = jday(t_now.year, t_now.month, t_now.day, t_now.hour, t_now.minute, t_now.second + t_now.microsecond / 1e6)
    jd_lat, fr_lat = jday(t_later.year, t_later.month, t_later.day, t_later.hour, t_later.minute, t_later.second)
    # each set's own epoch, as (jd, fr) pairs
    e_epoch = np.empty(len(sats), dtype=np.int64)
    for k, sat in enumerate(sats):
        e_k, _, _ = sat.sgp4(sat.jdsatepoch, sat.jdsatepochF)
        e_epoch[k] = e_k
    e_arr, _, _ = arr.sgp4(np.array([jd_now, jd_lat]), np.array([fr_now, fr_lat]))

    accepted: list[dict] = []
    for k, (norad, epoch, rec) in enumerate(kept):
        code_epoch = int(e_epoch[k])
        code_now = int(e_arr[k, 0])
        code_later = int(e_arr[k, 1])
        if code_epoch != 0:
            report.rejected[f"sgp4 at epoch: {SGP4_ERRORS.get(code_epoch, code_epoch)}"] += 1
            continue
        if code_now == 6 or code_later == 6:
            report.rejected["sgp4: satellite has decayed"] += 1
            continue
        if code_now != 0 or code_later != 0:
            code = code_now or code_later
            report.rejected[f"sgp4 now/+1d: {SGP4_ERRORS.get(code, code)}"] += 1
            continue

        age_days = (now - epoch).total_seconds() / 86400.0
        flags: list[str] = []
        if age_days > STALE_DAYS:
            flags.append("stale")
        if float(rec["ECCENTRICITY"]) == 0.0 and float(rec["INCLINATION"]) == 0.0:
            flags.append("placeholder-orbit")
        for f in flags:
            report.flagged[f] += 1

        out = dict(rec)
        out.update(derived_orbit(rec))
        out["EPOCH_AGE_DAYS"] = round(age_days, 3)
        out["FLAGS"] = flags
        out["GROUPS"] = sorted(groups_by_norad.get(norad, set())) if groups_by_norad else []
        accepted.append(out)
        report.epoch_age_days.append(age_days)

    report.accepted = len(accepted)
    log.info("validation: %d in → %d accepted, %d rejected, %d duplicates removed",
             report.input_records, report.accepted, sum(report.rejected.values()), report.duplicates_removed)
    return accepted, report
