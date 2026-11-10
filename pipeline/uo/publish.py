"""Write every published file: the static /data/v1 API, bulk exports, catalog metadata, and the snapshot manifest.

Everything is written into a staging directory and swapped in at the end, so a failed run never leaves a
half-written site. Every file that carries values also carries (or references) its sources.
"""
from __future__ import annotations

import datetime as dt
import gzip
import hashlib
import json
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from . import signals, timeseries as ts
from .core import CADENCE_DAYS, DATA_OUT, ROOT, STATE, iso, read_json, record_issue, write_json

SCHEMA_VERSION = "1.0.0"
WINDOW = {"W": 4, "M": 1, "Y": 1}
GRID_PERIODS = {"W": 104, "M": 60, "Y": 40}
PERIOD_DAYS = {"W": 7, "M": 31, "Y": 366}
FRESH_LAST = {"W": 12, "M": 6, "Y": 3}


@dataclass
class Context:
    site: dict
    registry: dict
    diseases_doc: dict
    datasets: dict
    places: dict
    boundaries: dict
    df: pd.DataFrame
    history: pd.DataFrame
    snapshots: list
    snapshot_id: str
    fetches: dict
    ref_fetches: dict
    status: dict
    events: list
    event_history: dict
    unmapped: list
    now: dt.datetime
    changes: pd.DataFrame


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def series_meta(ctx: Context) -> pd.DataFrame:
    """One row per series key with origin type, transformation chain and inputs."""
    m = ctx.df.groupby("skey", as_index=False).agg(
        disease=("disease", "first"), dataset_id=("dataset_id", "first"), metric=("metric", "first"),
        case_definition=("case_definition", "first"), case_definition_detail=("case_definition_detail", "first"),
        surveillance_system=("surveillance_system", "first"), period_type=("period_type", "first"),
        origin_type=("origin_type", "first"), n_places=("iso3", "nunique"), last_period=("period", "max"))
    chains, inputs = [], []
    for r in m.itertuples():
        ds = ctx.datasets[r.dataset_id]
        chain = [dict(c) for c in ds.get("chain", [])]
        inp: list[str] = []
        if r.surveillance_system == "all_reported":
            chain.append({"op": "sum_surveillance_systems", "method_version": "1",
                          "params": {"systems": ["sentinel", "non_sentinel", "not_defined"]}})
            inp = sorted(m[(m["dataset_id"] == r.dataset_id) & (m["metric"] == r.metric)
                           & (m["surveillance_system"] != "all_reported")]["skey"])
        if r.case_definition == "mixed":
            chain.append({"op": "dengue_annual_mixed", "method_version": "1",
                          "params": {"priority": ["notified", "confirmed", "probable", "suspected"], "min_months": 12, "min_weeks": 52}})
            inp = sorted(m[(m["dataset_id"] == r.dataset_id) & (m["case_definition"] != "mixed")]["skey"])
        chains.append(chain)
        inputs.append(inp)
    m["chain"] = chains
    m["chain_id"] = [ts.chain_id(c) for c in chains]
    m["inputs"] = inputs
    m["source_id"] = [ctx.datasets[d]["source_id"] for d in m["dataset_id"]]
    return m


def default_skeys(ctx: Context, meta: pd.DataFrame) -> dict[str, str]:
    out = {}
    for d in ctx.diseases_doc["diseases"]:
        ds = d.get("default_series")
        if not ds:
            continue
        hit = meta[(meta["disease"] == d["id"]) & (meta["dataset_id"] == ds["dataset"]) & (meta["metric"] == ds["metric"])
                   & (meta["case_definition"] == ds["case_definition"]) & (meta["surveillance_system"] == ds["surveillance_system"])]
        if ds["dataset"] == "opendengue_national":
            hit = hit[hit["period_type"] == "Y"]
        if len(hit):
            out[d["id"]] = hit.sort_values("n_places", ascending=False).iloc[0]["skey"]
    return out


