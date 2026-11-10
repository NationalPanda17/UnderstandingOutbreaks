"""Pipeline unit tests. All inputs here are TEST DATA (fixtures built in the test), never published."""
import datetime as dt
import io
import json
import shutil
import zipfile

import numpy as np
import pandas as pd
import pytest

from uo import connectors as C, core, events as E, signals as S, timeseries as T
from uo.core import PipelineError, SchemaChange

REF = {"iso2_to_iso3": {"KE": "KEN", "BI": "BDI", "FR": "FRA"}, "iso3_set": {"KEN", "BDI", "FRA", "COD", "BTN", "AFG"}}
DS = lambda **k: {"id": "test_ds", "source_id": "test_data", "disease": "testdisease", **k}  # noqa: E731


# ----------------------------------------------------------------------------- registry

def test_registry_loads_and_every_dataset_references_it():
    reg = core.load_registry()
    assert "who_flunet" in reg and reg["test_data"]["kind"] == "test"
    for ds in core.load_datasets():
        assert ds["source_id"] in reg and ds["deep_link"].startswith("https://")
    cfg = core.load_yaml(core.CONFIG / "datasets.yaml")
    for group in ("reference", "events"):
        for ds in cfg[group]:
            assert ds["source_id"] in reg


@pytest.mark.parametrize("bad", [{"id": "Bad Id"}, {"license": ""}, {"cadence": "hourly"}, {"landing_url": "ftp://x"}])
def test_registry_rejects_malformed_entries(tmp_path, bad):
    ok = {"id": "x", "name": "X", "short_name": "X", "publisher": "P", "landing_url": "https://x.example", "license": "L", "license_url": "https://x.example/l",
          "citation": "c", "cadence": "weekly", "redistribute_raw": False, "kind": "timeseries"}
    p = tmp_path / "s.yaml"
    p.write_text(json.dumps({"sources": [{**ok, **bad}]}))
    with pytest.raises(PipelineError):
        core.load_registry(p)


def test_duplicate_source_ids_are_rejected(tmp_path):
    ok = {"id": "x", "name": "X", "short_name": "X", "publisher": "P", "landing_url": "https://x.example", "license": "L", "license_url": "https://x.example/l",
          "citation": "c", "cadence": "weekly", "redistribute_raw": False, "kind": "timeseries"}
    p = tmp_path / "s.yaml"
    p.write_text(json.dumps({"sources": [ok, ok]}))
    with pytest.raises(PipelineError):
        core.load_registry(p)


# ----------------------------------------------------------------------------- connectors (recorded-shape responses)

def test_flunet_parses_collapses_identical_duplicates_and_keeps_systems_apart():
    row = {"COUNTRY_CODE": "BTN", "ISO_WEEKSTARTDATE": "2025-03-24", "ORIGIN_SOURCE": "SENTINEL", "SPEC_PROCESSED_NB": 117, "INF_A": 4, "INF_B": 23, "INF_ALL": 27}
    doc = {"value": [row, dict(row), {**row, "ORIGIN_SOURCE": "NONSENTINEL", "INF_ALL": 3, "SPEC_PROCESSED_NB": None}]}
    df = C.parse_flunet(DS(), json.dumps(doc).encode(), "f1", REF)
    assert len(df) == 3 and set(df["surveillance_system"]) == {"sentinel", "non_sentinel"}
    assert df[df.metric == "detections"]["case_definition"].eq("confirmed").all()
    assert (df["origin_type"] == "source-reported").all() and df["raw_record_ref"].str.contains("ORIGIN_SOURCE=").all()


def test_flunet_schema_change_is_a_hard_failure_with_a_diff():
    with pytest.raises(SchemaChange) as e:
        C.parse_flunet(DS(), json.dumps({"value": [{"COUNTRY": "BTN"}]}).encode(), "f1", REF)
    assert "- INF_ALL" in e.value.diff() and "+ COUNTRY" in e.value.diff()
    with pytest.raises(SchemaChange):
        C.parse_flunet(DS(), b'{"items": []}', "f1", REF)


def test_who_covid_maps_iso2_shifts_week_and_keeps_negative_corrections():
    csv = "﻿Date_reported,Country_code,Country,WHO_region,New_cases,Cumulative_cases,New_deaths,Cumulative_deaths\n2023-07-16,BI,Burundi,AFRO,-105,54216,,15\n2023-07-16,OT,Other,OTHER,5,5,0,0\n2023-07-16,KE,Kenya,AFRO,10,10,1,1\n"
    df = C.parse_who_covid(DS(), csv.encode(), "f1", REF)
    assert set(df.iso3) == {"BDI", "KEN"} and (df.period == "2023-07-10").all()  # week ending Sunday 16th starts Monday 10th
    assert df[(df.iso3 == "BDI") & (df.metric == "cases")]["value"].iloc[0] == -105
    assert len(df[df.iso3 == "BDI"]) == 1  # blank deaths are missing, not zero


def test_who_mpox_sums_days_into_iso_weeks_and_drops_undated_and_partial_weeks():
    rows = [{"ISO3": "COD", "DATE": f"2026-09-{d:02d}", "NEW_CONF_CASES": 1, "NEW_PROB_CASES": 0, "NEW_CONF_DEATHS": 0} for d in range(14, 24)]
    rows.append({"ISO3": "COD", "DATE": None, "NEW_CONF_CASES": 3989, "NEW_PROB_CASES": 0, "NEW_CONF_DEATHS": 0})
    df = C.parse_who_mpox(DS(derived=True), json.dumps({"value": rows}).encode(), "f1", REF)
    cases = df[(df.metric == "cases") & (df.case_definition == "confirmed")]
    assert cases["period"].tolist() == ["2026-09-14"] and cases["value"].tolist() == [7.0]  # week of the 21st is incomplete
    assert (df["origin_type"] == "site-derived").all()


