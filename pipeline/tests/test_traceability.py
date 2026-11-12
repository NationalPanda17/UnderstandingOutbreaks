"""Source traceability tests over the published output. Any violation fails CI and blocks deployment.

Run after `python -m uo.build`. Skipped (with a clear reason) when no published data exists yet.
"""
import json
import re
from pathlib import Path

import pandas as pd
import pytest

from uo import core

D = core.DATA_OUT
pytestmark = pytest.mark.skipif(not (D / "manifest.json").exists(), reason="no published data: run `python -m uo.build` first")
ORIGINS = {"source-reported", "site-derived", "user-supplied", "simulated"}


def J(p):
    return json.loads((D / p).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def reg():
    return {s["id"]: s for s in J("sources.json")["sources"]}


@pytest.fixture(scope="module")
def diseases():
    return J("diseases.json")["diseases"]


def test_sources_endpoint_is_the_registry_without_test_data(reg):
    assert "test_data" not in reg and len(reg) >= 10
    for s in reg.values():
        for k in ("name", "publisher", "landing_url", "license", "license_url", "citation", "cadence"):
            assert s.get(k), f"{s['id']} missing {k}"
        assert isinstance(s["redistribute_raw"], bool)


def test_every_series_has_a_valid_source_origin_and_chain(reg, diseases):
    chains = J("chains.json")["chains"]
    keys = {s["skey"] for d in diseases for s in d["series"]}
    n = 0
    for d in diseases:
        for s in d["series"]:
            n += 1
            assert s["source_id"] in reg and s["origin_type"] in ORIGINS, s["skey"]
            assert s["deep_link"].startswith("https://") and s["link_kind"] in ("deep", "dataset-level link")
            assert s["chain_id"] in chains and all({"op", "method_version", "params"} <= set(st) for st in chains[s["chain_id"]])
            assert s["case_definition"] in core.CASE_DEFINITIONS and s["lag"]["incomplete_from"]
            if s["origin_type"] == "site-derived" and s["surveillance_system"] == "all_reported" or s["case_definition"] == "mixed":
                assert s["inputs"], f"derived series {s['skey']} lists no inputs"
            for inp in s["inputs"]:
                assert inp in keys, f"input {inp} of {s['skey']} does not resolve"
        if d["has_timeseries"]:
            assert d["default_skey"] in {s["skey"] for s in d["series"]}
    assert n > 20


def test_every_bulk_row_is_traceable(reg):
    fetch_hashes = {f["raw_file_hash"] for f in J("fetches.json")["fetches"].values()}
    manifest = J("manifest.json")
    for entry in manifest["bulk"]["timeseries"]:
        df = pd.read_parquet(D / entry["parquet"])
        assert len(df) == entry["rows"] > 0
        assert set(df["source_id"]) <= set(reg) and "test_data" not in set(df["source_id"])
        assert set(df["origin_type"]) <= ORIGINS
        assert df["source_url"].str.startswith("https://").all() and not df["source_url"].str.contains("{", regex=False).any()
        assert df["raw_file_hash"].str.fullmatch(r"[0-9a-f]{64}").all() and set(df["raw_file_hash"]) <= fetch_hashes
        assert df["raw_record_ref"].str.len().gt(0).all() and df["retrieved_at"].str.endswith("Z").all()
        assert (df["snapshot_id"] == manifest["snapshot_id"]).all() and df["license"].str.len().gt(0).all()
        assert df["record_id"].is_unique and (df["record_id"] == df["series_id"] + "@" + df["period_start"].astype(str)).all()
        assert df["transformations"].map(lambda s: isinstance(json.loads(s), list)).all()
        assert set(df["case_definition"]) <= set(core.CASE_DEFINITIONS)
        prov = json.loads((D / entry["parquet"]).with_name("provenance.json").read_text())
        assert {s["source_id"] for s in prov["sources"]} == set(df["source_id"]) and prov["suggested_citation"] and prov["snapshot_id"]
        # mixed-source files keep per-row source columns
        assert {"source_id", "source_url"} <= set(df.columns)


def test_lineage_endpoint_resolves_every_value_to_a_raw_record():
    fetches = J("fetches.json")["fetches"]
    checked = 0
    for disease in ("measles", "influenza", "mpox", "dengue"):
        files = sorted((D / "lineage" / disease).glob("*.json"))[:6]
        for f in files:
            lin = json.loads(f.read_text())
            ts = J(f"ts/{disease}/{f.name}")
            assert set(lin["series"]) == set(ts["series"])
            for skey, s in lin["series"].items():
                assert s["p"] == ts["series"][skey]["p"] and len(s["r"]) == len(s["p"]) and all(s["r"])
                assert all(fid in fetches for fid in s["f"])
                checked += len(s["p"])
    assert checked > 1000


def test_parquet_is_sorted_and_chunked_for_range_requests():
    import pyarrow.parquet as pq
    for entry in J("manifest.json")["bulk"]["timeseries"]:
        pf = pq.ParquetFile(D / entry["parquet"])
        assert pf.metadata.row_group(0).num_rows <= 20000
        df = pf.read(columns=["iso3", "period_start"]).to_pandas()
        assert df["iso3"].is_monotonic_increasing
        col = pf.metadata.row_group(0).column(pf.schema_arrow.get_field_index("iso3"))
        assert col.statistics is not None and col.statistics.has_min_max


def test_duckdb_can_query_the_bulk_files_with_filters():
    import duckdb
    p = D / "bulk" / "timeseries" / "disease=measles" / "data.parquet"
    n, srcs = duckdb.sql(f"SELECT count(*), count(DISTINCT source_id) FROM read_parquet('{p}') WHERE iso3 = 'KEN' AND is_default_series AND NOT likely_incomplete").fetchall()[0]
    assert n > 50 and srcs == 1


def test_events_flags_and_derived_views_carry_sources(reg):
    idx = J("events/index.json")
    assert idx["origin_type"] == "site-derived" and idx["methods"]["ranking"]["version"] and idx["events"]
    for e in idx["events"]:
        assert e["source_ids"] and set(e["source_ids"]) <= set(reg) and e["latest_url"].startswith("https://")
        assert e["status"] in ("reported", "ongoing", "declared_over", "no_recent_update")
        assert e["rank"]["method"] == "active_rank" and e["rank"]["method_version"]
        for l in e["locations"]:
            assert l["precision"] in ("country", "admin1", "admin2", "point")
        if e["status"] == "no_recent_update":
            assert e["status_basis"] == "recency-indicator"
        for k in ("cases", "deaths"):
            if e[k]:
                assert e[k]["quote"] and e[k]["report_id"] and e[k]["as_of"]
    full = J(f"events/{idx['events'][0]['event_id']}.json")
    for r in full["reports"]:
        assert r["source_id"] in reg and r["url"].startswith("https://") and r["raw_record_ref"] and r["origin_type"] == "source-reported"
    for l in full["locations"]:
        assert l["method"] and l["method_version"] and l["source_ids"]
    for disease in ("measles", "influenza", "covid19", "mpox"):
        fl = J(f"flags/{disease}.json")
        assert fl["origin_type"] == "site-derived" and fl["method"]["version"] and fl["params"]["k"]
        for f in fl["flags"][:200]:
            assert f["method_version"] and set(f["source_ids"]) <= set(reg) and f["baseline_periods"] and f["series_id"].endswith(f["iso3"])
    for name in ("overview/measles.json", "quality.json", "weekly/latest.json", "revisions/index.json", "changelog.json", "places.json", "reconcile/mpox.json"):
        doc = J(name)
        assert doc.get("origin_type") in ORIGINS and set(doc["source_ids"]) <= set(reg), name


def test_no_text_or_wording_implies_alerts_or_severity():
    banned = re.compile(r"\b(alert|warning|surge|outbreak detected|severe|dangerous)\b", re.I)
    for name in ("flags/recent.json", "weekly/latest.json"):
        doc = J(name)
        text = json.dumps({k: v for k, v in doc.items() if k not in ("new_events", "updated_events")})
        text = re.sub(r'"(latest_title|name_in_source|latest_url|quote)": "[^"]*"', "", text)
        assert not banned.search(text), f"{name}: {banned.search(text).group(0)}"


def test_snapshot_manifest_lists_every_raw_file_with_hashes(reg):
    m = J("manifest.json")
    assert [s["id"] for s in m["snapshots"]] == sorted(s["id"] for s in m["snapshots"])
    snap = J(f"snapshots/{m['snapshot_id']}.json")
    assert snap["immutable"] and snap["raw_files"] and snap["data_files"]
    for f in snap["raw_files"]:
        assert re.fullmatch(r"[0-9a-f]{64}", f["raw_file_hash"]) and f["source_id"] in reg and f["url"].startswith("https://") and f["retrieved_at"]
        if f["archive_public"]:
            assert reg[f["source_id"]]["redistribute_raw"] and (core.R2_OUT / f["archive_key"]).exists()
        else:
            assert f["archive_key"] is None
    for f in snap["data_files"]:
        assert re.fullmatch(r"[0-9a-f]{64}", f["sha256"])


def test_catalog_metadata_uses_placeholders_not_invented_identities():
    site = core.load_site()
    for name in ("catalog/dcat.jsonld", "catalog/datapackage.json", "catalog/dataset.jsonld"):
        text = (D / name).read_text()
        assert site["identity"]["creator"] in text
        assert "orcid.org" not in text.lower()
    assert site["identity"]["creator"] == "Understanding Outbreaks contributors" and site["identity"]["orcid"] == ""


def test_production_build_rejects_test_data(monkeypatch):
    from uo import publish
    df = pd.DataFrame({"origin_type": ["test-data"], "dataset_id": ["x"]})
    ctx = type("C", (), {"df": df, "datasets": {"x": {"source_id": "test_data"}}, "events": []})()
    monkeypatch.delenv("UO_ALLOW_TEST_DATA", raising=False)
    with pytest.raises(core.PipelineError, match="TEST DATA"):
        publish.assert_no_test_data(ctx)


def test_workflows_only_open_issues_never_pull_requests():
    wf = core.ROOT / ".github" / "workflows"
    files = list(wf.glob("*.yml"))
    if not files:
        pytest.skip("workflows not written yet")
    for f in files:
        text = f.read_text()
        assert not re.search(r"gh pr (create|merge)|create-pull-request|pull-requests:\s*write|auto-merge|automerge", text), f.name


# ---------------------------------------------------------------- published-data guards (the build fails on these)

def test_published_percent_positive_is_never_above_100_and_rests_on_paired_samples():
    o = J("overview/influenza.json")
    for iso3, r in o["latest"].items():
        if r.get("metric_value") is not None:
            assert 0 <= r["metric_value"] <= 100, (iso3, r["metric_value"])
            assert r["detections_paired"] <= r["specimens"] and r["specimens"] >= 50, iso3
    for iso3, row in o["grid"]["values"].items():
        assert all(v is None or 0 <= v <= 100 for v in row), iso3
    for f in J("flags/influenza.json")["flags"]:
        assert f["detections"] <= f["specimens"] and 0 <= f["value"] <= 100, (f["iso3"], f["period"])


def test_published_events_have_no_oversized_groups_or_overlapping_open_events():
    import itertools
    from uo import events as E
    idx = J("events/index.json")["events"]
    cap = E.MAX_NOTICE_COUNTRIES
    for e in idx:
        ev = J(f"events/{e['event_id']}.json")
        named = max((len(r["countries"]) for r in ev["reports"] if not r.get("broad")), default=0)
        assert named <= cap, (e["event_id"], named)
        assert len(e["countries"]) <= 3 * cap, (e["event_id"], len(e["countries"]))
    gap = E.GROUP_METHOD["max_gap_days"]
    live = [e for e in idx if e["status"] != "declared_over" and e["days_since_last_report"] <= gap and e["disease"] != "other"]
    clash = [(a["event_id"], b["event_id"]) for a, b in itertools.combinations(live, 2)
             if a["disease"] == b["disease"] and set(a["countries"]) & set(b["countries"])]
    assert not clash, f"two open events for the same disease and country: {clash[:5]}"
