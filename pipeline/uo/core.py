"""Core plumbing: config loading, registry validation, fetching with retries, raw archive, issue records.

Nothing here knows about a specific source. See docs/PROVENANCE.md for the model.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "config"
STATE = Path(os.environ.get("UO_STATE_DIR", ROOT / "state"))
PUBLIC = Path(os.environ.get("UO_PUBLIC_DIR", ROOT / "site" / "public"))
DATA_OUT = PUBLIC / "data" / "v1"
R2_OUT = PUBLIC / "r2"  # local mirror of the R2 bucket layout; synced to R2 by the workflow

USER_AGENT = "UnderstandingOutbreaks-pipeline/1.0 (open-source public-report aggregator)"
ORIGIN_TYPES = ("source-reported", "site-derived", "user-supplied", "simulated", "test-data")
CASE_DEFINITIONS = ("confirmed", "probable", "suspected", "notified", "unknown", "mixed", "not_applicable")
PERIOD_TYPES = ("W", "M", "Y")
REQUIRED_SOURCE_FIELDS = (
    "id", "name", "short_name", "publisher", "landing_url", "license", "license_url",
    "citation", "cadence", "redistribute_raw", "kind",
)
CADENCE_DAYS = {"daily": 1, "weekly": 7, "monthly": 31, "yearly": 366}


class PipelineError(Exception):
    """A failure that must keep the last good snapshot live and open a GitHub issue."""


class SchemaChange(PipelineError):
    """Source schema differs from what the connector expects. Always a hard failure."""

    def __init__(self, msg: str, expected: list[str] | None = None, found: list[str] | None = None):
        super().__init__(msg)
        self.expected, self.found = expected or [], found or []

    def diff(self) -> str:
        exp, got = set(self.expected), set(self.found)
        lines = [f"- {c}" for c in sorted(exp - got)] + [f"+ {c}" for c in sorted(got - exp)]
        return "\n".join(lines) or "(column order or types changed)"


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def iso(ts: dt.datetime) -> str:
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def load_yaml(path: Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_site() -> dict:
    return json.loads((CONFIG / "site.json").read_text(encoding="utf-8"))


def load_registry(path: Path | None = None) -> dict[str, dict]:
    """Load and validate the source registry. Raises on any malformed entry."""
    doc = load_yaml(path or CONFIG / "sources.yaml")
    out: dict[str, dict] = {}
    for s in doc["sources"]:
        missing = [k for k in REQUIRED_SOURCE_FIELDS if k not in s or s[k] in (None, "")]
        if missing:
            raise PipelineError(f"source registry entry {s.get('id')!r} missing {missing}")
        if not re.fullmatch(r"[a-z][a-z0-9_]*", s["id"]):
            raise PipelineError(f"bad source id {s['id']!r}")
        if s["id"] in out:
            raise PipelineError(f"duplicate source id {s['id']!r}")
        if s["cadence"] not in CADENCE_DAYS:
            raise PipelineError(f"bad cadence for {s['id']}")
        if not (s["landing_url"].startswith("https://") or s["landing_url"].startswith("/")):
            raise PipelineError(f"landing_url for {s['id']} must be https or site-relative")
        out[s["id"]] = s
    return out


def load_diseases() -> dict:
    return load_yaml(CONFIG / "diseases.yaml")


def load_datasets() -> list[dict]:
    reg = load_registry()
    ds = load_yaml(CONFIG / "datasets.yaml")["datasets"]
    for d in ds:
        if d["source_id"] not in reg:
            raise PipelineError(f"dataset {d['id']} references unknown source {d['source_id']}")
    return ds


# ----------------------------------------------------------------------------- fetching

@dataclass
class Fetch:
    """One archived raw file or API response."""
    fetch_id: str
    dataset_id: str
    source_id: str
    url: str
    retrieved_at: str
    raw_file_hash: str
    bytes: int
    raw_path: str            # local path in the private working cache
    archive_public: bool     # may the raw file be redistributed in the public archive?
    archive_key: str | None  # key in the public raw archive (R2) when archive_public
    http_last_modified: str | None = None
    link_kind: str = "deep"  # "deep" or "dataset-level link"
    content: bytes | None = field(default=None, repr=False, compare=False)

    def public(self) -> dict:
        d = asdict(self)
        d.pop("content", None)
        d.pop("raw_path", None)
        return d


def http_get(url: str, *, retries: int = 4, timeout: int = 120, headers: dict | None = None) -> tuple[bytes, dict]:
    """GET with exponential backoff on network errors and 5xx/429. Other HTTP errors raise at once."""
    import requests

    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = requests.get(url, headers={"User-Agent": USER_AGENT, **(headers or {})}, timeout=timeout)
            if r.status_code in (429, 500, 502, 503, 504):
                raise PipelineError(f"HTTP {r.status_code} from {url}")
            if r.status_code != 200:
                raise SchemaChange(f"HTTP {r.status_code} from {url} (endpoint moved or access changed)")
            return r.content, dict(r.headers)
        except SchemaChange:
            raise
        except Exception as e:  # network errors, timeouts, retryable statuses
            last = e
            if attempt < retries - 1:
                time.sleep(float(os.environ.get("UO_BACKOFF", "2")) * (2 ** attempt))
    raise PipelineError(f"fetch failed after {retries} attempts: {url}: {last}")


def archive_raw(dataset: dict, registry: dict, url: str, content: bytes, headers: dict | None = None,
                part: str = "", link_kind: str = "deep", now: dt.datetime | None = None) -> Fetch:
    """Store a fetched raw file by content hash and return its Fetch record.

    The private cache always keeps the bytes (the pipeline needs them). The public archive receives the
    bytes only when the source registry says redistribution is permitted.
    """
    now = now or utcnow()
    h = sha256_bytes(content)
    src = registry[dataset["source_id"]]
    ext = dataset.get("raw_ext", "bin")
    priv = STATE / "raw" / dataset["id"] / f"{h}.{ext}"
    priv.parent.mkdir(parents=True, exist_ok=True)
    if not priv.exists():
        priv.write_bytes(content)
    public_ok = bool(src["redistribute_raw"])
    key = None
    if public_ok:
        key = f"raw/{dataset['id']}/{h}.{ext}"
        pub = R2_OUT / key
        pub.parent.mkdir(parents=True, exist_ok=True)
        if not pub.exists():
            pub.write_bytes(content)
    fid = f"{dataset['id']}{('-' + part) if part else ''}@{h[:12]}"
    return Fetch(fetch_id=fid, dataset_id=dataset["id"], source_id=dataset["source_id"], url=url,
                 retrieved_at=iso(now), raw_file_hash=h, bytes=len(content), raw_path=str(priv),
                 archive_public=public_ok, archive_key=key,
                 http_last_modified=(headers or {}).get("Last-Modified"), link_kind=link_kind, content=content)


# ----------------------------------------------------------------------------- issues (issues only; never PRs)

def record_issue(kind: str, title: str, body: str, *, source_id: str | None = None, dedupe_key: str | None = None) -> dict:
    """Write an issue request. The workflow turns these into GitHub issues (see scripts/open_issues.py).

    The pipeline never opens pull requests and never changes its own code or config.
    """
    d = STATE / "issues"
    d.mkdir(parents=True, exist_ok=True)
    key = dedupe_key or hashlib.sha1(f"{kind}|{title}".encode()).hexdigest()[:12]
    rec = {"kind": kind, "title": title, "body": body, "source_id": source_id, "dedupe_key": key, "created_at": iso(utcnow())}
    (d / f"{key}.json").write_text(json.dumps(rec, indent=2), encoding="utf-8")
    return rec


def write_json(path: Path, obj: Any, *, compact: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":") if compact else None, indent=None if compact else 2,
                     allow_nan=False, default=str)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(txt, encoding="utf-8")
    tmp.replace(path)


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))