def test_who_measles_reads_the_spreadsheet_and_keeps_definitions_separate():
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "WEB"
    ws.append(["Region", "Country", "ISO3", "Year", "Month", "Measles \nsuspect", "Measles \nclinical", "Measles \nepi-linked", "Measles \nlab-confirmed", "Measles \ntotal"])
    ws.append(["AFR", "Kenya", "KEN", "2026", "08", "20", "5", "0", "6", 11])
    buf = io.BytesIO()
    wb.save(buf)
    df = C.parse_who_measles(DS(), buf.getvalue(), "f1", REF)
    assert dict(zip(df.case_definition, df.value)) == {"suspected": 20.0, "confirmed": 6.0, "notified": 11.0}
    assert (df.period == "2026-08-01").all() and (df.period_type == "M").all()
    wb2 = openpyxl.Workbook()
    b2 = io.BytesIO()
    wb2.save(b2)
    with pytest.raises(SchemaChange):
        C.parse_who_measles(DS(), b2.getvalue(), "f1", REF)


def test_wiise_gho_and_owid_parsers():
    w = {"value": [{"CODE": "KEN", "YEAR": 2025, "DISEASE": "POLIO", "CASES": 0}, {"CODE": "KEN", "YEAR": 2024, "DISEASE": "POLIO", "CASES": None}]}
    assert len(C.parse_who_wiise(DS(wiise_disease="POLIO"), json.dumps(w).encode(), "f", REF)) == 1
    g = {"value": [{"IndicatorCode": "CHOLERA_0000000001", "SpatialDimType": "COUNTRY", "SpatialDim": "KEN", "TimeDim": 1984, "NumericValue": None, "Value": "521"}]}
    assert C.parse_who_gho(DS(), json.dumps(g).encode(), "f", REF)["value"].iloc[0] == 521
    o = "entity,code,year,x\nKenya,KEN,2020,7\nWorld,OWID_WRL,2020,99\nAfrica,,2020,5\n"
    df = C.parse_owid_grapher(DS(value_column="x"), o.encode(), "f", REF)
    assert df["iso3"].tolist() == ["KEN"]
    with pytest.raises(SchemaChange):
        C.parse_owid_grapher(DS(value_column="missing"), o.encode(), "f", REF)


def test_opendengue_never_merges_definitions():
    csv = ('"adm_0_name","ISO_A0","calendar_start_date","calendar_end_date","Year","dengue_total","case_definition_standardised","S_res","T_res","UUID"\n'
           '"AFG","AFG","2021-09-12","2021-09-18",2021,18,"Suspected","Admin0","Week","u1"\n'
           '"AFG","AFG","2021-01-01","2021-12-31",2021,300,"Suspected and confirmed","Admin0","Year","u2"\n'
           '"AFG","AFG","2021-01-01","2021-12-31",2021,40,"Confirmed","Admin1","Year","u3"\n')
    z = io.BytesIO()
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("x.csv", csv)
    df = C.parse_opendengue(DS(), z.getvalue(), "f", REF)
    assert set(df.case_definition) == {"suspected", "notified"} and len(df) == 2  # Admin1 row excluded
    assert df[df.period_type == "W"]["period"].iloc[0] == "2021-09-13"  # Sunday-start week aligned to Monday
    assert C.opendengue_definition("") == ("unknown", "not stated")


# ----------------------------------------------------------------------------- validation gates

def _frame(values, start="2026-01-05", iso3="KEN"):
    periods = [(dt.date.fromisoformat(start) + dt.timedelta(days=7 * i)).isoformat() for i in range(len(values))]
    return pd.DataFrame({"disease": "d", "iso3": iso3, "period": periods, "period_type": "W", "metric": "cases", "value": [float(v) for v in values],
                         "case_definition": "confirmed", "case_definition_detail": "x", "surveillance_system": "s", "dataset_id": "ds", "fetch_id": "f", "raw_record_ref": "r", "origin_type": "source-reported"})


def test_validation_gates():
    today = dt.date(2026, 6, 1)
    ok = _frame([5, 6, 7])
    assert T.validate_dataset({"expected_min_rows": 1}, ok, None, today) == []
    assert any("negative" in p for p in T.validate_dataset({}, _frame([5, -1]), None, today))
    assert T.validate_dataset({"allow_negative": True}, _frame([5, -1]), None, today) == []
    assert any("future" in p for p in T.validate_dataset({}, _frame([1], start="2027-01-04"), None, today))
    assert any("below expected minimum" in p for p in T.validate_dataset({"expected_min_rows": 10}, ok, None, today))
    assert any("unknown case_definition" in p for p in T.validate_dataset({}, ok.assign(case_definition="likely"), None, today))
    assert any("duplicate" in p for p in T.validate_dataset({}, pd.concat([ok, ok]), None, today))
    prev = pd.concat([_frame([100] * 30, iso3=f"A{i:02d}") for i in range(10)])
    assert any("20% drop" in p for p in T.validate_dataset({}, prev.iloc[:100], prev, today))
    zeros = prev.assign(value=0.0)
    assert any("dropped to zero" in p for p in T.validate_dataset({}, zeros, prev, today))


# ----------------------------------------------------------------------------- revisions

