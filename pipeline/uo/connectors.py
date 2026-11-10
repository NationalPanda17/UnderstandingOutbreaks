"""Per-source time-series connectors.

Each connector has a pure ``parse_*`` function (raw bytes -> tidy rows) so it can be tested against recorded
responses, and shares ``fetch_dataset`` for network access. A connector fails hard (SchemaChange) when the
columns it relies on are missing: schema changes are never papered over.

Tidy row columns:
  disease, iso3, period (ISO date of period start), period_type (W/M/Y), metric, value,
  case_definition, case_definition_detail, surveillance_system, dataset_id, fetch_id, raw_record_ref, origin_type
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import zipfile
from typing import Callable

import pandas as pd

from .core import Fetch, PipelineError, SchemaChange, archive_raw, http_get

TIDY_COLUMNS = ["disease", "iso3", "period", "period_type", "metric", "value", "case_definition",
                "case_definition_detail", "surveillance_system", "dataset_id", "fetch_id", "raw_record_ref", "origin_type"]


def require_columns(found: list[str], expected: list[str], what: str) -> None:
    missing = [c for c in expected if c not in found]
    if missing:
        raise SchemaChange(f"{what}: expected columns missing: {missing}", expected=expected, found=list(found))


def week_start(d: dt.date) -> dt.date:
    """Monday of the ISO week containing d."""
    return d - dt.timedelta(days=d.weekday())


def _rows(ds: dict, fetch_id: str, rows: list[tuple]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["iso3", "period", "period_type", "metric", "value", "case_definition",
                                     "case_definition_detail", "surveillance_system", "raw_record_ref"])
    df["disease"] = ds["disease"]
    df["dataset_id"] = ds["id"]
    df["fetch_id"] = fetch_id
    df["origin_type"] = "site-derived" if ds.get("derived") else "source-reported"
    return df[TIDY_COLUMNS]


def _num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "").replace(" ", "").replace(" ", "")
    if s in ("", "NA", "NaN", "nan", "None", "null"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


# ----------------------------------------------------------------------------- WHO FluNet

FLUNET_SYSTEMS = {"SENTINEL": "sentinel", "NONSENTINEL": "non_sentinel", "NOTDEFINED": "not_defined"}


def parse_flunet(ds: dict, content: bytes, fetch_id: str, ref: dict) -> pd.DataFrame:
    doc = json.loads(content)
    if "value" not in doc:
        raise SchemaChange("FluNet: OData 'value' array missing", expected=["value"], found=list(doc))
    rows = []
    cols = ["COUNTRY_CODE", "ISO_WEEKSTARTDATE", "ORIGIN_SOURCE", "SPEC_PROCESSED_NB", "INF_ALL"]
    if doc["value"]:
        require_columns(list(doc["value"][0]), cols, "FluNet")
    for r in doc["value"]:
        iso3 = r["COUNTRY_CODE"]
        sysraw = r["ORIGIN_SOURCE"] or "NOTDEFINED"
        system = FLUNET_SYSTEMS.get(sysraw, "not_defined")
        period = str(r["ISO_WEEKSTARTDATE"])[:10]
        refstr = f"COUNTRY_CODE={iso3};ISO_WEEKSTARTDATE={period};ORIGIN_SOURCE={sysraw}"
        for metric, col, cdef, detail in (("detections", "INF_ALL", "confirmed", "laboratory-confirmed influenza detections"),
                                          ("specimens_processed", "SPEC_PROCESSED_NB", "not_applicable", "specimens processed")):
            v = _num(r.get(col))
            if v is not None:
                rows.append((iso3, period, "W", metric, v, cdef, detail, system, refstr))
    # The API occasionally returns byte-identical duplicate rows. Identical rows are collapsed; rows that
    # disagree are left in place so that validation fails and a person looks at them.
    return _rows(ds, fetch_id, list(dict.fromkeys(rows)))


# ----------------------------------------------------------------------------- WHO COVID-19

def parse_who_covid(ds: dict, content: bytes, fetch_id: str, ref: dict) -> pd.DataFrame:
    text = content.decode("utf-8-sig")
    rd = csv.DictReader(io.StringIO(text))
    require_columns(rd.fieldnames or [], ["Date_reported", "Country_code", "New_cases", "New_deaths"], "WHO COVID-19")
    rows = []
    for r in rd:
        iso2 = (r["Country_code"] or "").strip()
        iso3 = ref["iso2_to_iso3"].get(iso2)
        if not iso3:
            continue  # "OT" (other) and blank codes are not countries
        end = dt.date.fromisoformat(r["Date_reported"][:10])
        period = (end - dt.timedelta(days=6)).isoformat()
        refstr = f"Country_code={iso2};Date_reported={end.isoformat()}"
        for metric, col in (("cases", "New_cases"), ("deaths", "New_deaths")):
            v = _num(r[col])
            if v is not None:
                rows.append((iso3, period, "W", metric, v, "confirmed", "confirmed COVID-19 as reported to WHO",
                             "national_notification", refstr))
    return _rows(ds, fetch_id, rows)


# ----------------------------------------------------------------------------- daily -> ISO week helper

def daily_to_weekly(daily: pd.DataFrame, last_date: dt.date) -> pd.DataFrame:
    """Sum daily values into ISO weeks (Monday start). The final week is dropped unless it is complete.

    Method ``sum_daily_to_iso_week`` v1. ``daily`` has columns iso3, date (datetime.date), metric, value, cdef.
    """
    if daily.empty:
        return daily.assign(period=[])
    d = daily.copy()
    d["period"] = d["date"].map(lambda x: week_start(x).isoformat())
    last_complete = week_start(last_date) if last_date.weekday() == 6 else week_start(last_date) - dt.timedelta(days=7)
    d = d[d["period"] <= last_complete.isoformat()]
    return d.groupby(["iso3", "period", "metric", "cdef"], as_index=False)["value"].sum()


# ----------------------------------------------------------------------------- WHO mpox

def parse_who_mpox(ds: dict, content: bytes, fetch_id: str, ref: dict) -> pd.DataFrame:
    doc = json.loads(content)
    vals = doc.get("value")
    if vals is None:
        raise SchemaChange("WHO mpox: OData 'value' array missing", expected=["value"], found=list(doc))
    if vals:
        require_columns(list(vals[0]), ["ISO3", "DATE", "NEW_CONF_CASES", "NEW_PROB_CASES", "NEW_CONF_DEATHS"], "WHO mpox")
    recs = []
    for r in vals:
        if not r.get("DATE"):
            continue  # the source keeps one undated row per country for cases with no known date: not attributable to a week
        d = dt.date.fromisoformat(str(r["DATE"])[:10])
        for metric, col, cdef in (("cases", "NEW_CONF_CASES", "confirmed"), ("cases", "NEW_PROB_CASES", "probable"),
                                  ("deaths", "NEW_CONF_DEATHS", "confirmed")):
            v = _num(r.get(col))
            if v is not None:
                recs.append((r["ISO3"], d, metric, v, cdef))
    daily = pd.DataFrame(recs, columns=["iso3", "date", "metric", "value", "cdef"])
    if daily.empty:
        return _rows(ds, fetch_id, [])
    wk = daily_to_weekly(daily, daily["date"].max())
    rows = [(r.iso3, r.period, "W", r.metric, float(r.value), r.cdef,
             "laboratory-confirmed" if r.cdef == "confirmed" else "probable", "national_notification",
             f"ISO3={r.iso3};DATE in [{r.period}, {r.period}+6d]") for r in wk.itertuples()]
    return _rows(ds, fetch_id, rows)


def parse_owid_mpox(ds: dict, content: bytes, fetch_id: str, ref: dict) -> pd.DataFrame:
    df = pd.read_csv(io.BytesIO(content), usecols=lambda c: c in ("date", "iso_code", "new_cases", "new_deaths"))
    require_columns(list(df.columns), ["date", "iso_code", "new_cases"], "OWID mpox")
    df = df[df["iso_code"].astype(str).str.fullmatch(r"[A-Z]{3}")]
    df["date"] = pd.to_datetime(df["date"]).dt.date
    recs = []
    for metric, col in (("cases", "new_cases"), ("deaths", "new_deaths")):
        if col in df:
            sub = df[["iso_code", "date", col]].dropna()
            recs.append(pd.DataFrame({"iso3": sub["iso_code"], "date": sub["date"], "metric": metric,
                                      "value": sub[col].astype(float), "cdef": "confirmed"}))
    daily = pd.concat(recs, ignore_index=True)
    wk = daily_to_weekly(daily, daily["date"].max())
    rows = [(r.iso3, r.period, "W", r.metric, float(r.value), r.cdef, "confirmed, as processed by Our World in Data",
             "national_notification", f"iso_code={r.iso3};date in [{r.period}, {r.period}+6d]") for r in wk.itertuples()]
    return _rows(ds, fetch_id, rows)


# ----------------------------------------------------------------------------- WHO measles (provisional, monthly)

MEASLES_COLS = {
    "Measles suspect": ("suspected", "suspected measles (fever and rash)"),
    "Measles lab-confirmed": ("confirmed", "laboratory-confirmed"),
    "Measles total": ("notified", "WHO measles total: laboratory-confirmed + epidemiologically linked + clinically compatible"),
}


def parse_who_measles(ds: dict, content: bytes, fetch_id: str, ref: dict) -> pd.DataFrame:
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True)
    if "WEB" not in wb.sheetnames:
        raise SchemaChange("WHO measles: sheet 'WEB' missing", expected=["WEB"], found=wb.sheetnames)
    it = wb["WEB"].iter_rows(values_only=True)
    header = [" ".join(str(h).split()) if h is not None else "" for h in next(it)]
    require_columns(header, ["ISO3", "Year", "Month", *MEASLES_COLS], "WHO measles")
    ix = {h: i for i, h in enumerate(header)}
    rows = []
    for r in it:
        iso3 = r[ix["ISO3"]]
        if not iso3 or r[ix["Year"]] is None or r[ix["Month"]] is None:
            continue
        y, m = int(r[ix["Year"]]), int(r[ix["Month"]])
        period = f"{y:04d}-{m:02d}-01"
        refstr = f"sheet=WEB;ISO3={iso3};Year={y};Month={m:02d}"
        for col, (cdef, detail) in MEASLES_COLS.items():
            v = _num(r[ix[col]])
            if v is not None:
                rows.append((iso3, period, "M", "cases", v, cdef, detail, "case_based_surveillance", refstr))
    return _rows(ds, fetch_id, rows)


# ----------------------------------------------------------------------------- WHO WIISE annual incidence

def parse_who_wiise(ds: dict, content: bytes, fetch_id: str, ref: dict) -> pd.DataFrame:
    doc = json.loads(content)
    vals = doc.get("value")
    if vals is None:
        raise SchemaChange("WHO WIISE: OData 'value' array missing", expected=["value"], found=list(doc))
    if vals:
        require_columns(list(vals[0]), ["CODE", "YEAR", "DISEASE", "CASES"], "WHO WIISE")
    rows = []
    for r in vals:
        v = _num(r["CASES"])
        if v is None or r["DISEASE"] != ds["wiise_disease"]:
            continue
        y = int(r["YEAR"])
        rows.append((r["CODE"], f"{y}-01-01", "Y", "cases", v, "notified", "annual officially reported cases",
                     "national_notification", f"CODE={r['CODE']};YEAR={y};DISEASE={r['DISEASE']}"))
    return _rows(ds, fetch_id, rows)


# ----------------------------------------------------------------------------- WHO GHO

def parse_who_gho(ds: dict, content: bytes, fetch_id: str, ref: dict) -> pd.DataFrame:
    doc = json.loads(content)
    vals = doc.get("value")
    if vals is None:
        raise SchemaChange("WHO GHO: OData 'value' array missing", expected=["value"], found=list(doc))
    if vals:
        require_columns(list(vals[0]), ["IndicatorCode", "SpatialDimType", "SpatialDim", "TimeDim", "NumericValue"], "WHO GHO")
    rows = []
    for r in vals:
        v = _num(r["NumericValue"])
        if v is None:
            v = _num(r.get("Value"))  # older rows carry the number only in the display field
        if v is None or r["SpatialDimType"] != "COUNTRY":
            continue
        y = int(r["TimeDim"])
        rows.append((r["SpatialDim"], f"{y}-01-01", "Y", "cases", v, "notified", "annual reported cases",
                     "national_notification", f"IndicatorCode={r['IndicatorCode']};SpatialDim={r['SpatialDim']};TimeDim={y}"))
    return _rows(ds, fetch_id, rows)


# ----------------------------------------------------------------------------- OWID grapher (annual)

def parse_owid_grapher(ds: dict, content: bytes, fetch_id: str, ref: dict) -> pd.DataFrame:
    rd = csv.DictReader(io.StringIO(content.decode("utf-8-sig")))
    col = ds["value_column"]
    require_columns(rd.fieldnames or [], ["code", "year", col], f"OWID grapher ({ds['id']})")
    rows = []
    for r in rd:
        code = (r["code"] or "").strip()
        v = _num(r[col])
        if len(code) != 3 or not code.isalpha() or v is None:
            continue  # aggregates such as OWID_WRL are not countries
        y = int(r["year"])
        rows.append((code, f"{y}-01-01", "Y", "cases", v, "notified", "annual reported cases, as processed by Our World in Data",
                     "national_notification", f"code={code};year={y}"))
    return _rows(ds, fetch_id, rows)


# ----------------------------------------------------------------------------- OpenDengue

def opendengue_definition(raw: str) -> tuple[str, str]:
    """Map OpenDengue's standardised definition to the site vocabulary without merging categories."""
    s = (raw or "").strip().lower()
    if s == "confirmed":
        return "confirmed", raw
    if s == "probable":
        return "probable", raw
    if s == "suspected":
        return "suspected", raw
    if s in ("", "na", "nan"):
        return "unknown", "not stated"
    return "notified", raw  # combinations such as "Suspected and confirmed" or "Total"


