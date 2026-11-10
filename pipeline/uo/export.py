"""Bulk exports (Parquet, CSV, JSON, GeoJSON), data dictionary, Frictionless descriptor and DCAT catalog.

Parquet files are sorted by disease, place and date with modest row groups and column statistics, so DuckDB
can answer filtered queries over HTTP range requests without downloading whole files.
"""
from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from . import timeseries as ts
from .core import write_json

ROW_GROUP = 20_000

DICTIONARY = {
    "timeseries": [
        ("record_id", "string", "Stable id of the value: series_id + '@' + period_start. Use it with the lineage endpoint."),
        ("series_id", "string", "Series id: disease.dataset.metric.definition.system.period_type.ISO3."),
        ("disease", "string", "Disease id from config/diseases.yaml."),
        ("iso3", "string", "ISO 3166-1 alpha-3 country code."),
        ("place_name", "string", "Country name (GeoNames)."),
        ("period_start", "date", "First day of the reporting period (Monday for weeks; 1st of month; 1 January)."),
        ("period_type", "string", "W = ISO week, M = month, Y = year."),
        ("metric", "string", "cases, deaths, detections (laboratory detections) or specimens_processed."),
        ("value", "double", "Value as published by the source, or computed by this site when origin_type is site-derived."),
        ("population", "int64", "Population used for rates (World Bank, most recent year)."),
        ("rate_per_100k", "double", "Site-derived: value / population * 100,000. Empty where a rate is not meaningful."),
        ("case_definition", "string", "confirmed, probable, suspected, notified, unknown, mixed or not_applicable."),
        ("case_definition_detail", "string", "The source's own wording for the definition."),
        ("surveillance_system", "string", "Surveillance system or reporting channel."),
        ("origin_type", "string", "source-reported or site-derived."),
        ("likely_incomplete", "bool", "True for recent periods that are probably still being reported or revised."),
        ("is_default_series", "bool", "True for the series this site shows by default for the disease (rule in the methodology)."),
        ("dataset_id", "string", "Dataset id from config/datasets.yaml."),
        ("source_id", "string", "Source id from the source registry (/data/v1/sources.json)."),
        ("source_url", "string", "Deep link to the dataset, API query or file the value came from."),
        ("raw_record_ref", "string", "Where the value sits inside the raw file or response."),
        ("raw_file_hash", "string", "SHA-256 of the archived raw file or API response."),
        ("retrieved_at", "timestamp", "When this site fetched the raw file (UTC)."),
        ("snapshot_id", "string", "Immutable id of the published snapshot."),
        ("license", "string", "The source's license, carried from the registry."),
        ("chain_id", "string", "Id of the transformation chain."),
        ("transformations", "string", "JSON: ordered steps (operation, method_version, params)."),
        ("quality_flags", "string", "Semicolon-separated quality notes."),
    ],
    "events": [
        ("event_id", "string", "Stable event id."), ("disease", "string", "Normalized disease id; 'other' when unmapped."),
        ("name_in_source", "string", "Disease wording used in the notice title."), ("countries", "string", "ISO3 codes, semicolon-separated."),
        ("first_report", "date", "Date of the first grouped notice."), ("last_report", "date", "Date of the latest grouped notice."),
        ("status", "string", "reported, ongoing, declared_over (source-stated) or no_recent_update (recency indicator, not a judgment)."),
        ("status_basis", "string", "source-stated, source-published or recency-indicator."),
        ("cases", "int64", "Case count stated in the latest notice that gives one (automated extraction)."),
        ("cases_definition", "string", "Definition wording next to the count."), ("cases_as_of", "date", "Publication date of the notice the count came from."),
        ("deaths", "int64", "Death count stated in the notice (automated extraction)."), ("n_reports", "int64", "Number of notices grouped into the event."),
        ("location_name", "string", "Derived location name."), ("location_precision", "string", "country, admin1, admin2 or point."),
        ("lon", "double", "Longitude of the derived location."), ("lat", "double", "Latitude of the derived location."),
        ("location_method", "string", "Geocoding method and version."), ("rank_score", "double", "Ordering score (method active_rank)."),
        ("source_id", "string", "Source ids, semicolon-separated."), ("source_url", "string", "Link to the latest original notice."),
        ("origin_type", "string", "site-derived (grouped from source-reported notices)."), ("snapshot_id", "string", "Snapshot id."),
        ("license", "string", "Source licenses."), ("quality_flags", "string", "Quality notes."),
    ],
    "flags": [
        ("series_id", "string", "Series the flag refers to."), ("disease", "string", "Disease id."), ("iso3", "string", "Country."),
        ("period", "date", "Flagged period."), ("value", "double", "Reported value."), ("status", "string", "flagged, or suppressed-* with the reason."),
        ("baseline_mean", "double", "Mean of the baseline periods."), ("baseline_sd", "double", "Standard deviation used."),
        ("threshold", "double", "mean + k * sd."), ("baseline_start", "date", "First baseline period."), ("baseline_end", "date", "Last baseline period."),
        ("method", "string", "Method name."), ("method_version", "string", "Method version."), ("params", "string", "JSON parameters."),
        ("source_id", "string", "Source of the underlying series."), ("origin_type", "string", "site-derived."), ("snapshot_id", "string", "Snapshot id."),
    ],
    "revisions": [
        ("series_id", "string", "Series id."), ("period", "date", "Reporting period."), ("snapshot_id", "string", "Snapshot in which this value first appeared."),
        ("value", "double", "Value published in that snapshot; empty when the value was removed."), ("disease", "string", "Disease id."),
    ],
}