def _cur(d):
    return pd.DataFrame([{"series_id": s, "period": p, "value": v} for (s, p), v in d.items()])


def test_revisions_store_only_changes_and_reconstruct_any_snapshot():
    a = {("s1", "2026-01-05"): 10.0, ("s1", "2026-01-12"): 20.0}
    h, ch = T.record_revisions(None, _cur(a), "S1")
    assert len(h) == 2 and (ch["kind"] == "new").all()
    b = {("s1", "2026-01-05"): 10.0, ("s1", "2026-01-12"): 25.0, ("s1", "2026-01-19"): 5.0}
    h, ch = T.record_revisions(h, _cur(b), "S2")
    assert sorted(ch["kind"]) == ["new", "revised"] and len(h) == 4  # the unchanged value is not stored again
    c = {("s1", "2026-01-12"): 25.0, ("s1", "2026-01-19"): 5.0}  # first week removed by the source
    h, ch = T.record_revisions(h, _cur(c), "S3")
    assert ch["kind"].tolist() == ["removed"]
    as1 = T.as_of(h, "S1").set_index("period")["value"].to_dict()
    assert as1 == {"2026-01-05": 10.0, "2026-01-12": 20.0}
    assert T.as_of(h, "S2").set_index("period")["value"].to_dict() == {"2026-01-05": 10.0, "2026-01-12": 25.0, "2026-01-19": 5.0}
    assert "2026-01-05" not in T.as_of(h, None)["period"].tolist()  # a removal is not resurrected
    d = T.snapshot_diff(h, "S1", "S3").set_index("period")
    assert d.loc["2026-01-12", "change"] == 5 and d.loc["2026-01-19", "kind"] == "new" and d.loc["2026-01-05", "kind"] == "removed"
    h2, ch2 = T.record_revisions(h, _cur(c), "S4")
    assert len(ch2) == 0 and len(h2) == len(h)


def test_quarantined_datasets_are_not_recorded_as_removed():
    h, _ = T.record_revisions(None, _cur({("d.bad.x.KEN", "2026-01-05"): 1.0, ("d.good.x.KEN", "2026-01-05"): 2.0}), "S1")
    h, ch = T.record_revisions(h, _cur({("d.good.x.KEN", "2026-01-05"): 2.0}), "S2", ("d.bad.",))
    assert len(ch) == 0


# ----------------------------------------------------------------------------- reporting lag

def test_lag_uses_default_until_enough_history_then_estimates():
    assert S.estimate_lag(None, "W", 2, {})["basis"] == "configured-default"
    rows, snaps = [], {}
    base = dt.date(2026, 1, 5)
    for k in range(6):
        sid = f"S{k}"
        snaps[sid] = (base + dt.timedelta(days=7 * (k + 10))).isoformat()
        for i in range(40):  # 40 series; each period is revised upward in the three snapshots after it first appears
            for age in range(0, 4):
                wk = k + 10 - age
                rows.append({"series_id": f"s{i}", "period": (base + dt.timedelta(days=7 * wk)).isoformat(), "snapshot_id": sid, "value": 100.0 * (1 + 0.2 * age)})
    h = pd.DataFrame(rows)
    est = S.estimate_lag(h, "W", 1, snaps)
    assert est["basis"] == "estimated-from-revisions" and est["lag_periods"] == 3 and est["n_snapshots"] == 6
    assert S.incomplete_from("2026-03-02", "W", 2) == "2026-02-16"


# ----------------------------------------------------------------------------- signal flags

def _weeks(n, start="2025-03-03"):
    return [(dt.date.fromisoformat(start) + dt.timedelta(days=7 * i)).isoformat() for i in range(n)]


def test_flag_fires_on_a_clear_rise_and_carries_its_working():
    p = _weeks(30)
    v = [50, 52, 48, 51, 49, 50, 53, 47, 50, 52, 49, 51, 50, 48, 52, 50, 51, 49, 50, 52, 48, 51, 50, 49, 180, 60, 50, 51, 49, 50]
    out = S.compute_flags(p, v, "W", "2099-01-01", False)
    flagged = [f for f in out if f["status"] == "flagged"]
    assert [f["period"] for f in flagged] == [p[24]]
    f = flagged[0]
    assert f["method"] == "rolling_baseline_c2" and f["method_version"] == "1" and f["threshold"] < 180 and f["baseline_points"] == 7
    assert f["baseline_periods"] == [p[15], p[21]]


def test_flags_never_fire_in_incomplete_periods_or_on_low_counts():
    p = _weeks(30)
    v = [50] * 24 + [180] + [50] * 5
    assert not [f for f in S.compute_flags(p, v, "W", p[24], False) if f["status"] == "flagged"]
    low = [1, 0, 2, 1, 0, 1, 2, 0, 1, 1, 0, 2, 1, 0, 1, 1, 2, 0, 1, 1, 0, 1, 2, 1, 9, 1, 0, 1, 1, 0]
    assert S.compute_flags(p, low, "W", "2099-01-01", False) == []