def lag_table(ctx: Context) -> dict[str, dict]:
    """Per dataset and period type: reporting-lag estimate, data edge and the first 'likely incomplete' period."""
    out = {}
    snap_dates = {s["id"]: dt.date.fromisoformat(s["created_at"][:10]) for s in ctx.snapshots}
    today = ctx.now.date()
    for (dsid, ptype), g in ctx.df.groupby(["dataset_id", "period_type"]):
        ds = ctx.datasets[dsid]
        default = ds.get("lag_default_periods", {"W": 2, "M": 2, "Y": 0}[ptype])
        prefix = f"{ds['disease']}.{dsid}."
        h = ctx.history[ctx.history["series_id"].str.startswith(prefix)] if ctx.history is not None else None
        if h is not None:
            h = h[h["series_id"].str.contains(rf"\.{ptype}\.[A-Z]{{3}}$")]
        est = signals.estimate_lag(h, ptype, default, {k: ts.current_period(v, ptype) for k, v in snap_dates.items()})
        cur = ts.current_period(today, ptype)
        edge = min(g["period"].max(), cur)
        est["data_edge"] = edge
        est["incomplete_from"] = ts.period_add(edge, ptype, 1 - est["lag_periods"])
        out[f"{dsid}|{ptype}"] = est
    return out


def stale_info(ctx: Context, dsid: str, ptype: str | None, last_period: str | None) -> dict:
    src = ctx.registry[(ctx.datasets.get(dsid) or {}).get("source_id")] if dsid in ctx.datasets else None
    cadence = src["cadence"] if src else "daily"
    today = ctx.now.date()
    if last_period and ptype:
        end = dt.date.fromisoformat(last_period) + dt.timedelta(days=PERIOD_DAYS[ptype])
        age = (today - end).days
    else:
        age = None
    limit = 2 * CADENCE_DAYS[cadence] + 14
    return {"cadence": cadence, "freshness_days": age, "stale": bool(age is not None and age > limit), "stale_after_days": limit}


def assert_no_test_data(ctx: Context) -> None:
    """Fixtures and mock data carry the TEST DATA origin type and are rejected in production builds."""
    if os.environ.get("UO_ALLOW_TEST_DATA") == "1":
        return
    bad_origin = bool((ctx.df["origin_type"] == "test-data").any())
    bad_source = [d for d in ctx.df["dataset_id"].unique() if ctx.datasets.get(d, {}).get("source_id") == "test_data"]
    bad_events = [e["event_id"] for e in ctx.events if "test_data" in e["source_ids"]]
    if bad_origin or bad_source or bad_events:
        from .core import PipelineError
        raise PipelineError(f"TEST DATA must never be published: origin={bad_origin} datasets={bad_source} events={bad_events[:3]}")


