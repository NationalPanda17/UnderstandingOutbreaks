"""Pipeline orchestrator.

    python -m uo.build            # fetch, validate, record revisions, compute, publish
    python -m uo.build --offline  # re-use the last fetched raw files (no network)

Order: fetch -> archive raw (hash) -> change detection -> validate (quarantine on failure) -> record revisions
-> lag estimates and signal flags -> events -> publish static files atomically. Failures never remove the last
good data; they write an issue request (issues only, never pull requests).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import sys
import traceback

import pandas as pd

from . import connectors, events as ev, publish, reference, signals, timeseries as ts
from .core import (CADENCE_DAYS, CONFIG, DATA_OUT, STATE, Fetch, PipelineError, SchemaChange, iso, load_datasets,
                   load_diseases, load_registry, load_site, load_yaml, read_json, record_issue, utcnow, write_json)

CHECK_EVERY_DAYS = {"daily": 1, "weekly": 1, "monthly": 7, "yearly": 30}


def _save_fetches(name: str, fetches: list[Fetch]) -> None:
    write_json(STATE / "last_fetch" / f"{name}.json",
               [{**f.public(), "raw_path": f.raw_path} for f in fetches], compact=False)


def _load_fetches(name: str) -> list[Fetch] | None:
    recs = read_json(STATE / "last_fetch" / f"{name}.json")
    if not recs:
        return None
    return [Fetch(**r) for r in recs]


def _issue_for_failure(ds_id: str, source: dict, err: Exception, status: dict) -> None:
    last_good = status.get(ds_id, {}).get("last_good_snapshot") or "none yet"
    body = [f"**Failing source:** {source['name']} (`{source['id']}`), dataset `{ds_id}`",
            f"**Error:** {type(err).__name__}: {err}",
            f"**Last good snapshot:** {last_good}",
            "**Effect:** the last good data for this dataset stays live. Nothing was changed automatically.",
            "A person needs to review and fix this. The pipeline does not open pull requests."]
    if isinstance(err, SchemaChange):
        body.append("**Schema diff (expected vs found):**\n```diff\n" + err.diff() + "\n```")
    record_issue("source-failure", f"Source failure: {ds_id}", "\n\n".join(body), source_id=source["id"],
                 dedupe_key=f"source-failure-{ds_id}")


def run(offline: bool = False, now: dt.datetime | None = None) -> dict:
    now = now or utcnow()
    today = now.date()
    site = load_site()
    registry = load_registry()
    diseases_doc = load_diseases()
    datasets = load_datasets()
    ds_by_id = {d["id"]: d for d in datasets}
    status: dict = read_json(STATE / "dataset_status.json", {})
    snapshot_id = now.strftime("%Y%m%dT%H%M%SZ")
    log = lambda *a: print("[uo]", *a, file=sys.stderr, flush=True)  # noqa: E731

    # ---- reference data (places, population, boundaries, gazetteer)
    ref_fetches = None if not offline else {d["id"]: (_load_fetches(d["id"]) or [None])[0]
                                             for d in load_yaml(CONFIG / "datasets.yaml")["reference"]}
    if not ref_fetches or any(v is None for v in ref_fetches.values()):
        log("fetching reference data")
        ref_fetches = reference.fetch_reference(registry)
        for k, f in ref_fetches.items():
            _save_fetches(k, [f])
    rb = lambda k: open(ref_fetches[k].raw_path, "rb").read()  # noqa: E731
    countryinfo = reference.parse_countryinfo(rb("geonames_countryinfo"))
    population = reference.parse_worldbank_population(rb("worldbank_population"))
    boundaries = reference.parse_natural_earth(rb("ne_admin0_50m"))
    places = reference.build_places(countryinfo, population, boundaries)
    ref = reference.build_ref(places)
    gazetteer = reference.build_gazetteer(places, reference.parse_admin1(rb("geonames_admin1")),
                                          reference.parse_cities(rb("geonames_cities15000")))
    boundaries["features"] = [f for f in boundaries["features"] if f["id"] in places]

    # ---- time series: fetch, parse, validate; quarantine on failure
    frames, all_fetches, quarantined = [], {}, []
    for ds in datasets:
        dsid, source = ds["id"], registry[ds["source_id"]]
        st = status.setdefault(dsid, {})
        prev_path = STATE / "normalized" / f"{dsid}.parquet"
        prev = pd.read_parquet(prev_path) if prev_path.exists() else None
        try:
            due = True
            if st.get("last_checked") and not offline:
                age = (now - dt.datetime.fromisoformat(st["last_checked"].replace("Z", "+00:00"))).total_seconds() / 86400
                due = age >= CHECK_EVERY_DAYS[source["cadence"]] - 0.2
            fetches = _load_fetches(dsid) if (offline or not due) else None
            if fetches is None:
                log("fetching", dsid)
                fetches = connectors.fetch_dataset(ds, registry)
                _save_fetches(dsid, fetches)
                st["last_checked"] = iso(now)
            raw_hash = "+".join(f.raw_file_hash[:16] for f in fetches)
            if prev is not None and st.get("raw_hash") == raw_hash and st.get("parser_ok"):
                df = prev  # change detection: identical raw content, nothing to re-validate
            else:
                df = connectors.parse_dataset(ds, fetches, ref)
                problems = ts.validate_dataset(ds, df, prev, today)
                if problems:
                    raise PipelineError("validation failed: " + "; ".join(problems))
                prev_path.parent.mkdir(parents=True, exist_ok=True)
                df.to_parquet(prev_path, index=False)
                if st.get("raw_hash") != raw_hash:
                    st["last_changed"] = iso(now)
                st.update(raw_hash=raw_hash, parser_ok=True)
            st.update(last_success=iso(now), state="ok", error=None, fetch_ids=[f.fetch_id for f in fetches])
            for f in fetches:
                all_fetches[f.fetch_id] = f.public()
            frames.append(df)
            log(f"  {dsid}: {len(df)} records")
        except Exception as e:  # keep last good data, open an issue
            log(f"  {dsid}: FAILED {type(e).__name__}: {e}")
            if not isinstance(e, PipelineError):
                traceback.print_exc()
            _issue_for_failure(dsid, source, e, status)
            st.update(state="quarantined", error=f"{type(e).__name__}: {e}", last_failure=iso(now))
            quarantined.append(dsid)
            if prev is not None:
                frames.append(prev)
                for f in (_load_fetches(dsid) or []):
                    all_fetches.setdefault(f.fetch_id, f.public())

    if not frames:
        raise PipelineError("no dataset available (first run with every source failing)")
    df = pd.concat(frames, ignore_index=True)
    derived = [ts.derive_flu_all_systems(df), ts.derive_dengue_annual(df, today)]
    df = pd.concat([df] + [d for d in derived if not d.empty], ignore_index=True)
    df = ts.add_series_ids(df)

    # ---- revision history
    hist_path = STATE / "revisions.parquet"
    history = pd.read_parquet(hist_path) if hist_path.exists() else None
    q_prefixes = tuple(f"{ds_by_id[q]['disease']}.{q}." for q in quarantined)
    new_history, changes = ts.record_revisions(history, df, snapshot_id, q_prefixes)
    snapshots: list[dict] = read_json(STATE / "snapshots.json", [])

    # ---- events
    ev_out = build_events(registry, diseases_doc, places, gazetteer, offline, now, status, all_fetches, log)
    ev_changed = ev_out["changed"]

    is_new_snapshot = (len(changes) > 0) or ev_changed or not snapshots
    if is_new_snapshot:
        new_history.to_parquet(hist_path, index=False)
        snapshots.append({"id": snapshot_id, "created_at": iso(now), "n_value_changes": int(len(changes)),
                          "n_revised": int((changes["kind"] == "revised").sum()) if len(changes) else 0,
                          "n_new": int((changes["kind"] == "new").sum()) if len(changes) else 0,
                          "n_removed": int((changes["kind"] == "removed").sum()) if len(changes) else 0,
                          "events_changed": bool(ev_changed)})
        write_json(STATE / "snapshots.json", snapshots, compact=False)
        history = new_history
        for dsid, st in status.items():
            if st.get("state") == "ok":
                st["last_good_snapshot"] = snapshot_id
    else:
        snapshot_id = snapshots[-1]["id"]
        log("no changes since", snapshot_id)
    write_json(STATE / "dataset_status.json", status, compact=False)
    write_json(STATE / "event_ids.json", ev_out["id_map"], compact=False)
    write_json(STATE / "event_history.json", ev_out["history"], compact=False)

    ctx = publish.Context(site=site, registry=registry, diseases_doc=diseases_doc, datasets=ds_by_id, places=places,
                          boundaries=boundaries, df=df, history=history, snapshots=snapshots, snapshot_id=snapshot_id,
                          fetches=all_fetches, ref_fetches={k: f.public() for k, f in ref_fetches.items()},
                          status=status, events=ev_out["events"], event_history=ev_out["history"],
                          unmapped=ev_out["unmapped"], now=now, changes=changes if is_new_snapshot else changes.iloc[0:0])
    summary = publish.publish_all(ctx, log)
    log("done", json.dumps(summary))
    return summary


def build_events(registry, diseases_doc, places, gazetteer, offline, now, status, all_fetches, log) -> dict:
    today = now.date()
    reports: list[dict] = []
    failed = []
    cfg = load_yaml(CONFIG / "datasets.yaml")["events"]
    last_good: dict = read_json(STATE / "event_reports.json", {})
    for ds in cfg:
        dsid, source = ds["id"], registry[ds["source_id"]]
        st = status.setdefault(dsid, {})
        try:
            fetches = _load_fetches(dsid) if offline else None
            if fetches is None:
                log("fetching", dsid)
                fetches = ev.fetch_who_don(ds, registry) if ds["connector"] == "who_don" else ev.fetch_cdc_travel(ds, registry)
                _save_fetches(dsid, fetches)
                st["last_checked"] = iso(now)
            parse = ev.parse_who_don if ds["connector"] == "who_don" else ev.parse_cdc_travel
            reps = []
            for f in fetches:
                reps += parse(ds, open(f.raw_path, "rb").read(), f.fetch_id)
                all_fetches[f.fetch_id] = f.public()
            # feeds only list current notices: keep earlier ones from the last good run
            known = {r["report_id"]: r for r in last_good.get(dsid, [])}
            prev_n = len(known)
            for r in reps:
                known[r["report_id"]] = r
            merged = list(known.values())
            problems = ev.validate_events(merged, prev_n)
            if problems:
                raise PipelineError("validation failed: " + "; ".join(problems))
            raw_hash = "+".join(f.raw_file_hash[:16] for f in fetches)
            if st.get("raw_hash") != raw_hash:
                st["last_changed"] = iso(now)
            st.update(last_success=iso(now), state="ok", error=None, raw_hash=raw_hash, fetch_ids=[f.fetch_id for f in fetches])
            last_good[dsid] = merged
            reports += merged
            log(f"  {dsid}: {len(merged)} reports")
        except Exception as e:
            log(f"  {dsid}: FAILED {type(e).__name__}: {e}")
            if not isinstance(e, PipelineError):
                traceback.print_exc()
            _issue_for_failure(dsid, source, e, status)
            st.update(state="quarantined", error=f"{type(e).__name__}: {e}", last_failure=iso(now))
            failed.append(dsid)
            reports += last_good.get(dsid, [])
            for f in (_load_fetches(dsid) or []):
                all_fetches.setdefault(f.fetch_id, f.public())
    write_json(STATE / "event_reports.json", last_good)
    normalizer = ev.DiseaseNormalizer(diseases_doc)
    geocoder = ev.Geocoder(places, load_yaml(CONFIG / "country_aliases.yaml"), gazetteer)
    reports = [dict(r) for r in reports]
    reports, unmapped = ev.normalize_reports(reports, normalizer, geocoder)
    if unmapped:
        record_issue("unmapped-disease", "Unmapped disease names in event reports",
                     "These names from official notices are not in `config/diseases.yaml` and are shown under "
                     "\"Other / unclassified\". Please extend the mapping (never guessed automatically):\n\n"
                     + "\n".join(f"- {u}" for u in unmapped), dedupe_key="unmapped-diseases")
    id_map: dict = read_json(STATE / "event_ids.json", {})
    events = ev.group_events(reports, id_map, today)
    history: dict = read_json(STATE / "event_history.json", {})
    changed = False
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    for e in events:
        fp = ev.event_fingerprint(e)
        h = history.setdefault(e["event_id"], [])
        if not h or {k: v for k, v in h[-1].items() if k != "snapshot_id"} != fp:
            h.append({"snapshot_id": stamp, **fp})
            changed = True
    return {"events": events, "id_map": id_map, "history": history, "unmapped": unmapped, "changed": changed}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="re-use the last fetched raw files")
    ap.add_argument("--clean", action="store_true", help="remove published data before writing")
    a = ap.parse_args(argv)
    if a.clean and DATA_OUT.exists():
        shutil.rmtree(DATA_OUT)
    try:
        run(offline=a.offline)
    except PipelineError as e:
        record_issue("pipeline-failure", "Pipeline run failed", f"**Error:** {e}\n\nThe last good snapshot stays live.",
                     dedupe_key="pipeline-failure")
        print(f"[uo] pipeline failed: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
