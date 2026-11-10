"""Series identity, site-derived series, validation gates, revision history, and cross-source reconciliation."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import re

import numpy as np
import pandas as pd

from .core import CASE_DEFINITIONS, PERIOD_TYPES

KEY_COLS = ["disease", "dataset_id", "metric", "case_definition", "case_definition_detail", "surveillance_system", "period_type"]


def slug(s: str, n: int = 28) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")[:n] or "x"


def series_key(disease, dataset_id, metric, cdef, detail, system, ptype) -> str:
    """Stable id of a series without its place. Different definitions always get different keys."""
    h = hashlib.sha1(str(detail).encode()).hexdigest()[:6]
    return f"{disease}.{dataset_id}.{metric}.{cdef}-{h}.{system}.{ptype}"


def add_series_ids(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df.assign(skey=[], series_id=[])
    keys = df[KEY_COLS].drop_duplicates()
    keys["skey"] = [series_key(*r) for r in keys.itertuples(index=False)]
    out = df.merge(keys, on=KEY_COLS, how="left")
    out["series_id"] = out["skey"] + "." + out["iso3"]
    return out


def chain_id(chain: list[dict]) -> str:
    return "c" + hashlib.sha1(json.dumps(chain, sort_keys=True).encode()).hexdigest()[:10]


# ----------------------------------------------------------------------------- site-derived series

def derive_flu_all_systems(df: pd.DataFrame) -> pd.DataFrame:
    """Sum FluNet series across surveillance systems (method ``sum_surveillance_systems`` v1).

    The result is labelled site-derived and lists its input series. The per-system series stay available.
    """
    src = df[(df["dataset_id"] == "who_flunet_weekly")]
    if src.empty:
        return src
    g = src.groupby(["disease", "iso3", "period", "period_type", "metric", "case_definition", "case_definition_detail", "dataset_id"],
                    as_index=False).agg(value=("value", "sum"), fetch_id=("fetch_id", "first"),
                                        raw_record_ref=("raw_record_ref", lambda s: " + ".join(sorted(s))))
    g["surveillance_system"] = "all_reported"
    g["origin_type"] = "site-derived"
    return g[df.columns]


DENGUE_PRIORITY = {"notified": 0, "confirmed": 1, "probable": 2, "suspected": 3, "unknown": 4}


def derive_dengue_annual(df: pd.DataFrame, today: dt.date) -> pd.DataFrame:
    """One annual dengue value per country-year (method ``dengue_annual_mixed`` v1).

    For each country and year: use an annual record if the source has one; otherwise sum monthly records when
    all 12 months are present; otherwise sum weekly records when at least 52 weeks are present. Where several
    definitions exist, take the broadest (combined/total > confirmed > probable > suspected) and record which
    one was used in ``case_definition_detail``. The series is labelled ``mixed`` because definitions differ
    between countries and years: it must not be used to compare countries.
    """
    src = df[df["dataset_id"] == "opendengue_national"]
    if src.empty:
        return src
    s = src.copy()
    s["year"] = s["period"].str[:4].astype(int)
    grp = s.groupby(["iso3", "year", "period_type", "case_definition", "case_definition_detail"], as_index=False).agg(
        value=("value", "sum"), n=("value", "size"), fetch_id=("fetch_id", "first"))
    need = {"Y": 1, "M": 12, "W": 52}
    grp = grp[grp.apply(lambda r: r["n"] >= need[r["period_type"]], axis=1)]
    grp = grp[grp["year"] < today.year]
    grp["prio_res"] = grp["period_type"].map({"Y": 0, "M": 1, "W": 2})
    grp["prio_def"] = grp["case_definition"].map(DENGUE_PRIORITY)
    grp = grp.sort_values(["iso3", "year", "prio_def", "prio_res", "value"], ascending=[True, True, True, True, False])
    best = grp.groupby(["iso3", "year"], as_index=False).first()
    out = pd.DataFrame({
        "disease": "dengue", "iso3": best["iso3"], "period": best["year"].astype(str) + "-01-01", "period_type": "Y",
        "metric": "cases", "value": best["value"].astype(float), "case_definition": "mixed",
        "case_definition_detail": "broadest definition available per country-year (see point notes)",
        "surveillance_system": "compiled_public_reports", "dataset_id": "opendengue_national", "fetch_id": best["fetch_id"],
        "raw_record_ref": ("ISO_A0=" + best["iso3"] + ";Year=" + best["year"].astype(str) + ";T_res=" + best["period_type"]
                           + ";definition=" + best["case_definition_detail"]),
        "origin_type": "site-derived",
    })
    return out[df.columns]


# ----------------------------------------------------------------------------- validation gates

def validate_dataset(ds: dict, df: pd.DataFrame, prev: pd.DataFrame | None, today: dt.date) -> list[str]:
    """Return a list of problems. Any problem quarantines the dataset: the last good data stays live."""
    problems: list[str] = []
    if len(df) < ds.get("expected_min_rows", 1):
        problems.append(f"row count {len(df)} below expected minimum {ds.get('expected_min_rows', 1)}")
    if df.empty:
        return problems
    bad = set(df["case_definition"]) - set(CASE_DEFINITIONS)
    if bad:
        problems.append(f"unknown case_definition values: {sorted(bad)}")
    if set(df["period_type"]) - set(PERIOD_TYPES):
        problems.append("unknown period_type values")
    if not df["period"].str.fullmatch(r"\d{4}-\d{2}-\d{2}").all():
        problems.append("period not in YYYY-MM-DD")
    else:
        hi = (today + dt.timedelta(days=7)).isoformat()
        if (df["period"] > hi).any():
            problems.append(f"{int((df['period'] > hi).sum())} records dated in the future")
        if (df["period"] < "1900-01-01").any():
            problems.append("records dated before 1900")
    vals = df["value"].to_numpy(dtype=float)
    if not np.isfinite(vals).all():
        problems.append("non-finite values")
    if (vals < 0).any() and not ds.get("allow_negative"):
        problems.append(f"{int((vals < 0).sum())} negative values")
    key = ["iso3", "period", "period_type", "metric", "case_definition", "case_definition_detail", "surveillance_system"]
    if df.duplicated(subset=key).any():
        problems.append(f"{int(df.duplicated(subset=key).sum())} duplicate records for the same series and period")
    if prev is not None and not prev.empty:
        if len(df) < 0.8 * len(prev):
            problems.append(f"row count fell from {len(prev)} to {len(df)} (more than 20% drop)")
        m = prev.merge(df, on=key, how="inner", suffixes=("_prev", "_new"))
        zeros = m[(m["value_prev"] >= 50) & (m["value_new"] == 0)]
        if len(zeros) > max(200, 0.01 * len(m)):
            problems.append(f"{len(zeros)} values of 50 or more dropped to zero since the previous snapshot")
    return problems


# ----------------------------------------------------------------------------- revision history (data vintage)

REV_COLS = ["series_id", "period", "snapshot_id", "value"]


def record_revisions(history: pd.DataFrame | None, current: pd.DataFrame, snapshot_id: str,
                     quarantined_prefixes: tuple[str, ...] = ()) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Append only what changed since the latest stored state.

    ``history`` holds one row per (series, period, snapshot) *change*: the first snapshot stores every value,
    later snapshots store only values that are new, different, or removed (value NaN). Returns
    (new_history, changes_in_this_snapshot).
    """
    cur = current[["series_id", "period", "value"]]
    if history is None or history.empty:
        ch = cur.assign(snapshot_id=snapshot_id)[REV_COLS]
        return ch.reset_index(drop=True), ch.assign(prev=np.nan, kind="new")
    latest = as_of(history, None)
    m = latest.merge(cur, on=["series_id", "period"], how="outer", suffixes=("_old", "_new"), indicator=True)
    changed = m[(m["_merge"] == "right_only")
                | ((m["_merge"] == "both") & ~np.isclose(m["value_old"], m["value_new"], rtol=0, atol=1e-9, equal_nan=True))
                | ((m["_merge"] == "left_only") & m["value_old"].notna())]
    if quarantined_prefixes:
        changed = changed[~changed["series_id"].str.startswith(quarantined_prefixes)]
    ch = pd.DataFrame({"series_id": changed["series_id"], "period": changed["period"], "snapshot_id": snapshot_id,
                       "value": changed["value_new"]})
    kinds = np.where(changed["_merge"] == "right_only", "new", np.where(changed["_merge"] == "left_only", "removed", "revised"))
    new_hist = pd.concat([history[REV_COLS], ch], ignore_index=True)
    return new_hist, ch.assign(prev=changed["value_old"].to_numpy(), kind=kinds)