def test_known_false_positive_patterns_are_suppressed():
    # batch reporting: weeks of nothing, then a backlog reported at once
    p = _weeks(30)
    batch = [40, 42, 39, 41, 40, 38, 42, 41, 40, 39, 41, 40, 42, 38, 40, 41, 39, 40, 42, 41, 40, 39, 41, 0, 160, 40, 41, 39, 40, 42]
    st = {f["period"]: f["status"] for f in S.compute_flags(p, batch, "W", "2099-01-01", False)}
    assert st[p[24]] == "suppressed-possible-batch-reporting"
    gap = list(batch)
    gap[23] = float("nan")
    st = {f["period"]: f["status"] for f in S.compute_flags(p, gap, "W", "2099-01-01", False)}
    assert st[p[24]] == "suppressed-possible-batch-reporting"
    # holiday effect: a rebound in the first ISO week of the year
    hp = _weeks(30, start="2025-07-07")
    idx = next(i for i, x in enumerate(hp) if dt.date.fromisoformat(x).isocalendar()[1] == 1)
    hv = [50.0] * 30
    hv[idx] = 190
    st = {f["period"]: f["status"] for f in S.compute_flags(hp, hv, "W", "2099-01-01", False)}
    assert st[hp[idx]] == "suppressed-holiday-period"


def test_seasonal_diseases_need_to_exceed_the_usual_seasonal_range():
    p = _weeks(52 * 4)
    season = lambda i: 20 + 400 * max(0.0, np.cos(2 * np.pi * ((i % 52) - 40) / 52)) ** 4  # noqa: E731
    v = [season(i) for i in range(len(p))]
    out = S.compute_flags(p, v, "W", "2099-01-01", True)
    assert out and all(f["status"] != "flagged" for f in out)  # the yearly rise is within the usual range
    assert any(f["status"] == "suppressed-within-seasonal-range" for f in out)
    assert any(f["status"] == "flagged" for f in S.compute_flags(p, v, "W", "2099-01-01", False))  # the same series, treated as non-seasonal
    short = S.compute_flags(p[:60], v[:60], "W", "2099-01-01", True)
    assert all(f["status"] in ("suppressed-seasonal-baseline-unavailable", "suppressed-holiday-period", "suppressed-possible-batch-reporting") for f in short)


def test_trend_summary_ignores_incomplete_periods():
    p = _weeks(6)
    t = S.trend_summary(p, [100, 110, 120, 130, 40, 10], "W", p[4])
    assert t["latest_complete"] == p[3] and t["change_pct"] == pytest.approx(8.3, abs=0.1)
    assert S.trend_summary(p, [1, 2, 3, 4, 5, 6], "W", p[0]) == {"latest_complete": None}


# ----------------------------------------------------------------------------- derived series and reconciliation

def test_flu_all_systems_is_site_derived_and_lists_inputs():
    doc = {"value": [{"COUNTRY_CODE": "KEN", "ISO_WEEKSTARTDATE": "2026-01-05", "ORIGIN_SOURCE": s, "SPEC_PROCESSED_NB": 10, "INF_ALL": n} for s, n in (("SENTINEL", 4), ("NONSENTINEL", 6))]}
    df = C.parse_flunet({"id": "who_flunet_weekly", "source_id": "who_flunet", "disease": "influenza"}, json.dumps(doc).encode(), "f", REF)
    d = T.derive_flu_all_systems(df)
    det = d[d.metric == "detections"].iloc[0]
    assert det["value"] == 10 and det["origin_type"] == "site-derived" and det["surveillance_system"] == "all_reported"
    assert "SENTINEL" in det["raw_record_ref"] and "NONSENTINEL" in det["raw_record_ref"]
    ids = T.add_series_ids(pd.concat([df, d]))
    assert ids["series_id"].nunique() == 6 and ids["series_id"].str.endswith(".KEN").all()


def test_series_keys_differ_for_different_definitions():
    a = T.series_key("d", "ds", "cases", "notified", "Total", "s", "Y")
    b = T.series_key("d", "ds", "cases", "notified", "Suspected and confirmed", "s", "Y")
    assert a != b


def test_reconcile_flags_disagreement_and_never_merges():
    def rows(ds, vals):
        f = _frame(vals).assign(dataset_id=ds, disease="mpox")
        return f
    df = T.add_series_ids(pd.concat([rows("a", [100, 200, 50]), rows("b", [100, 260, 52])]))
    r = T.reconcile(df).sort_values("period")
    assert r["disagree"].tolist() == [False, True, False]
    assert r.iloc[1]["values"] in ("200,260", "260,200") and r.iloc[1]["sources"] == "a,b"
    other_def = T.add_series_ids(pd.concat([rows("a", [100]), rows("b", [100]).assign(case_definition="suspected")]))
    assert T.reconcile(other_def).empty  # different definitions are never compared


# ----------------------------------------------------------------------------- events: normalization, geocoding, grouping, status

@pytest.fixture(scope="module")
def norm():
    return E.DiseaseNormalizer(core.load_diseases())


@pytest.mark.parametrize("title,expected", [
    ("Ebola disease caused by Bundibugyo virus - Democratic Republic of the Congo", "ebola"), ("Sudan virus disease - Uganda", "ebola"),
    ("Marburg virus disease - Rwanda", "marburg"), ("Nipah virus infection - India", "nipah"),
    ("Middle East respiratory syndrome coronavirus (MERS-CoV) - Saudi Arabia", "mers"), ("Lassa fever - Nigeria", "lassa"),
    ("Avian Influenza A(H5N1) - Cambodia", "avian_influenza"), ("Human infection with avian influenza A(H7N9) virus - China", "avian_influenza"),
    ("Influenza A(H1N1) variant virus - Brazil", "avian_influenza"), ("Chikungunya - La Réunion and Mayotte", "chikungunya"),
    ("Zika virus disease - India", "zika"), ("Yellow fever - African Region (AFRO)", "yellow_fever"),
    ("Meningococcal disease - Kingdom of Saudi Arabia", "meningitis"), ("Diphtheria - Nigeria", "diphtheria"),
    ("Circulating vaccine-derived poliovirus type 2 (cVDPV2) - Indonesia", "polio"), ("Mpox - Democratic Republic of the Congo", "mpox"),
    ("Cholera - Angola", "cholera"), ("Dengue - Global situation", "dengue"), ("Measles - Morocco", "measles"), ("Seasonal influenza - Global", "influenza"),
    ("Level 2 - Yellow Fever in Colombia", "yellow_fever"),
])
def test_disease_normalization_table(norm, title, expected):
    assert norm.normalize(E.title_parts(title)[0])[0] == expected


