"""
A well-behaved CelesTrak client.

CelesTrak's usage policy (revised 26 March 2026) is the constraint everything here serves:

  * GP element sets update once every two hours. Each dataset may be downloaded once per
    update; a second request in the same window is answered with HTTP 403.
  * gp.php sends no Last-Modified or ETag, so there is nothing to make a request conditional
    on. Pacing is therefore purely temporal: never ask for a dataset less than two hours
    after the last successful download, and never more than once an hour at all.
  * A 403 is not an error to retry — it means "you already have the current version" (we
    asked before their update landed). We wait for the next hourly run and try once more.
    After the first success the cadence locks to theirs and 403s stop.
  * SATCAT has a directory listing (satcat/jsonDir.php) that may be polled hourly; the file
    itself is downloaded only when its listed modification time changes.
  * 5xx means the server is struggling: stop the run entirely and back off for hours.
  * 301/404 mean our URLs are obsolete: fail loudly so a human looks.

Everything the client learns is kept in data/orbits/state.json so that runs are stateless
processes and the discipline survives restarts. Every successful response body is written
untouched under data/raw/celestrak/ before anyone parses it.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from ap_pipeline.paths import ORBITS_STATE, RAW_CELESTRAK, rel

log = logging.getLogger("celestrak")

BASE_URL = "https://celestrak.org"
GP_URL = f"{BASE_URL}/NORAD/elements/gp.php"
SATCAT_DIR_URL = f"{BASE_URL}/satcat/jsonDir.php"
SATCAT_URL = f"{BASE_URL}/pub/satcat.csv"

USER_AGENT = "AtmosphericPerspective-pipeline/0.3 (personal project; contact: barnettjack29@gmail.com)"

GP_UPDATE_INTERVAL = timedelta(hours=2)
# Re-fetch gate. The scheduler runs hourly; a gate of exactly two hours would let a run that
# lands a few seconds early skip, turning the cadence into three hours. 1 h 50 m means the
# run two hours after a success is always allowed and the run one hour after never is.
GP_REFETCH_AFTER = timedelta(hours=1, minutes=50)
MIN_ATTEMPT_SPACING = timedelta(minutes=58)  # our runs are hourly; never poll faster
SATCAT_DIR_SPACING = timedelta(minutes=58)   # policy: directory queries at most hourly
SERVER_ERROR_BACKOFF = timedelta(hours=6)
FORBIDDEN_BACKOFF = timedelta(minutes=58)    # a 403 means: try again on the next hourly run
TIMEOUT_S = 120.0


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds") if dt else None


def parse_iso(s: str | None) -> datetime | None:
    return datetime.fromisoformat(s) if s else None


@dataclass
class DatasetState:
    last_attempt: datetime | None = None
    last_success: datetime | None = None
    last_status: int | None = None
    last_path: str | None = None          # repo-relative path of the newest raw file
    last_sha256: str | None = None
    next_allowed: datetime | None = None
    consecutive_403: int = 0
    remote_mtime: str | None = None       # SATCAT only: FILE_MTIME from the directory listing
    remote_size: int | None = None

    def to_json(self) -> dict:
        return {
            "last_attempt": iso(self.last_attempt),
            "last_success": iso(self.last_success),
            "last_status": self.last_status,
            "last_path": self.last_path,
            "last_sha256": self.last_sha256,
            "next_allowed": iso(self.next_allowed),
            "consecutive_403": self.consecutive_403,
            "remote_mtime": self.remote_mtime,
            "remote_size": self.remote_size,
        }

    @classmethod
    def from_json(cls, d: dict) -> "DatasetState":
        return cls(
            last_attempt=parse_iso(d.get("last_attempt")),
            last_success=parse_iso(d.get("last_success")),
            last_status=d.get("last_status"),
            last_path=d.get("last_path"),
            last_sha256=d.get("last_sha256"),
            next_allowed=parse_iso(d.get("next_allowed")),
            consecutive_403=d.get("consecutive_403", 0),
            remote_mtime=d.get("remote_mtime"),
            remote_size=d.get("remote_size"),
        )


@dataclass
class ClientState:
    datasets: dict[str, DatasetState] = field(default_factory=dict)
    blocked_until: datetime | None = None
    satcat_dir_checked: datetime | None = None
    satcat_dir_mtime: str | None = None

    @classmethod
    def load(cls, path: Path = ORBITS_STATE) -> "ClientState":
        if not path.exists():
            return cls()
        d = json.loads(path.read_text(encoding="utf-8"))
        return cls(
            datasets={k: DatasetState.from_json(v) for k, v in d.get("datasets", {}).items()},
            blocked_until=parse_iso(d.get("blocked_until")),
            satcat_dir_checked=parse_iso(d.get("satcat_dir_checked")),
            satcat_dir_mtime=d.get("satcat_dir_mtime"),
        )

    def save(self, path: Path = ORBITS_STATE) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "_comment": "Fetch discipline memory for CelesTrak. Delete this file only if you understand the 403 rule.",
            "datasets": {k: v.to_json() for k, v in sorted(self.datasets.items())},
            "blocked_until": iso(self.blocked_until),
            "satcat_dir_checked": iso(self.satcat_dir_checked),
            "satcat_dir_mtime": self.satcat_dir_mtime,
        }
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def dataset(self, key: str) -> DatasetState:
        return self.datasets.setdefault(key, DatasetState())


@dataclass
class FetchResult:
    key: str
    attempted: bool
    status: int | None
    changed: bool           # a new response body was saved
    path: Path | None       # the raw file (new or the previous one if unchanged/skipped)
    reason: str


class ObsoleteEndpoint(RuntimeError):
    """301/404: the URL or query form has changed upstream; a human must look."""


class CelestrakClient:
    def __init__(self, state: ClientState, now: datetime | None = None, force: bool = False):
        self.state = state
        self.now = now or utcnow()
        self.force = force
        self.http = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept": "application/json, text/csv;q=0.9, */*;q=0.5"},
            timeout=TIMEOUT_S,
            follow_redirects=False,
        )

    # ------------------------------------------------------------------ gating

    def _blocked(self) -> str | None:
        if self.state.blocked_until and self.now < self.state.blocked_until and not self.force:
            return f"backing off after a server error until {iso(self.state.blocked_until)}"
        return None

    def _gp_gate(self, ds: DatasetState) -> str | None:
        """Why we must NOT fetch this GP dataset now, or None if we may."""
        if self.force:
            return None
        if ds.next_allowed and self.now < ds.next_allowed:
            return f"next allowed at {iso(ds.next_allowed)}"
        if ds.last_attempt and self.now - ds.last_attempt < MIN_ATTEMPT_SPACING:
            return "attempted less than an hour ago"
        if ds.last_success and self.now - ds.last_success < GP_REFETCH_AFTER:
            return "downloaded less than a window ago"
        return None

    # ------------------------------------------------------------------ GP

    def fetch_gp(self, group: str) -> FetchResult:
        key = f"gp:{group}"
        ds = self.state.dataset(key)
        prev = Path(ds.last_path) if ds.last_path else None

        if (why := self._blocked()) or (why := self._gp_gate(ds)):
            return FetchResult(key, False, None, False, prev, f"skipped — {why}")

        url = f"{GP_URL}?GROUP={group}&FORMAT=json"
        return self._download(key, ds, url, RAW_CELESTRAK / "gp" / group, ".json", kind="gp")

    # ------------------------------------------------------------------ SATCAT

    def fetch_satcat(self) -> FetchResult:
        key = "satcat"
        ds = self.state.dataset(key)
        prev = Path(ds.last_path) if ds.last_path else None

        if why := self._blocked():
            return FetchResult(key, False, None, False, prev, f"skipped — {why}")

        # 1. The directory listing, at most hourly.
        st = self.state
        if not self.force and st.satcat_dir_checked and self.now - st.satcat_dir_checked < SATCAT_DIR_SPACING:
            return FetchResult(key, False, None, False, prev, "skipped — directory checked less than an hour ago")

        try:
            r = self.http.get(SATCAT_DIR_URL)
        except httpx.HTTPError as e:
            return FetchResult(key, True, None, False, prev, f"directory query failed: {e}")
        st.satcat_dir_checked = self.now
        if r.status_code >= 500:
            st.blocked_until = self.now + SERVER_ERROR_BACKOFF
            return FetchResult(key, True, r.status_code, False, prev, "directory query: server error, backing off")
        if r.status_code != 200:
            return FetchResult(key, True, r.status_code, False, prev, f"directory query: HTTP {r.status_code}")

        listing = r.json()
        entry = next((e for e in listing if e.get("FILE_NAME") == "satcat.csv"), None)
        if not entry:
            return FetchResult(key, True, 200, False, prev, "directory listing has no satcat.csv")
        mtime = entry.get("FILE_MTIME")
        log.info("satcat directory: mtime=%s size=%s", mtime, entry.get("FILE_SIZE"))

        # 2. Download only if the file changed since our last copy.
        if not self.force and ds.remote_mtime == mtime and prev and prev.exists():
            return FetchResult(key, True, 200, False, prev, f"unchanged upstream (mtime {mtime})")

        res = self._download(key, ds, SATCAT_URL, RAW_CELESTRAK / "satcat", ".csv", kind="satcat")
        if res.status == 200:
            ds.remote_mtime = mtime
            ds.remote_size = entry.get("FILE_SIZE")
            st.satcat_dir_mtime = mtime
        return res

    # ------------------------------------------------------------------ core

    def _download(self, key: str, ds: DatasetState, url: str, out_dir: Path, ext: str, kind: str) -> FetchResult:
        prev = Path(ds.last_path) if ds.last_path else None
        ds.last_attempt = self.now
        log.info("GET %s", url)
        try:
            r = self.http.get(url)
        except httpx.HTTPError as e:
            ds.last_status = None
            return FetchResult(key, True, None, False, prev, f"request failed: {e}")

        ds.last_status = r.status_code
        server_date = r.headers.get("date")

        if r.status_code in (301, 302, 307, 308):
            raise ObsoleteEndpoint(f"{url} redirected to {r.headers.get('location')} — update the client")
        if r.status_code == 404:
            raise ObsoleteEndpoint(f"{url} returned 404 — the query form is obsolete")
        if r.status_code >= 500:
            self.state.blocked_until = self.now + SERVER_ERROR_BACKOFF
            log.warning("%s: HTTP %d — server trouble, backing off %s", key, r.status_code, SERVER_ERROR_BACKOFF)
            return FetchResult(key, True, r.status_code, False, prev, "server error; run halted and backing off")
        if r.status_code in (403, 429):
            ds.consecutive_403 += 1
            ds.next_allowed = self.now + FORBIDDEN_BACKOFF
            log.info("%s: HTTP %d — window already used (their update hasn't landed yet); next try %s",
                     key, r.status_code, iso(ds.next_allowed))
            return FetchResult(key, True, r.status_code, False, prev, "window used; will try on the next hourly run")
        if r.status_code != 200:
            return FetchResult(key, True, r.status_code, False, prev, f"HTTP {r.status_code}")

        body = r.content
        if kind == "gp":
            # Refuse to store something that isn't a JSON array of element sets.
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError as e:
                return FetchResult(key, True, 200, False, prev, f"200 but body is not JSON: {e}")
            if not isinstance(parsed, list) or (parsed and not isinstance(parsed[0], dict)):
                return FetchResult(key, True, 200, False, prev, "200 but body is not a list of records")

        sha = hashlib.sha256(body).hexdigest()
        changed = sha != ds.last_sha256
        stamp = self.now.strftime("%Y%m%dT%H%MZ")
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"{stamp}{ext}"
        path.write_bytes(body)

        ds.last_success = self.now
        ds.last_sha256 = sha
        ds.last_path = str(path)
        ds.consecutive_403 = 0
        ds.next_allowed = self.now + GP_REFETCH_AFTER if kind == "gp" else None
        log.info("%s: 200, %d bytes, %s (server date %s)", key, len(body), "new content" if changed else "identical to last", server_date)
        return FetchResult(key, True, 200, changed, path, "downloaded" + ("" if changed else " (identical to previous)"))

    def close(self) -> None:
        self.http.close()