def as_of(history: pd.DataFrame, snapshot_id: str | None) -> pd.DataFrame:
    """Reconstruct what was published at ``snapshot_id`` (None = latest). Snapshot ids sort chronologically."""
    h = history if snapshot_id is None else history[history["snapshot_id"] <= snapshot_id]
    if h.empty:
        return pd.DataFrame(columns=["series_id", "period", "value"])
    # keep the last change per value; a removal (NaN) must win over the earlier value, so no groupby().last()
    last = h.sort_values("snapshot_id", kind="stable").drop_duplicates(["series_id", "period"], keep="last")
    last = last[last["value"].notna()]
    return last[["series_id", "period", "value"]].reset_index(drop=True)


def snapshot_diff(history: pd.DataFrame, a: str, b: str) -> pd.DataFrame:
    """Values that differ between two snapshots: series_id, period, value_a, value_b, change, kind."""
    da, db = as_of(history, a), as_of(history, b)
    m = da.merge(db, on=["series_id", "period"], how="outer", suffixes=("_a", "_b"))
    diff = m[~np.isclose(m["value_a"], m["value_b"], rtol=0, atol=1e-9, equal_nan=True)].copy()
    diff["change"] = diff["value_b"] - diff["value_a"]
    diff["kind"] = np.where(diff["value_a"].isna(), "new", np.where(diff["value_b"].isna(), "removed", "revised"))
    return diff.reset_index(drop=True)