@pytest.mark.parametrize("title", ["Undiagnosed disease - Democratic Republic of the Congo", "Hurricane - Jamaica", "Cluster of community deaths - Somewhere", "Acute fever and rash syndrome - X"])
def test_unmapped_diseases_are_never_guessed(norm, title):
    assert norm.normalize(E.title_parts(title)[0]) == (None, None)


PLACES = {k: {"iso3": k, "iso2": k[:2], "name": n, "centroid": c} for k, n, c in [
    ("GIN", "Guinea", [-10.9, 10.4]), ("GNB", "Guinea-Bissau", [-15.0, 12.0]), ("NER", "Niger", [9.4, 17.4]), ("NGA", "Nigeria", [8.0, 9.6]),
    ("COD", "DR Congo", [23.6, -2.9]), ("COG", "Congo Republic", [15.2, -0.8]), ("KEN", "Kenya", [37.8, 0.6]), ("TUV", "Tuvalu", None)]}
ALIASES = {"aliases": {"COD": ["Democratic Republic of the Congo"], "COG": ["Republic of the Congo", "Congo"]}}
GAZ = {"admin1": {"COD": [{"name": "Équateur", "ascii": "Equateur", "code": "CD.02", "geonameid": "1", "lon": 18.3, "lat": 0.05, "n_cities": 3}]},
       "cities": {"KEN": [{"name": "Nairobi", "ascii": "Nairobi", "geonameid": "2", "lon": 36.8, "lat": -1.3, "population": 4000000}]}}


def test_country_matching_prefers_the_longest_name():
    g = E.Geocoder(PLACES, ALIASES, GAZ)
    assert g.countries("Guinea-Bissau and Niger") == ["GNB", "NER"]
    assert g.countries("Nigeria") == ["NGA"]
    assert g.countries("Democratic Republic of the Congo, Kenya and Nigeria") == ["COD", "KEN", "NGA"]
    assert g.countries("Republic of the Congo") == ["COG"]
    assert g.countries("Global situation") == []


def test_geocoding_precision_is_explicit_and_conservative():
    g = E.Geocoder(PLACES, ALIASES, GAZ)
    only_country = g.locate(["COD"], "Cases were reported in Equateur last week.")  # no administrative keyword: stays at country level
    assert [l["precision"] for l in only_country] == ["country"] and only_country[0]["lon"] == 23.6
    with_admin = g.locate(["COD"], "Cases were reported in Equateur Province.")
    assert [l["precision"] for l in with_admin] == ["country", "admin1"] and with_admin[1]["gazetteer_ref"] == "geonames:1"
    assert "population-weighted" in with_admin[1]["note"]
    city = g.locate(["KEN"], "An imported case was confirmed in the city of Nairobi.")
    assert [l["precision"] for l in city] == ["country", "point"] and "not a case location" in city[1]["note"]
    assert [l["precision"] for l in g.locate(["KEN"], "An imported case was confirmed in Nairobi.")] == ["country"]
    no_centroid = g.locate(["TUV"], "")
    assert no_centroid[0]["precision"] == "country" and no_centroid[0]["lon"] is None
    for l in with_admin + city:
        assert l["method"] == "gazetteer_match" and l["method_version"] == "1" and l["source_ids"]


def test_counts_are_taken_only_from_the_text_with_the_exact_quote():
    c = E.extract_counts("As of 3 November, a total of 10 668 confirmed cases, including 5 198 deaths, have been reported.")
    assert c["cases"]["value"] == 10668 and c["cases"]["case_definition"] == "confirmed" and "10 668 confirmed cases" in c["cases"]["quote"]
    assert c["deaths"]["value"] == 5198 and len(c["cases"]["quote"].split()) <= 14
    assert E.extract_counts("Several cases were reported; one death occurred.") == {}
    assert E.extract_counts("46 suspected and confirmed cases")["cases"]["case_definition"] == "notified"
    assert E.extract_counts("1,234 cases")["cases"] == {**E.extract_counts("1,234 cases")["cases"], "value": 1234, "case_definition": "unknown"}


def test_status_words_are_used_only_when_the_source_says_so():
    assert E.status_from_text("The Ministry of Health declared the end of the outbreak on 1 May.")[0] == "declared_over"
    assert E.status_from_text("The outbreak is ongoing in three provinces.")[0] == "ongoing"
    assert E.status_from_text("Twelve cases were reported in the capital.") == ("reported", None)


def _rep(rid, disease, countries, day, text="", src="who_don", w=1.0):
    return {"report_id": rid, "source_id": src, "dataset_id": "x", "title": f"{disease} - {countries}", "url": f"https://example.org/{rid}", "published": day, "last_modified": day,
            "text": text, "fetch_id": "f", "raw_record_ref": rid, "countries_hint": None, "source_weight": w}