def parse_opendengue(ds: dict, content: bytes, fetch_id: str, ref: dict) -> pd.DataFrame:
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".csv")]
        if not names:
            raise SchemaChange("OpenDengue: no CSV in archive", expected=["*.csv"], found=z.namelist())
        df = pd.read_csv(z.open(names[0]), dtype=str, keep_default_na=False)
    require_columns(list(df.columns), ["ISO_A0", "calendar_start_date", "calendar_end_date", "dengue_total",
                                       "case_definition_standardised", "S_res", "T_res", "UUID"], "OpenDengue")
    df = df[df["S_res"] == "Admin0"]
    ptype = {"Week": "W", "Month": "M", "Year": "Y"}
    rows = []
    for r in df.itertuples(index=False):
        v = _num(r.dengue_total)
        pt = ptype.get(r.T_res)
        if v is None or pt is None or len(r.ISO_A0) != 3:
            continue
        cdef, detail = opendengue_definition(r.case_definition_standardised)
        start = dt.date.fromisoformat(r.calendar_start_date)
        if pt == "W":
            # Epidemiological weeks in the source may start on Sunday; align to the Monday on or after the start.
            start = start + dt.timedelta(days=1) if start.weekday() == 6 else week_start(start)
        elif pt == "M":
            start = start.replace(day=1)
        else:
            start = start.replace(month=1, day=1)
        rows.append((r.ISO_A0, start.isoformat(), pt, "cases", v, cdef, f"OpenDengue: {detail}", "compiled_public_reports",
                     f"UUID={r.UUID};ISO_A0={r.ISO_A0};calendar_start_date={r.calendar_start_date}"))
    out = _rows(ds, fetch_id, rows)
    # A source may list the same country, period and definition from two compilations: keep the first, flag later.
    return out.drop_duplicates(subset=["iso3", "period", "period_type", "metric", "case_definition", "case_definition_detail"])