def publish_all(ctx: Context, log) -> dict:
    assert_no_test_data(ctx)
    out = DATA_OUT.parent / (DATA_OUT.name + ".staging")
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    df = ctx.df
    meta = series_meta(ctx)
    defaults = default_skeys(ctx, meta)
    lags = lag_table(ctx)
    dis_cfg = {d["id"]: d for d in ctx.diseases_doc["diseases"]}
    meta_by = meta.set_index("skey")
    pop = {k: v["population"] for k, v in ctx.places.items()}

    def inc_from(skey: str) -> str:
        r = meta_by.loc[skey]
        return lags[f"{r['dataset_id']}|{r['period_type']}"]["incomplete_from"]

    # ---- places, boundaries, chains, fetches
    write_json(out / "places.json", {"source_ids": ["geonames", "worldbank", "naturalearth"], "origin_type": "source-reported",
                                     "snapshot_id": ctx.snapshot_id, "fetches": ctx.ref_fetches,
                                     "notes": {"neighbours": "GeoNames countryInfo", "population": "World Bank SP.POP.TOTL, most recent year",
                                               "centroid": "site-derived: centroid of the largest Natural Earth polygon"},
                                     "places": ctx.places})
    b = dict(ctx.boundaries)
    b["source_id"] = "naturalearth"
    b["origin_type"] = "source-reported"
    b["attribution"] = ctx.registry["naturalearth"]["citation"]
    write_json(out / "boundaries.geojson", b)
    chains = {r.chain_id: r.chain for r in meta.itertuples()}
    write_json(out / "chains.json", {"chains": chains})
    write_json(out / "fetches.json", {"snapshot_id": ctx.snapshot_id, "fetches": ctx.fetches})

    # ---- per-country time series, lineage
    log("writing time series")
    n_files = 0
    for (disease, iso3), g in df.groupby(["disease", "iso3"], sort=False):
        series, lineage = {}, {}
        for skey, s in g.groupby("skey", sort=False):
            s = s.sort_values("period")
            series[skey] = {"p": s["period"].tolist(), "v": [ts.safe(v) for v in s["value"]]}
            fids = list(dict.fromkeys(s["fetch_id"]))
            lin = {"p": s["period"].tolist(), "r": s["raw_record_ref"].tolist(), "f": fids}
            if len(fids) > 1:
                ix = {f: i for i, f in enumerate(fids)}
                lin["fi"] = [ix[f] for f in s["fetch_id"]]
            lineage[skey] = lin
        write_json(out / "ts" / disease / f"{iso3}.json", {"disease": disease, "iso3": iso3, "snapshot_id": ctx.snapshot_id, "series": series})
        write_json(out / "lineage" / disease / f"{iso3}.json", {"disease": disease, "iso3": iso3, "snapshot_id": ctx.snapshot_id, "series": lineage})
        n_files += 2

    # ---- revisions (vintage): only values that differ from a series' first snapshot
    snap_ix = {s["id"]: i for i, s in enumerate(ctx.snapshots)}
    h = ctx.history.copy()
    h["si"] = h["snapshot_id"].map(snap_ix)
    h["disease"] = h["series_id"].str.split(".", n=1).str[0]
    base = h.groupby("series_id")["si"].transform("min")
    cnt = h.groupby(["series_id", "period"])["si"].transform("size")
    ch = h[(h["si"] != base) | (cnt > 1)]
    base_exc = h[base > 0].groupby("series_id")["si"].min()
    rev_index: dict = {}
    for disease, g in ch.groupby("disease"):
        g = g.assign(iso3=g["series_id"].str[-3:], skey=g["series_id"].str[:-4])
        countries = []
        for iso3, gc in g.groupby("iso3"):
            ser: dict = {}
            for (skey, period), gp in gc.sort_values("si").groupby(["skey", "period"]):
                ser.setdefault(skey, {})[period] = [[int(i), ts.safe(v)] for i, v in zip(gp["si"], gp["value"])]
            write_json(out / "revisions" / disease / f"{iso3}.json", {"disease": disease, "iso3": iso3, "changes": ser})
            countries.append(iso3)
        rev_index[disease] = countries
    write_json(out / "revisions" / "index.json", {
        "origin_type": "site-derived", "source_ids": ["uo_site"],
        "note": "Vintage reflects what this site retrieved and published, not necessarily when a source first released a number.",
        "snapshots": [s["id"] for s in ctx.snapshots], "countries_with_changes": rev_index,
        "base_exceptions": {k: int(v) for k, v in base_exc.items()}})

    # ---- overview per disease, flags, reconciliation
    log("computing overview, flags, reconciliation")
    all_flags, movers, disease_out = [], [], []
    for d in ctx.diseases_doc["diseases"]:
        did = d["id"]
        dmeta = meta[meta["disease"] == did]
        entry = {k: d.get(k) for k in ("id", "name", "icd11", "mesh", "data_type", "seasonal", "cadence", "aliases")}
        entry["has_timeseries"] = bool(len(dmeta))
        entry["badge"] = "timeseries" if len(dmeta) else "events-only"
        entry["rate_metric"] = bool(d.get("rate_metric", False))
        entry["map_metric"] = d.get("map_metric", "rate_per_100k")
        entry["default_skey"] = defaults.get(did)
        entry["series"] = []
        for r in dmeta.itertuples():
            ds = ctx.datasets[r.dataset_id]
            lg = lags[f"{r.dataset_id}|{r.period_type}"]
            st = stale_info(ctx, r.dataset_id, r.period_type, lg["data_edge"])
            entry["series"].append({
                "skey": r.skey, "dataset_id": r.dataset_id, "source_id": r.source_id, "origin_type": r.origin_type,
                "metric": r.metric, "case_definition": r.case_definition, "case_definition_detail": r.case_definition_detail,
                "surveillance_system": r.surveillance_system, "period_type": r.period_type, "chain_id": r.chain_id,
                "inputs": r.inputs, "n_places": int(r.n_places), "deep_link": ds["deep_link"], "link_kind": ds.get("link_kind", "deep"),
                "case_definition_note": ds.get("case_definition_note"), "surveillance_system_note": ds.get("surveillance_system_note"),
                "lag": lg, "stale": st["stale"], "freshness_days": st["freshness_days"],
                "retrieved_at": max((ctx.fetches[f]["retrieved_at"] for f in ctx.status.get(r.dataset_id, {}).get("fetch_ids", [])
                                     if f in ctx.fetches), default=None),
                "dataset_state": ctx.status.get(r.dataset_id, {}).get("state", "ok"),
            })
        disease_out.append(entry)
        if did not in defaults:
            continue
        dk = defaults[did]
        mrow = meta_by.loc[dk]
        ptype = mrow["period_type"]
        lg = lags[f"{mrow['dataset_id']}|{ptype}"]
        incf = lg["incomplete_from"]
        anchor = ts.period_add(incf, ptype, -1)
        w = WINDOW[ptype]
        win = [ts.period_add(anchor, ptype, -i) for i in range(w)][::-1]
        dd = df[df["skey"] == dk]
        piv = dd.pivot_table(index="period", columns="iso3", values="value", aggfunc="first")
        pct = entry["map_metric"] == "percent_positive"
        spec = None
        if pct:
            sk = dmeta[(dmeta["metric"] == "specimens_processed") & (dmeta["surveillance_system"] == "all_reported")]["skey"]
            if len(sk):
                spec = df[df["skey"] == sk.iloc[0]].pivot_table(index="period", columns="iso3", values="value", aggfunc="first")
        latest = {}
        for iso3 in piv.columns:
            col = piv[iso3]
            vals = [col.get(p, np.nan) for p in win]
            present = [v for v in vals if not (isinstance(v, float) and np.isnan(v))]
            series_p = col.dropna()
            tr = signals.trend_summary(series_p.index.tolist(), series_p.tolist(), ptype, incf)
            rec = {"window": [win[0], win[-1]], "n_periods": len(present), "value": None, "metric_value": None, "trend": tr,
                   "last_period": series_p.index.max() if len(series_p) else None}
            if len(present) * 2 >= w and present:
                tot = float(sum(present))
                rec["value"] = ts.safe(tot)
                if pct and spec is not None and iso3 in spec.columns:
                    sp = [spec[iso3].get(p, np.nan) for p in win]
                    sps = float(np.nansum(sp))
                    if sps >= 20:
                        rec["metric_value"] = round(100.0 * tot / sps, 2)
                elif not pct and pop.get(iso3):
                    rec["metric_value"] = round(tot / pop[iso3] * 1e5, 4)
            latest[iso3] = rec
            if tr.get("change_pct") is not None and tr["latest_complete"] >= ts.period_add(anchor, ptype, -2):
                movers.append({"disease": did, "iso3": iso3, "skey": dk, "period": tr["latest_complete"], "value": tr["value"],
                               "prev_period": tr["prev_period"], "change_pct": tr["change_pct"],
                               "abs_change": ts.safe(tr["value"] * (1 - 1 / (1 + tr["change_pct"] / 100)) if tr["change_pct"] != -100 else -tr["value"])})
        edge = lg["data_edge"]
        gp = [ts.period_add(edge, ptype, -i) for i in range(GRID_PERIODS[ptype])][::-1]
        grid = {}
        for iso3 in piv.columns:
            col = piv[iso3]
            row = []
            for p in gp:
                v = col.get(p, np.nan)
                if isinstance(v, float) and np.isnan(v):
                    row.append(None)
                elif pct:
                    s = spec[iso3].get(p, np.nan) if spec is not None and iso3 in spec.columns else np.nan
                    row.append(round(100.0 * v / s, 2) if s and not np.isnan(s) and s >= 5 else None)
                else:
                    row.append(round(v / pop[iso3] * 1e5, 4) if pop.get(iso3) else None)
            if any(x is not None for x in row):
                grid[iso3] = row
        glob = dd.groupby("period").agg(v=("value", "sum"), n=("iso3", "nunique")).sort_index()
        write_json(out / "overview" / f"{did}.json", {
            "disease": did, "skey": dk, "origin_type": "site-derived", "source_ids": sorted({mrow["source_id"], "worldbank"} if not pct else {mrow["source_id"]}),
            "snapshot_id": ctx.snapshot_id, "period_type": ptype, "map_metric": entry["map_metric"],
            "method": {"name": "window_rate", "version": "1", "window_periods": w,
                       "population": "World Bank most recent year" if not pct else None},
            "anchor": anchor, "incomplete_from": incf, "data_edge": edge, "latest": latest,
            "grid": {"periods": gp, "values": grid},
            "global": {"p": glob.index.tolist(), "v": [ts.safe(v) for v in glob["v"]], "n": [int(n) for n in glob["n"]]},
        })
        # signal flags on the default series
        fl_rows = []
        if ptype in signals.FLAG_PARAMS["min_count"]:
            for iso3 in piv.columns:
                s = piv[iso3].dropna()
                for f in signals.compute_flags(s.index.tolist(), s.tolist(), ptype, incf, bool(d.get("seasonal"))):
                    fl_rows.append({"disease": did, "iso3": iso3, "skey": dk, "series_id": f"{dk}.{iso3}", **f,
                                    "origin_type": "site-derived", "source_ids": [mrow["source_id"]], "params_version": "1"})
        write_json(out / "flags" / f"{did}.json", {"disease": did, "method": signals.FLAG_METHOD, "params": signals.FLAG_PARAMS,
                                                    "origin_type": "site-derived", "snapshot_id": ctx.snapshot_id, "flags": fl_rows})
        all_flags += fl_rows

    recent_cut = {p: ts.period_add(ts.current_period(ctx.now.date(), p), p, -12) for p in ("W", "M")}
    recent_flags = [f for f in all_flags if f["status"] == "flagged"
                    and f["period"] >= recent_cut[meta_by.loc[f["skey"]]["period_type"]]]
    recent_flags.sort(key=lambda f: f["period"], reverse=True)
    write_json(out / "flags" / "recent.json", {"method": signals.FLAG_METHOD, "params": signals.FLAG_PARAMS, "origin_type": "site-derived",
                                                "snapshot_id": ctx.snapshot_id, "flags": recent_flags})

    rec = ts.reconcile(df)
    rec_summary = {}
    for disease, g in rec.groupby("disease"):
        byc = {}
        for iso3, gc in g[g["disagree"]].groupby("iso3"):
            byc[iso3] = [{"period": r.period, "period_type": r.period_type, "metric": r.metric, "case_definition": r.case_definition,
                          "datasets": r.sources.split(","), "values": [float(v) for v in r.values.split(",")],
                          "series_ids": r.series_ids.split(","), "disagree": bool(r.disagree)} for r in gc.sort_values("period").itertuples()]
        write_json(out / "reconcile" / f"{disease}.json", {
            "disease": disease, "origin_type": "site-derived", "method": {"name": "reconcile_pairwise", "version": "1", "rel_tol": 0.05, "abs_tol": 5},
            "source_ids": sorted({ctx.datasets[x]["source_id"] for s in g["sources"] for x in s.split(",")}),
            "snapshot_id": ctx.snapshot_id,
            "note": "Only periods where sources disagree are listed; every source's full series is in ts/{disease}/{iso3}.json.",
            "overlap_counts": {k: int(v) for k, v in g.groupby("iso3").size().items()}, "countries": byc})
        rec_summary[disease] = {"overlaps": int(len(g)), "disagreements": int(g["disagree"].sum()),
                                "datasets": sorted({x for s in g["sources"] for x in s.split(",")})}

    write_json(out / "diseases.json", {"vocabulary_version": ctx.diseases_doc["vocabulary_version"], "snapshot_id": ctx.snapshot_id,
                                       "case_definitions": ["confirmed", "probable", "suspected", "notified", "unknown", "mixed", "not_applicable"],
                                       "reconciliation": rec_summary, "diseases": disease_out})

    # ---- events
    log("writing events")
    idx = []
    ts_diseases = {d["id"] for d in disease_out if d["has_timeseries"]}
    for e in ctx.events:
        e = dict(e)
        e["snapshot_id"] = ctx.snapshot_id
        e["history"] = ctx.event_history.get(e["event_id"], [])
        e["linked_series"] = [{"disease": e["disease"], "iso3": c} for c in e["countries"] if e["disease"] in ts_diseases
                              and (out / "ts" / e["disease"] / f"{c}.json").exists()]
        write_json(out / "events" / f"{e['event_id']}.json", e)
        latest = e["reports"][-1]
        idx.append({"event_id": e["event_id"], "disease": e["disease"], "name_in_source": e["name_in_source"], "countries": e["countries"],
                    "first_report": e["first_report"], "last_report": e["last_report"], "status": e["status"], "status_basis": e["status_basis"],
                    "cases": e["cases"], "deaths": e["deaths"], "n_reports": len(e["reports"]), "source_ids": e["source_ids"],
                    "rank": e["rank"], "latest_title": latest["title"], "latest_url": latest["url"], "quality_flags": e["quality_flags"],
                    "locations": [{k: l.get(k) for k in ("iso3", "precision", "lon", "lat", "name")} for l in e["locations"]],
                    "origin_type": "site-derived", "days_since_last_report": e["days_since_last_report"]})
    idx.sort(key=lambda x: (-x["rank"]["score"], x["event_id"]))
    from .events import RANK_METHOD, GROUP_METHOD, GEOCODE_METHOD, NO_RECENT_UPDATE_DAYS
    write_json(out / "events" / "index.json", {
        "snapshot_id": ctx.snapshot_id, "origin_type": "site-derived", "source_ids": sorted({s for e in idx for s in e["source_ids"]}),
        "methods": {"ranking": RANK_METHOD, "grouping": GROUP_METHOD, "geocoding": GEOCODE_METHOD,
                    "no_recent_update_days": NO_RECENT_UPDATE_DAYS}, "unmapped_names": ctx.unmapped, "events": idx})

    # ---- quality, sources, weekly, changelog
    quality = build_quality(ctx, meta, lags)
    write_json(out / "quality.json", quality)
    src_out = []
    for sid, s in ctx.registry.items():
        if s["kind"] == "test":
            continue
        dsq = [q for q in quality["datasets"] if q["source_id"] == sid]
        src_out.append({**s, "datasets": [q["dataset_id"] for q in dsq],
                        "last_success": max((q["last_success"] for q in dsq if q["last_success"]), default=None),
                        "stale": any(q["stale"] for q in dsq), "state": "quarantined" if any(q["state"] != "ok" for q in dsq) else "ok"})
    write_json(out / "sources.json", {"registry_version": 1, "snapshot_id": ctx.snapshot_id, "sources": src_out})
    weekly = build_weekly(ctx, idx, movers, recent_flags, meta_by)
    write_json(out / "weekly" / f"{weekly['week']}.json", weekly)
    write_json(out / "weekly" / "latest.json", weekly)
    prev_weeks = sorted({p.stem for p in (DATA_OUT / "weekly").glob("*-W*.json")} | {weekly["week"]}) if (DATA_OUT / "weekly").exists() else [weekly["week"]]
    for wk in prev_weeks:
        srcf = DATA_OUT / "weekly" / f"{wk}.json"
        if wk != weekly["week"] and srcf.exists():
            shutil.copy(srcf, out / "weekly" / f"{wk}.json")
    write_json(out / "weekly" / "index.json", {"weeks": prev_weeks})
    write_json(out / "changelog.json", build_changelog())

    # ---- bulk exports + catalog
    log("writing bulk exports")
    from .export import write_bulk
    bulk = write_bulk(ctx, out, meta, lags, defaults, all_flags, idx)

    # ---- snapshot manifest + top-level manifest
    files = []
    for p in sorted(out.rglob("*")):
        if p.is_file() and p.parts[len(out.parts)] in ("bulk",):
            files.append({"path": str(p.relative_to(out)), "sha256": _sha(p), "bytes": p.stat().st_size})
    snap_manifest = {
        "snapshot_id": ctx.snapshot_id, "created_at": next(s["created_at"] for s in ctx.snapshots if s["id"] == ctx.snapshot_id),
        "immutable": True, "schema_version": SCHEMA_VERSION,
        "note": "Vintage reflects what this site retrieved and published, not necessarily when a source first released a number.",
        "raw_files": [{k: f[k] for k in ("fetch_id", "dataset_id", "source_id", "url", "retrieved_at", "raw_file_hash", "bytes",
                                         "archive_public", "archive_key", "link_kind")}
                      for f in list(ctx.fetches.values()) + list(ctx.ref_fetches.values())],
        "data_files": files, "licenses": {sid: s["license"] for sid, s in ctx.registry.items() if s["kind"] != "test"}}
    snapdir = out / "snapshots"
    snapdir.mkdir(parents=True, exist_ok=True)
    if (DATA_OUT / "snapshots").exists():  # earlier manifests are immutable: carry them over untouched
        for p in (DATA_OUT / "snapshots").glob("*.json"):
            shutil.copy(p, snapdir / p.name)
    if not (snapdir / f"{ctx.snapshot_id}.json").exists():
        write_json(snapdir / f"{ctx.snapshot_id}.json", snap_manifest, compact=False)
    manifest = {
        "schema_version": SCHEMA_VERSION, "generated_at": iso(ctx.now), "snapshot_id": ctx.snapshot_id, "snapshots": ctx.snapshots,
        "datasets": {q["dataset_id"]: q for q in quality["datasets"]}, "bulk": bulk,
        "counts": {"records": int(len(df)), "series": int(df["series_id"].nunique()), "events": len(idx),
                   "countries": int(df["iso3"].nunique()), "diseases_with_timeseries": len(defaults)},
        "endpoints": {"sources": "sources.json", "diseases": "diseases.json", "places": "places.json", "timeseries": "ts/{disease}/{iso3}.json",
                      "lineage": "lineage/{disease}/{iso3}.json", "revisions": "revisions/{disease}/{iso3}.json", "events": "events/index.json",
                      "event": "events/{event_id}.json", "flags": "flags/{disease}.json", "overview": "overview/{disease}.json",
                      "reconcile": "reconcile/{disease}.json", "quality": "quality.json", "snapshot": "snapshots/{snapshot_id}.json",
                      "weekly": "weekly/latest.json", "catalog": "catalog/dcat.jsonld", "datapackage": "catalog/datapackage.json"}}
    write_json(out / "manifest.json", manifest, compact=False)

    # ---- atomic swap
    old = DATA_OUT.parent / (DATA_OUT.name + ".old")
    if old.exists():
        shutil.rmtree(old)
    if DATA_OUT.exists():
        os.replace(DATA_OUT, old)
    os.replace(out, DATA_OUT)
    if old.exists():
        shutil.rmtree(old)
    return {"snapshot_id": ctx.snapshot_id, "files": n_files, **manifest["counts"], "flags_recent": len(recent_flags),
            "quarantined": [q["dataset_id"] for q in quality["datasets"] if q["state"] != "ok"]}