def _events(reports, ids=None, today=dt.date(2026, 11, 9)):
    g = E.Geocoder(PLACES, ALIASES, GAZ)
    reps, unmapped = E.normalize_reports([dict(r) for r in reports], E.DiseaseNormalizer(core.load_diseases()), g)
    return E.group_events(reps, ids if ids is not None else {}, today), unmapped


def test_reports_of_one_event_are_grouped_and_ids_stay_stable():
    reps = [_rep("a", "Cholera", "Kenya", "2026-08-01"), _rep("b", "Cholera", "Kenya", "2026-09-10"), _rep("c", "Cholera", "Kenya", "2025-01-10"), _rep("d", "Cholera", "Nigeria", "2026-09-01"), _rep("e", "Measles", "Kenya", "2026-09-01")]
    ids: dict = {}
    ev, _ = _events(reps, ids)
    by = {e["event_id"]: e for e in ev}
    assert len(ev) == 4  # the 2025 notice is too old to belong to the 2026 event; other country and other disease are separate
    grouped = next(e for e in ev if len(e["reports"]) == 2)
    assert [r["report_id"] for r in grouped["reports"]] == ["a", "b"] and grouped["first_report"] == "2026-08-01"
    ev2, _ = _events(reps + [_rep("f", "Cholera", "Kenya", "2026-10-20")], ids)
    assert grouped["event_id"] in {e["event_id"] for e in ev2} and set(by) <= {e["event_id"] for e in ev2}
    assert len(next(e for e in ev2 if e["event_id"] == grouped["event_id"])["reports"]) == 3


def test_a_notice_naming_two_open_groups_merges_them():
    reps = [_rep("a", "Ebola disease", "Democratic Republic of the Congo", "2026-08-15"), _rep("b", "Ebola disease", "Kenya", "2026-10-19", src="cdc_travel", w=0.6),
            _rep("c", "Ebola disease", "Democratic Republic of the Congo, Kenya and Nigeria", "2026-11-06")]
    ev, _ = _events(reps)
    assert len(ev) == 1 and ev[0]["countries"] == ["COD", "KEN", "NGA"] and ev[0]["source_ids"] == ["cdc_travel", "who_don"]


def test_event_status_recency_indicator_and_unmapped_handling():
    ev, unmapped = _events([_rep("a", "Cholera", "Kenya", "2026-01-10", "The outbreak is ongoing."), _rep("b", "Mystery illness", "Kenya", "2026-11-01"),
                            _rep("c", "Marburg virus disease", "Kenya", "2026-02-01", "Authorities declared the end of the outbreak.")])
    by = {e["disease"]: e for e in ev}
    assert by["cholera"]["status"] == "no_recent_update" and by["cholera"]["status_basis"] == "recency-indicator" and by["cholera"]["status_quote"] is None
    assert by["marburg"]["status"] == "declared_over" and by["marburg"]["status_basis"] == "source-stated"
    assert by["other"]["status"] == "reported" and "disease-unmapped" in by["other"]["quality_flags"] and unmapped == ["Mystery illness"]
    assert not by["marburg"]["rank"]["active"] and by["other"]["rank"]["active"]


def test_rank_formula_is_the_documented_weighted_sum():
    ev = {"days_since_last_report": 0, "cases": {"value": 99999}, "deaths": {"value": 9999}, "countries": ["A"] * 5, "status": "reported", "source_weight": 1.0}
    r = E.rank_event(ev)
    assert r["score"] == pytest.approx(1.0, abs=1e-4) and r["method_version"] == "1"
    assert sum(E.RANK_METHOD["weights"].values()) == pytest.approx(1.0)
    older = E.rank_event({**ev, "days_since_last_report": 30})
    assert older["components"]["recency"] == pytest.approx(np.exp(-1), abs=1e-4) and older["score"] < r["score"]
    assert E.rank_event({**ev, "cases": None, "deaths": None})["components"]["cases"] == 0


def test_event_feed_validation_quarantines_floods_and_drops():
    reps = [{"report_id": str(i)} for i in range(500)]
    assert E.validate_events(reps, 100) and E.validate_events(reps[:50], 100) and E.validate_events([], 0)
    assert E.validate_events(reps[:110], 100) == []


def test_who_don_and_cdc_parsers():
    don = {"value": [{"DonId": "2026-DON625", "Title": "T", "OverrideTitle": "Ebola disease - Kenya", "UseOverrideTitle": True, "PublicationDate": "2026-11-06T17:27:28Z", "LastModified": "2026-11-06T20:54:21Z",
                      "UrlName": "2026-DON625", "Summary": "<p>12 confirmed&nbsp;cases</p>", "Overview": "<script>x()</script><p>More</p>"}]}
    r = E.parse_who_don({"id": "who_don_api", "source_id": "who_don", "item_url": "https://www.who.int/emergencies/disease-outbreak-news/item/{UrlName}"}, json.dumps(don).encode(), "f")[0]
    assert r["report_id"] == "who_don:2026-DON625" and r["title"] == "Ebola disease - Kenya" and r["url"].endswith("/2026-DON625") and "x()" not in r["text"] and "12 confirmed cases" in r["text"]
    with pytest.raises(SchemaChange):
        E.parse_who_don({"id": "x", "source_id": "who_don", "item_url": "{UrlName}"}, b'{"value": [{"Title": "x"}]}', "f")
    rss = b"""<?xml version="1.0"?><rss><channel><item><title>Level 2 - Yellow Fever in Colombia</title><description><![CDATA[Cases rose. Country List :  Colombia]]></description>
    <link>https://wwwnc.cdc.gov/travel/notices/level2/yellow-fever-colombia</link><pubDate>Fri, 16 Oct 2026 04:00:00 GMT</pubDate></item></channel></rss>"""
    c = E.parse_cdc_travel({"id": "cdc_travel_rss", "source_id": "cdc_travel"}, rss, "f")[0]
    assert c["published"] == "2026-10-16" and c["countries_hint"] == "Colombia" and c["text"] == "Cases rose."
    with pytest.raises(SchemaChange):
        E.parse_cdc_travel({"id": "x", "source_id": "cdc_travel"}, b"<html></html>", "f")