PARSERS: dict[str, Callable] = {
    "flunet": parse_flunet, "who_covid": parse_who_covid, "who_mpox": parse_who_mpox, "owid_mpox": parse_owid_mpox,
    "who_measles": parse_who_measles, "who_wiise": parse_who_wiise, "who_gho": parse_who_gho,
    "owid_grapher": parse_owid_grapher, "opendengue": parse_opendengue,
}


# ----------------------------------------------------------------------------- fetching

def fetch_dataset(ds: dict, registry: dict) -> list[Fetch]:
    """Fetch every page of a dataset and archive each raw response. OData responses are followed by nextLink."""
    url = ds["url"].format(**{k: v for k, v in ds.items() if isinstance(v, (str, int))})
    fetches: list[Fetch] = []
    page = 0
    while url:
        content, headers = http_get(url)
        fetches.append(archive_raw(ds, registry, url, content, headers, part=f"p{page}" if page else "",
                                   link_kind=ds.get("link_kind", "deep")))
        nxt = None
        if ds["raw_ext"] == "json" and content[:1] == b"{":
            try:
                nxt = json.loads(content).get("@odata.nextLink")
            except json.JSONDecodeError as e:
                raise SchemaChange(f"{ds['id']}: response is not JSON: {e}")
        url, page = nxt, page + 1
        if page > 400:
            raise PipelineError(f"{ds['id']}: too many pages")
    return fetches


def parse_dataset(ds: dict, fetches: list[Fetch], ref: dict) -> pd.DataFrame:
    parser = PARSERS[ds["connector"]]
    parts = [parser(ds, f.content if f.content is not None else open(f.raw_path, "rb").read(), f.fetch_id, ref) for f in fetches]
    df = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=TIDY_COLUMNS)
    df = df[df["iso3"].isin(ref["iso3_set"])]
    return df.reset_index(drop=True)