def _write_parquet(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pandas(df, preserve_index=False)
    pq.write_table(table, path, row_group_size=ROW_GROUP, compression="zstd", write_statistics=True, use_dictionary=True,
                   data_page_size=1 << 20)


def _write_csv_gz(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8", newline="") as f:
        df.to_csv(f, index=False)


def provenance_block(ctx, source_ids: list[str], transformations: list | None = None) -> dict:
    return {"snapshot_id": ctx.snapshot_id, "generated_at": ctx.now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sources": [{"source_id": s, "name": ctx.registry[s]["name"], "url": ctx.registry[s]["landing_url"],
                         "license": ctx.registry[s]["license"], "citation": ctx.registry[s]["citation"]} for s in sorted(source_ids)],
            "transformations": transformations or [],
            "suggested_citation": f"{ctx.site['identity']['creator']}. {ctx.site['name']}, snapshot {ctx.snapshot_id}. "
                                  f"{ctx.site['baseUrl']}. Data from: " + "; ".join(ctx.registry[s]["short_name"] for s in sorted(source_ids)) + "."}


def write_bulk(ctx, out: Path, meta: pd.DataFrame, lags: dict, defaults: dict, flags: list, events_idx: list) -> dict:
    bulk = out / "bulk"
    df = ctx.df
    m = meta.set_index("skey")
    fetch = ctx.fetches
    pop = {k: v["population"] for k, v in ctx.places.items()}
    names = {k: v["name"] for k, v in ctx.places.items()}
    iso2 = {k: v["iso2"] for k, v in ctx.places.items()}
    rate_ok = {d["id"]: bool(d.get("rate_metric")) for d in ctx.diseases_doc["diseases"]}
    result = {"timeseries": [], "revisions": [], "events": {}, "flags": {}, "row_group_size": ROW_GROUP}
    default_set = set(defaults.values())
    for disease, g in df.groupby("disease"):
        g = g.sort_values(["iso3", "period", "skey"])
        skeys = g["skey"]
        incf = skeys.map(lambda k: lags[f"{m.loc[k]['dataset_id']}|{m.loc[k]['period_type']}"]["incomplete_from"])
        population = g["iso3"].map(pop)
        rate = np.where(rate_ok.get(disease, False) & g["metric"].isin(["cases", "deaths"]).to_numpy() & population.notna().to_numpy(),
                        g["value"].to_numpy() / population.to_numpy(dtype=float) * 1e5, np.nan)
        dl = {ds: ctx.datasets[ds]["deep_link"] for ds in g["dataset_id"].unique()}
        src_url = [dl[d].replace("{iso3}", i).replace("{iso2}", iso2.get(i, "")) for d, i in zip(g["dataset_id"], g["iso3"])]
        o = pd.DataFrame({
            "record_id": g["series_id"] + "@" + g["period"], "series_id": g["series_id"], "disease": disease, "iso3": g["iso3"],
            "place_name": g["iso3"].map(names), "period_start": pd.to_datetime(g["period"]).dt.date, "period_type": g["period_type"],
            "metric": g["metric"], "value": g["value"].astype(float), "population": population.astype("Int64"),
            "rate_per_100k": np.round(rate, 6), "case_definition": g["case_definition"], "case_definition_detail": g["case_definition_detail"],
            "surveillance_system": g["surveillance_system"], "origin_type": g["origin_type"],
            "likely_incomplete": (g["period"] >= incf).to_numpy(), "is_default_series": skeys.isin(default_set).to_numpy(),
            "dataset_id": g["dataset_id"], "source_id": g["dataset_id"].map(lambda d: ctx.datasets[d]["source_id"]),
            "source_url": src_url, "raw_record_ref": g["raw_record_ref"],
            "raw_file_hash": g["fetch_id"].map(lambda f: fetch.get(f, {}).get("raw_file_hash")),
            "retrieved_at": g["fetch_id"].map(lambda f: fetch.get(f, {}).get("retrieved_at")),
            "snapshot_id": ctx.snapshot_id,
            "license": g["dataset_id"].map(lambda d: ctx.registry[ctx.datasets[d]["source_id"]]["license"]),
            "chain_id": skeys.map(lambda k: m.loc[k]["chain_id"]),
            "transformations": skeys.map(lambda k: json.dumps(m.loc[k]["chain"], separators=(",", ":"))),
            "quality_flags": [";".join(x for x in (("likely-incomplete" if inc else ""), ("negative-correction-in-source" if v < 0 else "")) if x)
                              for inc, v in zip((g["period"] >= incf).to_numpy(), g["value"].to_numpy())],
        })
        p = bulk / "timeseries" / f"disease={disease}" / "data.parquet"
        _write_parquet(o, p)
        _write_csv_gz(o, bulk / "timeseries" / f"disease={disease}" / "data.csv.gz")
        srcs = sorted(set(o["source_id"]))
        write_json(bulk / "timeseries" / f"disease={disease}" / "provenance.json", provenance_block(ctx, srcs), compact=False)
        result["timeseries"].append({"disease": disease, "parquet": f"bulk/timeseries/disease={disease}/data.parquet",
                                     "csv": f"bulk/timeseries/disease={disease}/data.csv.gz", "rows": int(len(o)),
                                     "bytes": p.stat().st_size, "source_ids": srcs})
    # revisions
    h = ctx.history.copy()
    h["disease"] = h["series_id"].str.split(".", n=1).str[0]
    for disease, g in h.groupby("disease"):
        g = g.sort_values(["series_id", "period", "snapshot_id"])
        p = bulk / "revisions" / f"disease={disease}" / "revisions.parquet"
        _write_parquet(g[["series_id", "period", "snapshot_id", "value", "disease"]], p)
        result["revisions"].append({"disease": disease, "parquet": f"bulk/revisions/disease={disease}/revisions.parquet",
                                    "rows": int(len(g)), "bytes": p.stat().st_size})
    # events (one row per derived location)
    rows = []
    for e in events_idx:
        locs = e["locations"] or [{"iso3": None, "precision": None, "lon": None, "lat": None, "name": None}]
        for l in locs:
            rows.append({"event_id": e["event_id"], "disease": e["disease"], "name_in_source": e["name_in_source"],
                         "countries": ";".join(e["countries"]), "first_report": e["first_report"], "last_report": e["last_report"],
                         "status": e["status"], "status_basis": e["status_basis"],
                         "cases": e["cases"]["value"] if e["cases"] else None, "cases_definition": e["cases"]["case_definition"] if e["cases"] else None,
                         "cases_as_of": e["cases"]["as_of"] if e["cases"] else None, "deaths": e["deaths"]["value"] if e["deaths"] else None,
                         "n_reports": e["n_reports"], "location_name": l["name"], "location_precision": l["precision"], "lon": l["lon"], "lat": l["lat"],
                         "location_method": "gazetteer_match v1", "rank_score": e["rank"]["score"], "source_id": ";".join(e["source_ids"]),
                         "source_url": e["latest_url"], "origin_type": "site-derived", "snapshot_id": ctx.snapshot_id,
                         "license": "; ".join(ctx.registry[s]["license"] for s in e["source_ids"]), "quality_flags": ";".join(e["quality_flags"])})
    edf = pd.DataFrame(rows)
    if len(edf):
        edf["cases"] = edf["cases"].astype("Int64")
        edf["deaths"] = edf["deaths"].astype("Int64")
        edf = edf.sort_values(["disease", "countries", "first_report"])
        _write_parquet(edf, bulk / "events" / "events.parquet")
        _write_csv_gz(edf, bulk / "events" / "events.csv.gz")
        gj = {"type": "FeatureCollection", "provenance": provenance_block(ctx, sorted({s for e in events_idx for s in e["source_ids"]} | {"geonames", "naturalearth"})),
              "features": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
                            "properties": {k: (None if pd.isna(v) else v) for k, v in r.items() if k not in ("lon", "lat")}}
                           for r in edf.to_dict("records") if r["lon"] is not None and not pd.isna(r["lon"])]}
        write_json(bulk / "events" / "events.geojson", gj)
        result["events"] = {"parquet": "bulk/events/events.parquet", "csv": "bulk/events/events.csv.gz", "geojson": "bulk/events/events.geojson", "rows": int(len(edf))}
    # flags
    fdf = pd.DataFrame([{"series_id": f["series_id"], "disease": f["disease"], "iso3": f["iso3"], "period": f["period"], "value": f["value"],
                         "status": f["status"], "baseline_mean": f["baseline_mean"], "baseline_sd": f["baseline_sd"], "threshold": f["threshold"],
                         "baseline_start": f["baseline_periods"][0], "baseline_end": f["baseline_periods"][1], "method": f["method"],
                         "method_version": f["method_version"], "params": json.dumps({"seasonal": f["seasonal"]}),
                         "source_id": ";".join(f["source_ids"]), "origin_type": "site-derived", "snapshot_id": ctx.snapshot_id} for f in flags])
    if len(fdf):
        _write_parquet(fdf, bulk / "flags" / "flags.parquet")
        _write_csv_gz(fdf, bulk / "flags" / "flags.csv.gz")
        result["flags"] = {"parquet": "bulk/flags/flags.parquet", "csv": "bulk/flags/flags.csv.gz", "rows": int(len(fdf))}
    # dictionary + catalog
    dictionary = {k: [{"name": n, "type": t, "description": d} for n, t, d in v] for k, v in DICTIONARY.items()}
    write_json(out / "catalog" / "dictionary.json", {"schema_version": "1.0.0", "tables": dictionary}, compact=False)
    base = ctx.site["baseUrl"].rstrip("/") + ctx.site["dataPath"]
    ident = ctx.site["identity"]
    srcs_all = sorted({s for t in result["timeseries"] for s in t["source_ids"]})
    ftype = {"string": "string", "double": "number", "int64": "integer", "date": "date", "bool": "boolean", "timestamp": "datetime"}
    resources = [{"name": f"timeseries-{t['disease']}", "path": f"{base}/{t['parquet']}", "format": "parquet", "mediatype": "application/vnd.apache.parquet",
                  "bytes": t["bytes"], "schema": {"fields": [{"name": n, "type": ftype[ty], "description": d} for n, ty, d in DICTIONARY["timeseries"]]},
                  "sources": [{"title": ctx.registry[s]["name"], "path": ctx.registry[s]["landing_url"]} for s in t["source_ids"]],
                  "licenses": [{"name": ctx.registry[s]["license"], "path": ctx.registry[s]["license_url"]} for s in t["source_ids"]]}
                 for t in result["timeseries"]]
    if result["events"]:
        resources.append({"name": "events", "path": f"{base}/bulk/events/events.parquet", "format": "parquet",
                          "schema": {"fields": [{"name": n, "type": ftype[ty], "description": d} for n, ty, d in DICTIONARY["events"]]}})
    write_json(out / "catalog" / "datapackage.json", {
        "profile": "data-package", "name": "understandingoutbreaks", "title": f"{ctx.site['name']} bulk datasets", "version": ctx.snapshot_id,
        "homepage": ctx.site["baseUrl"], "created": ctx.now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "description": "Aggregated official public reports of infectious disease activity, with record-level provenance. Not a surveillance system; not medical advice.",
        "contributors": [{"title": ident["creator"], "role": "author"}], "resources": resources}, compact=False)
    datasets = [{"@type": "dcat:Dataset", "@id": f"{base}/{t['parquet']}", "dct:title": f"{ctx.site['name']}: {t['disease']} time series",
                 "dct:identifier": f"uo-timeseries-{t['disease']}-{ctx.snapshot_id}", "dct:issued": ctx.now.strftime("%Y-%m-%d"),
                 "dct:publisher": {"@type": "foaf:Agent", "foaf:name": ident["creator"]},
                 "dct:source": [ctx.registry[s]["landing_url"] for s in t["source_ids"]],
                 "dct:license": [ctx.registry[s]["license"] for s in t["source_ids"]],
                 "dcat:distribution": [{"@type": "dcat:Distribution", "dcat:downloadURL": f"{base}/{t['parquet']}", "dcat:mediaType": "application/vnd.apache.parquet", "dcat:byteSize": t["bytes"]},
                                       {"@type": "dcat:Distribution", "dcat:downloadURL": f"{base}/{t['csv']}", "dcat:mediaType": "text/csv", "dcat:compressFormat": "gzip"}]}
                for t in result["timeseries"]]
    write_json(out / "catalog" / "dcat.jsonld", {
        "@context": {"dcat": "http://www.w3.org/ns/dcat#", "dct": "http://purl.org/dc/terms/", "foaf": "http://xmlns.com/foaf/0.1/"},
        "@type": "dcat:Catalog", "dct:title": f"{ctx.site['name']} data catalog", "dct:publisher": {"@type": "foaf:Agent", "foaf:name": ident["creator"]},
        "dcat:dataset": datasets}, compact=False)
    # schema.org/Dataset JSON-LD (embedded on the dataset pages at runtime and available as a file)
    write_json(out / "catalog" / "dataset.jsonld", {
        "@context": "https://schema.org", "@type": "Dataset", "name": f"{ctx.site['name']} bulk datasets", "version": ctx.snapshot_id,
        "description": "Aggregated official public reports of infectious disease activity (time series, event notices, revision history, signal flags) with record-level provenance. Not a surveillance system; not medical advice.",
        "url": ctx.site["baseUrl"].rstrip("/") + "/en/researchers", "dateModified": ctx.now.strftime("%Y-%m-%d"), "isAccessibleForFree": True,
        "creator": {"@type": "Organization", "name": ident["creator"]}, "license": "https://creativecommons.org/licenses/by/4.0/",
        "isBasedOn": [{"@type": "Dataset", "name": ctx.registry[s]["name"], "url": ctx.registry[s]["landing_url"], "license": ctx.registry[s]["license_url"],
                       "creator": {"@type": "Organization", "name": ctx.registry[s]["publisher"]}} for s in srcs_all],
        "distribution": [{"@type": "DataDownload", "encodingFormat": "application/vnd.apache.parquet", "contentUrl": f"{base}/{t['parquet']}", "name": f"timeseries {t['disease']}"} for t in result["timeseries"]],
        **({"identifier": "https://doi.org/" + ident["doi"]} if ident.get("doi") else {}),
    }, compact=False)
    result["source_ids"] = srcs_all
    return result