def build_quality(ctx: Context, meta: pd.DataFrame, lags: dict) -> dict:
    """Public data-quality table, built only from pipeline outputs."""
    linkcheck = read_json(STATE / "linkcheck.json", {})
    rows = []
    hist = ctx.history
    n_snap = len(ctx.snapshots)
    for dsid, ds in ctx.datasets.items():
        st = ctx.status.get(dsid, {})
        g = ctx.df[(ctx.df["dataset_id"] == dsid) & (ctx.df["origin_type"] != "site-derived") | ((ctx.df["dataset_id"] == dsid) & bool(ds.get("derived")))]
        g = g[g["surveillance_system"] != "all_reported"]
        g = g[g["case_definition"] != "mixed"]
        ptypes = sorted(g["period_type"].unique()) if len(g) else []
        ptype = ds.get("period_type") if ds.get("period_type") in ptypes else (ptypes[0] if ptypes else None)
        gp = g[g["period_type"] == ptype] if ptype else g
        lg = lags.get(f"{dsid}|{ptype}", {})
        edge = lg.get("data_edge")
        comp = None
        if ptype and edge:
            incf = lg["incomplete_from"]
            last = [ts.period_add(incf, ptype, -i - 1) for i in range(FRESH_LAST[ptype])]
            places_ever = gp["iso3"].nunique()
            got = gp[gp["period"].isin(last)].groupby("period")["iso3"].nunique().sum()
            comp = round(float(got) / (places_ever * len(last)), 3) if places_ever else None
        prefix = f"{ds['disease']}.{dsid}."
        rr = None
        if hist is not None and n_snap > 1:
            hh = hist[hist["series_id"].str.startswith(prefix)]
            tot = hh.groupby(["series_id", "period"]).ngroups
            revd = int((hh.groupby(["series_id", "period"])["value"].size() > 1).sum())
            rr = round(revd / tot, 4) if tot else None
        si = stale_info(ctx, dsid, ptype, edge)
        rows.append({
            "dataset_id": dsid, "source_id": ds["source_id"], "disease": ds["disease"], "kind": "timeseries",
            "last_success": st.get("last_success"), "last_checked": st.get("last_checked"), "last_changed": st.get("last_changed"),
            "state": st.get("state", "ok"), "error": st.get("error"), "last_good_snapshot": st.get("last_good_snapshot"),
            "expected_cadence": si["cadence"], "freshness_days": si["freshness_days"], "stale": si["stale"], "stale_after_days": si["stale_after_days"],
            "latest_period": edge, "period_type": ptype, "completeness": comp,
            "completeness_basis": f"share of ever-reporting places present in the {FRESH_LAST.get(ptype, 0)} most recent complete periods" if ptype else None,
            "places": int(gp["iso3"].nunique()) if len(gp) else 0, "records": int(len(g)),
            "revision_rate": rr, "revision_rate_basis": f"{n_snap} snapshot(s)" + ("; not yet measurable" if n_snap < 2 else ""),
            "lag": lg or None, "known_gaps": [x for x in [ds.get("surveillance_system_note")] if x],
            "link_check": linkcheck.get(ds["deep_link"].split("{")[0].rstrip("?&"), linkcheck.get(ds["source_id"], {"status": "not-checked"})),
            "license": ctx.registry[ds["source_id"]]["license"], "redistribute_raw": ctx.registry[ds["source_id"]]["redistribute_raw"],
            "origin_type": "site-derived"})
    from .core import CONFIG, load_yaml
    for ds in load_yaml(CONFIG / "datasets.yaml")["events"]:
        st = ctx.status.get(ds["id"], {})
        reps = [r for e in ctx.events for r in e["reports"] if r["dataset_id"] == ds["id"]]
        last = max((r["published"] for r in reps), default=None)
        age = (ctx.now.date() - dt.date.fromisoformat(last)).days if last else None
        cad = ctx.registry[ds["source_id"]]["cadence"]
        rows.append({"dataset_id": ds["id"], "source_id": ds["source_id"], "disease": None, "kind": "events",
                     "last_success": st.get("last_success"), "last_checked": st.get("last_checked"), "last_changed": st.get("last_changed"),
                     "state": st.get("state", "ok"), "error": st.get("error"), "last_good_snapshot": st.get("last_good_snapshot"),
                     "expected_cadence": cad, "freshness_days": age, "stale": bool(age is not None and age > 45), "stale_after_days": 45,
                     "latest_period": last, "period_type": None, "completeness": None, "completeness_basis": None, "places": None,
                     "records": len(reps), "revision_rate": None, "revision_rate_basis": None, "lag": None, "known_gaps": [],
                     "link_check": linkcheck.get(ds["source_id"], {"status": "not-checked"}),
                     "license": ctx.registry[ds["source_id"]]["license"], "redistribute_raw": ctx.registry[ds["source_id"]]["redistribute_raw"],
                     "origin_type": "site-derived"})
    return {"generated_at": iso(ctx.now), "snapshot_id": ctx.snapshot_id, "origin_type": "site-derived", "source_ids": ["uo_site"],
            "n_snapshots": n_snap, "datasets": rows}