# ----------------------------------------------------------------------------- cross-source reconciliation

def reconcile(df: pd.DataFrame, rel_tol: float = 0.05, abs_tol: float = 5.0) -> pd.DataFrame:
    """Compare sources that report the same disease, place, period, metric and case definition.

    Rule ``reconcile_pairwise`` v1: two values disagree when they differ by more than ``abs_tol`` and by more
    than ``rel_tol`` of the larger value. Nothing is merged or averaged; every source's value is kept.
    Only source-reported or like-for-like series are compared (same period type and definition).
    """
    cols = ["disease", "iso3", "period", "period_type", "metric", "case_definition"]
    sub = df[df["surveillance_system"] != "all_reported"]
    sub = sub[sub["case_definition"] != "mixed"]
    g = sub.groupby(cols + ["dataset_id"], as_index=False).agg(value=("value", "sum"), series_id=("series_id", "first"))
    n = g.groupby(cols)["dataset_id"].transform("nunique")
    g = g[n >= 2]
    if g.empty:
        return pd.DataFrame(columns=cols + ["sources", "min", "max", "spread", "disagree"])
    agg = g.groupby(cols).agg(min=("value", "min"), max=("value", "max"),
                              sources=("dataset_id", lambda s: ",".join(sorted(s))),
                              values=("value", lambda s: ",".join(f"{v:g}" for v in s)),
                              series_ids=("series_id", lambda s: ",".join(s))).reset_index()
    agg["spread"] = agg["max"] - agg["min"]
    agg["disagree"] = (agg["spread"] > abs_tol) & (agg["spread"] > rel_tol * agg["max"].clip(lower=1))
    return agg


def period_add(period: str, ptype: str, n: int) -> str:
    d = dt.date.fromisoformat(period)
    if ptype == "W":
        return (d + dt.timedelta(days=7 * n)).isoformat()
    if ptype == "M":
        m = d.year * 12 + (d.month - 1) + n
        return dt.date(m // 12, m % 12 + 1, 1).isoformat()
    return dt.date(d.year + n, 1, 1).isoformat()


def periods_between(a: str, b: str, ptype: str) -> int:
    da, db = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    if ptype == "W":
        return (db - da).days // 7
    if ptype == "M":
        return (db.year - da.year) * 12 + db.month - da.month
    return db.year - da.year


def current_period(today: dt.date, ptype: str) -> str:
    if ptype == "W":
        return (today - dt.timedelta(days=today.weekday())).isoformat()
    if ptype == "M":
        return today.replace(day=1).isoformat()
    return today.replace(month=1, day=1).isoformat()


def safe(v):
    """JSON-safe number."""
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return None
    f = float(v)
    return int(f) if f.is_integer() else round(f, 4)