# ----------------------------------------------------------------------------- failures become issues (never pull requests)

def test_source_failure_writes_an_issue_with_last_good_snapshot_and_schema_diff(tmp_path, monkeypatch):
    from uo import build
    monkeypatch.setattr(core, "STATE", tmp_path)
    err = SchemaChange("columns changed", expected=["A", "B"], found=["A", "C"])
    build._issue_for_failure("who_flunet_weekly", core.load_registry()["who_flunet"], err, {"who_flunet_weekly": {"last_good_snapshot": "20261109T000000Z"}})
    rec = json.loads(next((tmp_path / "issues").glob("*.json")).read_text())
    assert "who_flunet" in rec["body"] and "20261109T000000Z" in rec["body"] and "- B" in rec["body"] and "+ C" in rec["body"]
    assert "does not open pull requests" in rec["body"] and rec["kind"] == "source-failure"


def test_http_get_retries_with_backoff_then_fails(monkeypatch):
    import requests
    calls = {"n": 0}

    class R:
        status_code = 503
        content = b""
        headers: dict = {}

    def fake(*a, **k):
        calls["n"] += 1
        return R()
    monkeypatch.setattr(requests, "get", fake)
    monkeypatch.setenv("UO_BACKOFF", "0")
    with pytest.raises(PipelineError):
        core.http_get("https://example.org/x", retries=3)
    assert calls["n"] == 3
    R.status_code = 404
    calls["n"] = 0
    with pytest.raises(SchemaChange):  # a moved endpoint is not retried
        core.http_get("https://example.org/x", retries=3)
    assert calls["n"] == 1


def test_raw_archive_respects_redistribution_permission(tmp_path, monkeypatch):
    monkeypatch.setattr(core, "STATE", tmp_path / "state")
    monkeypatch.setattr(core, "R2_OUT", tmp_path / "r2")
    reg = core.load_registry()
    closed = core.archive_raw({"id": "who_flunet_weekly", "source_id": "who_flunet", "raw_ext": "json"}, reg, "https://x", b"{}")
    open_ = core.archive_raw({"id": "owid_measles", "source_id": "owid", "raw_ext": "csv"}, reg, "https://x", b"a,b")
    assert not closed.archive_public and closed.archive_key is None and not (tmp_path / "r2" / "raw" / "who_flunet_weekly").exists()
    assert open_.archive_public and (tmp_path / "r2" / open_.archive_key).read_bytes() == b"a,b"
    assert len(closed.raw_file_hash) == 64 and "raw_path" not in closed.public() and closed.public()["retrieved_at"].endswith("Z")


def test_reviewed_unclassified_names_stay_other_without_raising_an_issue():
    """Names a person reviewed (config: reviewed_unclassified) are never mapped to a disease and are not re-reported."""
    n = E.DiseaseNormalizer(core.load_diseases())
    assert n.normalize("Hurricane") == (None, None)
    ev, unmapped = _events([_rep("a", "Hurricane", "Jamaica", "2026-11-01"), _rep("b", "Mystery illness", "Kenya", "2026-11-01"),
                            _rep("c", "Psittacosis", "Kenya", "2026-11-01")])
    assert unmapped == ["Mystery illness"]
    assert sorted(e["disease"] for e in ev) == ["other", "other", "psittacosis"]


def test_reused_fetch_restores_public_raw_copy_and_local_path(tmp_path, monkeypatch):
    """CI restores state on a fresh machine: a reused fetch must find its raw file locally and re-create the public copy."""
    from uo import build as B
    state, r2 = tmp_path / "state", tmp_path / "r2"
    monkeypatch.setattr(B, "STATE", state); monkeypatch.setattr(B, "R2_OUT", r2)
    h = "ab" * 32
    (state / "raw" / "ds_ok").mkdir(parents=True); (state / "raw" / "ds_ok" / f"{h}.csv").write_bytes(b"x,y\n1,2\n")
    (state / "last_fetch").mkdir()
    rec = dict(fetch_id="ds_ok@abababababab", dataset_id="ds_ok", source_id="s", url="https://example.org/a.csv", retrieved_at="2026-01-01T00:00:00Z",
               raw_file_hash=h, bytes=8, raw_path="/somewhere/else/that/does/not/exist.csv", archive_public=True, archive_key=f"raw/ds_ok/{h}.csv",
               http_last_modified=None, link_kind="deep")
    (state / "last_fetch" / "ds_ok.json").write_text(json.dumps([rec]))
    (f,) = B._load_fetches("ds_ok")
    assert open(f.raw_path, "rb").read() == b"x,y\n1,2\n" and (r2 / "raw" / "ds_ok" / f"{h}.csv").read_bytes() == b"x,y\n1,2\n"
    private = dict(rec, archive_public=False, archive_key=None)
    (state / "last_fetch" / "ds_ok.json").write_text(json.dumps([private]))
    shutil.rmtree(r2); B._load_fetches("ds_ok")
    assert not r2.exists()  # non-redistributable raw files are never copied to the public folder
    (state / "raw" / "ds_ok" / f"{h}.csv").unlink()
    assert B._load_fetches("ds_ok") is None  # no raw bytes behind the record: fetch again