def build_weekly(ctx: Context, idx: list, movers: list, recent_flags: list, meta_by) -> dict:
    """'What changed this week': neutral, factual, with lag caveats attached to every mover."""
    today = ctx.now.date()
    y, w, _ = today.isocalendar()
    start = (today - dt.timedelta(days=7)).isoformat()
    new_events = [e for e in idx if e["first_report"] >= start]
    updated = [e for e in idx if e["last_report"] >= start and e["first_report"] < start]
    status_changes = []
    for eid, h in ctx.event_history.items():
        if len(h) >= 2 and h[-1]["status"] != h[-2]["status"] and h[-1]["snapshot_id"][:8] >= start.replace("-", ""):
            status_changes.append({"event_id": eid, "from": h[-2]["status"], "to": h[-1]["status"], "snapshot_id": h[-1]["snapshot_id"]})
    mv = [m for m in movers if abs(m["change_pct"]) >= 25 and m["value"] is not None and (m["value"] >= 50 or (m["abs_change"] or 0) <= -50)]
    mv.sort(key=lambda m: -abs(m["abs_change"] or 0))
    wk_cut = ts.period_add(ts.current_period(today, "W"), "W", -4)
    newly = [f for f in recent_flags if f["period"] >= wk_cut]
    cl = build_changelog()
    corr = [c for c in cl["entries"] if c["date"] >= start]
    return {"week": f"{y}-W{w:02d}", "from": start, "to": today.isoformat(), "generated_at": iso(ctx.now), "snapshot_id": ctx.snapshot_id,
            "origin_type": "site-derived", "source_ids": sorted({s for e in new_events + updated for s in e["source_ids"]} | {"uo_site"}),
            "new_events": new_events, "updated_events": updated, "status_changes": status_changes,
            "movers": mv[:15], "movers_caveat": "Changes compare the two most recent periods that are not marked likely incomplete. They can still be revised.",
            "new_flags": newly, "corrections": corr}


def build_changelog() -> dict:
    """Changelog and corrections, parsed from CORRECTIONS.md, CHANGELOG.md and docs/METHODS_CHANGELOG.md.

    Format: '## YYYY-MM-DD — title' headings followed by free text; '<!-- type: correction|methodology|pipeline|mapping|release -->'.
    """
    entries = []
    for fn, default_type in (("CORRECTIONS.md", "correction"), ("CHANGELOG.md", "release"), ("docs/METHODS_CHANGELOG.md", "methodology")):
        p = ROOT / fn
        if not p.exists():
            continue
        cur = None
        for line in p.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^##\s+(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.+)$", line)
            if m:
                cur = {"date": m.group(1), "title": m.group(2).strip(), "type": default_type, "body": "", "file": fn}
                entries.append(cur)
            elif cur is not None:
                t = re.match(r"^<!--\s*type:\s*([a-z-]+)\s*-->", line.strip())
                if t:
                    cur["type"] = t.group(1)
                elif not line.startswith("# "):
                    cur["body"] += line + "\n"
        for e in entries:
            e["body"] = e["body"].strip()
    entries.sort(key=lambda e: e["date"], reverse=True)
    return {"origin_type": "site-derived", "source_ids": ["uo_site"], "entries": entries}