# ----------------------------------------------------------------------------- subnational (first-level regions)

def _shape(code, iso3, name, names=None, box=(0, 0, 1, 1)):
    x0, y0, x1, y1 = box
    return {"code": code, "iso3": iso3, "name": name, "names": names or [name],
            "geom": {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}}


def test_region_names_match_only_exactly_and_never_across_countries():
    from uo import subnational as S
    shapes = [_shape("THA-1", "THA", "Chon Buri"), _shape("THA-2", "THA", "Bangkok Metropolis", ["Bangkok Metropolis", "Krung Thep|Bangkok"]),
              _shape("AUS-1", "AUS", "New South Wales", ["New South Wales", "NSW"]), _shape("X-1", "XXA", "Springfield"), _shape("X-2", "XXA", "Springfield")]
    idx = S.name_index(shapes)
    assert S.match_name("THA", "CHONBURI", idx, {}) == "THA-1"            # spacing differs: same folded name
    assert S.match_name("THA", "BANGKOK", idx, {}) == "THA-2"             # an alternative name listed by the boundary source
    assert S.match_name("AUS", "NSW", idx, {}) == "AUS-1"
    assert S.match_name("THA", "CHON BURY", idx, {}) is None              # a near miss is not a match
    assert S.match_name("AUS", "CHONBURI", idx, {}) is None               # never across countries
    assert S.match_name("XXA", "Springfield", idx, {}) is None            # two regions share the name: ambiguous
    assert S.match_name("THA", "EASTERN SEABOARD", idx, {"THA": {"EASTERN SEABOARD": "Chon Buri"}}) == "THA-1"   # reviewed alias


def test_region_product_keeps_unmatched_names_and_flags_conflicts():
    from uo import subnational as S
    rec = pd.DataFrame([("THA", "CHONBURI", 2020, 10.0, "Y", "confirmed"), ("THA", "CHON BURI", 2020, 12.0, "Y", "confirmed"),
                        ("THA", "CHON BURI", 2021, 7.0, "M", "suspected"), ("THA", "NOWHERE", 2021, 3.0, "Y", "confirmed"),
                        ("ZZZ", "UNKNOWN", 2021, 1.0, "Y", "confirmed")], columns=["iso3", "name", "year", "value", "ptype", "detail"])
    p = S.build_dengue_product(rec, [_shape("THA-1", "THA", "Chon Buri"), _shape("THA-2", "THA", "Rayong", box=(1, 0, 2, 1))], {})
    assert list(p["countries"]) == ["THA"]                                 # a country with nothing matched is not published
    c = p["countries"]["THA"]
    assert c["years"] == [2020, 2021] and c["n_units"] == 3 and c["n_matched"] == 2 and c["conflicts"] == ["Chon Buri 2020"]
    assert p["unmatched"] == ["THA: NOWHERE", "ZZZ: UNKNOWN"]
    assert {u["name_in_source"]: u["id"] for u in c["units"]} == {"CHON BURI": "THA-1", "CHONBURI": "THA-1", "NOWHERE": None}
    assert len(p["boundaries"]["THA"]["features"]) == 2                    # regions without data are still drawn


def test_geometry_simplification_keeps_rings_closed_and_drops_islets():
    from uo import subnational as S
    big = [[0, 0], [5, 0.001], [10, 0], [10, 10], [0, 10], [0, 0]]
    islet = [[20, 20], [20.001, 20], [20.001, 20.001], [20, 20.001], [20, 20]]
    g = S.simplify_geometry({"type": "MultiPolygon", "coordinates": [[big], [islet]]})
    assert g["type"] == "Polygon" and g["coordinates"][0][0] == g["coordinates"][0][-1] and [5, 0.001] not in g["coordinates"][0]


def test_rss_notice_parser_reads_items_and_rejects_a_changed_feed():
    feed = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>Updates</title>
      <item><title>Ebola disease: Multi-country outbreak 2026</title><link>https://example.org/en/ebola-2026</link>
        <description>&lt;p&gt;Since May 2026, 12 confirmed cases.&lt;/p&gt;</description><pubDate>Mon, 19 Oct 2026 17:36:21 +0200</pubDate></item>
      <item><title>Job vacancies</title><link>https://example.org/en/jobs</link><description/><pubDate>Tue, 20 Oct 2026 09:00:00 +0200</pubDate></item>
    </channel></rss>"""
    ds = {"id": "x_feed", "source_id": "x", "label": "X feed"}
    reps = E.parse_rss_notices(ds, feed, "x_feed@abc")
    assert [r["report_id"] for r in reps] == ["x:ebola-2026:2026-10-19", "x:jobs:2026-10-20"]
    assert reps[0]["text"] == "Since May 2026, 12 confirmed cases." and reps[0]["countries_hint"] is None and reps[0]["url"].startswith("https://")
    norm = E.DiseaseNormalizer(core.load_diseases())
    assert [norm.normalize(r["title"])[0] for r in reps] == ["ebola", None]     # require_disease keeps only the first
    with pytest.raises(E.SchemaChange):
        E.parse_rss_notices(ds, b"<rss><channel><item><title>No date</title><link>https://example.org/a</link></item></channel></rss>", "f")
    with pytest.raises(E.SchemaChange):
        E.parse_rss_notices(ds, b"<html>moved</html>", "f")
