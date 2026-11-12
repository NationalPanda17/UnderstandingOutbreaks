"""Subnational (first-level region) products.

Currently one product: annual dengue counts by first-level administrative region, from the OpenDengue spatial
extract, drawn on Natural Earth admin-1 boundaries.

What this module will not do:
  * It never guesses which boundary a source name refers to. A name is matched only when, after case/accent/
    punctuation folding, it equals exactly one Natural Earth name for a region of the same country, or a person has
    listed it in ``config/admin1_aliases.yaml``. Everything else stays off the map, is listed in the published file,
    and raises a GitHub issue.
  * It never computes rates: no population figures are published at this level by the sources the site reads.
  * It never adds up finer (second-level) records into regions.

The two downloads are large (about 55 MB and 15 MB), so they are refreshed at most every ``refresh_days`` and the
derived product is cached in state, keyed by the raw files' hashes.
"""
from __future__ import annotations

import datetime as dt
import io
import re
import unicodedata
import zipfile

import pandas as pd

from .connectors import opendengue_definition
from .core import (CONFIG, STATE, Fetch, SchemaChange, archive_raw, http_get, iso, load_yaml, read_json, record_issue,
                   write_json)
from .timeseries import DENGUE_PRIORITY

METHOD = {"name": "dengue_admin1_annual", "version": "1"}
NAME_FIELDS = ("name", "name_alt", "name_local", "gn_name", "woe_name", "name_en", "gns_name", "abbrev", "postal")
GENERIC = r"\b(province|state|region|department|departamento|provincia|estado|prefecture|governorate|district|city|municipality|of|de|del|la|el)\b"


def fold(s: str) -> str:
    """Case-, accent- and punctuation-insensitive form of a region name, without generic words such as 'province'."""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(GENERIC, " ", s)
    return re.sub(r"\s+", " ", s).strip()


# ----------------------------------------------------------------------------- fetching

def _fetch(ds: dict, registry: dict, offline: bool, now: dt.datetime, load, save) -> Fetch | None:
    """Reuse the stored fetch unless it is older than refresh_days; returns None only when offline with nothing stored."""
    old = (load(ds["id"]) or [None])[0]
    if old is not None:
        age = (now - dt.datetime.fromisoformat(old.retrieved_at.replace("Z", "+00:00"))).days
        if offline or age < int(ds.get("refresh_days", 30)):
            return old
    if offline:
        return None
    content, headers = http_get(ds["url"], timeout=600)
    f = archive_raw(ds, registry, ds["url"], content, headers, link_kind=ds.get("link_kind", "deep"), now=now)
    save(ds["id"], [f])
    return f


# ----------------------------------------------------------------------------- parsing

def parse_admin1_records(content: bytes, today: dt.date) -> pd.DataFrame:
    """Annual value per (country, source region name, year) using the same rule as the national dengue series.

    Use an annual record if there is one; else 12 monthly records; else at least 52 weekly records. Where several
    case definitions exist, take the broadest. The current year is left out because it is incomplete.
    """
    need_cols = ["adm_1_name", "ISO_A0", "calendar_start_date", "dengue_total", "case_definition_standardised", "S_res", "T_res"]
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".csv")]
        if not names:
            raise SchemaChange("OpenDengue spatial extract: no CSV in archive", expected=["*.csv"], found=z.namelist())
        head = pd.read_csv(z.open(names[0]), nrows=0)
        missing = [c for c in need_cols if c not in head.columns]
        if missing:
            raise SchemaChange("OpenDengue spatial extract: columns missing", expected=need_cols, found=list(head.columns))
        parts = []
        for chunk in pd.read_csv(z.open(names[0]), usecols=need_cols, dtype=str, keep_default_na=False, chunksize=400_000):
            parts.append(chunk[chunk["S_res"] == "Admin1"])
    df = pd.concat(parts, ignore_index=True)
    df = df[(df["adm_1_name"] != "") & (df["ISO_A0"].str.len() == 3)]
    df["value"] = pd.to_numeric(df["dengue_total"], errors="coerce")
    df = df.dropna(subset=["value"])
    df["year"] = df["calendar_start_date"].str[:4].astype(int)
    df["ptype"] = df["T_res"].map({"Week": "W", "Month": "M", "Year": "Y"})
    df = df.dropna(subset=["ptype"])
    defs = {d: opendengue_definition(d) for d in df["case_definition_standardised"].unique()}
    df["cdef"] = df["case_definition_standardised"].map(lambda d: defs[d][0])
    df["detail"] = df["case_definition_standardised"].map(lambda d: defs[d][1])
    grp = df.groupby(["ISO_A0", "adm_1_name", "year", "ptype", "cdef", "detail"], as_index=False).agg(value=("value", "sum"), n=("value", "size"))
    need = {"Y": 1, "M": 12, "W": 52}
    grp = grp[grp["n"] >= grp["ptype"].map(need)]
    grp = grp[grp["year"] < today.year]
    grp["prio_res"] = grp["ptype"].map({"Y": 0, "M": 1, "W": 2})
    grp["prio_def"] = grp["cdef"].map(DENGUE_PRIORITY)
    grp = grp.sort_values(["ISO_A0", "adm_1_name", "year", "prio_def", "prio_res", "value"], ascending=[True, True, True, True, True, False])
    best = grp.groupby(["ISO_A0", "adm_1_name", "year"], as_index=False).first()
    return best.rename(columns={"ISO_A0": "iso3", "adm_1_name": "name"})[["iso3", "name", "year", "value", "ptype", "detail"]]


def read_admin1_shapes(content: bytes) -> list[dict]:
    """Natural Earth admin-1 records with their geometry (unsimplified)."""
    import shapefile  # pyshp

    with zipfile.ZipFile(io.BytesIO(content)) as z:
        names = z.namelist()
        shp = next((n for n in names if n.endswith(".shp")), None)
        dbf = next((n for n in names if n.endswith(".dbf")), None)
        if not shp or not dbf:
            raise SchemaChange("Natural Earth admin-1: .shp/.dbf missing", expected=[".shp", ".dbf"], found=names)
        rd = shapefile.Reader(shp=io.BytesIO(z.read(shp)), dbf=io.BytesIO(z.read(dbf)), encoding="utf-8")
    fields = [f[0] for f in rd.fields[1:]]
    for need in ("adm1_code", "adm0_a3", "name"):
        if need not in fields:
            raise SchemaChange("Natural Earth admin-1: attribute missing", expected=[need], found=fields)
    out = []
    for sr in rd.iterShapeRecords():
        rec = dict(zip(fields, sr.record))
        if not rec.get("adm1_code") or not rec.get("name"):
            continue
        out.append({"code": rec["adm1_code"], "iso3": rec["adm0_a3"], "name": rec["name"],
                    "names": [str(rec[k]) for k in NAME_FIELDS if rec.get(k)], "geom": sr.shape.__geo_interface__})
    return out


def name_index(shapes: list[dict]) -> dict[str, dict[str, set[str]]]:
    """country -> folded name -> set of region codes. Also indexed without spaces ('chon buri' == 'chonburi')."""
    idx: dict[str, dict[str, set[str]]] = {}
    for s in shapes:
        c = idx.setdefault(s["iso3"], {})
        for raw in s["names"]:
            for part in raw.split("|"):
                f = fold(part)
                if f:
                    c.setdefault(f, set()).add(s["code"])
                    c.setdefault(f.replace(" ", ""), set()).add(s["code"])
    return idx


def match_name(iso3: str, name: str, idx: dict, aliases: dict) -> str | None:
    """Region code for a source name, or None. Only an exact folded match to a single region counts."""
    by_country = idx.get(iso3, {})
    reviewed = (aliases.get(iso3) or {}).get(name)
    if reviewed:
        hit = by_country.get(fold(reviewed)) or set()
        return next(iter(hit)) if len(hit) == 1 else None
    f = fold(name)
    for key in (f, f.replace(" ", "")):
        hit = by_country.get(key)
        if hit and len(hit) == 1:
            return next(iter(hit))
        if hit:
            return None  # ambiguous: two regions share this name
    return None


# ----------------------------------------------------------------------------- geometry

def _simplify(ring: list, tol: float) -> list:
    """Douglas-Peucker on one ring (iterative). Keeps the ring closed."""
    n = len(ring)
    if n < 6:
        return ring
    keep = [False] * n
    keep[0] = keep[n - 1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ax, ay = ring[a][0], ring[a][1]
        bx, by = ring[b][0], ring[b][1]
        dx, dy = bx - ax, by - ay
        den = dx * dx + dy * dy
        worst, wi = -1.0, -1
        for i in range(a + 1, b):
            px, py = ring[i][0], ring[i][1]
            if den == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / den))
                d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > worst:
                worst, wi = d, i
        if worst > tol * tol:
            keep[wi] = True
            stack.append((a, wi))
            stack.append((wi, b))
    return [p for p, k in zip(ring, keep) if k]


def _ring_area(ring: list) -> float:
    return abs(sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1] for i in range(len(ring) - 1))) / 2


def simplify_geometry(geom: dict, tol: float = 0.01, precision: int = 3, min_area: float = 4e-4) -> dict | None:
    """Simplify for a small web file: thin the outline, round coordinates, and drop islets too small to see
    (the largest polygon of a region is always kept)."""
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"] if geom["type"] == "MultiPolygon" else []
    done = []
    for poly in polys:
        rings = []
        for i, ring in enumerate(poly):
            r = [[round(p[0], precision), round(p[1], precision)] for p in _simplify([list(p[:2]) for p in ring], tol)]
            r = [p for j, p in enumerate(r) if j == 0 or p != r[j - 1]]
            if len(r) >= 4 and r[0] == r[-1]:
                rings.append(r)
            elif i == 0:
                break  # outer ring collapsed: drop the polygon
        if rings:
            done.append((_ring_area(rings[0]), rings))
    if not done:
        return None
    biggest = max(a for a, _ in done)
    kept = [r for a, r in done if a >= min_area or a == biggest]
    return {"type": "MultiPolygon", "coordinates": kept} if len(kept) > 1 else {"type": "Polygon", "coordinates": kept[0]}


# ----------------------------------------------------------------------------- product

def build_dengue_product(records: pd.DataFrame, shapes: list[dict], aliases: dict) -> dict:
    """Per-country region tables and boundaries. Pure function of its inputs (tested with small fixtures)."""
    idx = name_index(shapes)
    by_code = {s["code"]: s for s in shapes}
    countries, boundaries, unmatched = {}, {}, []
    for iso3, g in records.groupby("iso3", sort=True):
        years = list(range(int(g["year"].min()), int(g["year"].max()) + 1))
        yi = {y: i for i, y in enumerate(years)}
        units = []
        for name, u in g.groupby("name", sort=True):
            code = match_name(iso3, name, idx, aliases)
            vals: list = [None] * len(years)
            defs: list = [None] * len(years)
            res: list = [None] * len(years)
            for r in u.itertuples(index=False):
                vals[yi[r.year]] = float(r.value)
                defs[yi[r.year]] = r.detail
                res[yi[r.year]] = r.ptype
            units.append({"id": code, "name": by_code[code]["name"] if code else None, "name_in_source": name,
                          "values": vals, "definitions": defs, "resolution": res})
            if not code:
                unmatched.append(f"{iso3}: {name}")
        matched = [u for u in units if u["id"]]
        if not matched:
            continue  # nothing can be drawn for this country; its rows remain in the source, not on this site
        # Two source names can match one region (old and new spellings). If both report the same year the map
        # shows neither for that year, and says so, rather than choosing or adding them.
        seen: dict[tuple, int] = {}
        for u in matched:
            for i, v in enumerate(u["values"]):
                if v is not None:
                    seen[(u["id"], i)] = seen.get((u["id"], i), 0) + 1
        conflicts = sorted({f"{by_code[c]['name']} {years[i]}" for (c, i), n in seen.items() if n > 1})
        for u in matched:
            u["conflict_years"] = [years[i] for i, v in enumerate(u["values"]) if v is not None and seen[(u["id"], i)] > 1]
        feats = []
        for s in shapes:
            if s["iso3"] != iso3:
                continue
            geom = simplify_geometry(s["geom"])
            if geom:
                feats.append({"type": "Feature", "id": s["code"], "properties": {"id": s["code"], "name": s["name"], "iso3": iso3}, "geometry": geom})
        countries[iso3] = {"years": years, "units": units, "n_units": len(units), "n_matched": len(matched), "conflicts": conflicts}
        boundaries[iso3] = {"type": "FeatureCollection", "features": feats}
    return {"countries": countries, "boundaries": boundaries, "unmatched": sorted(unmatched)}


def run(registry: dict, offline: bool, now: dt.datetime, load, save, log) -> dict | None:
    """Fetch (or reuse), derive (or reuse the cached derivation) and return the product, or None on failure.

    On failure an issue is recorded and the caller keeps the last published files.
    """
    cfg = (load_yaml(CONFIG / "datasets.yaml").get("subnational") or {})
    if not cfg:
        return None
    try:
        data_ds, shape_ds = cfg["dengue_admin1"], cfg["boundaries_admin1"]
        f_data = _fetch(data_ds, registry, offline, now, load, save)
        f_shape = _fetch(shape_ds, registry, offline, now, load, save)
        if f_data is None or f_shape is None:
            log("subnational: no stored downloads and offline; skipped")
            return None
        aliases = load_yaml(CONFIG / "admin1_aliases.yaml").get("aliases") or {}
        key = {"data": f_data.raw_file_hash, "shapes": f_shape.raw_file_hash, "method": METHOD, "aliases": aliases, "year": now.year}
        cache_path = STATE / "subnational" / "dengue_admin1.json"
        cached = read_json(cache_path)
        if cached and cached.get("key") == key:
            product = cached["product"]
        else:
            log("subnational: deriving dengue by first-level region")
            records = parse_admin1_records(open(f_data.raw_path, "rb").read(), now.date())
            if len(records) < int(data_ds.get("expected_min_rows", 1)):
                raise SchemaChange(f"OpenDengue spatial extract: only {len(records)} region-years derived")
            product = build_dengue_product(records, read_admin1_shapes(open(f_shape.raw_path, "rb").read()), aliases)
            write_json(cache_path, {"key": key, "product": product})
        # Names a reviewer has already judged impossible to draw are not reported again; only new names are.
        reviewed = {f"{c}: {n}" for c, groups in (load_yaml(CONFIG / "admin1_aliases.yaml").get("not_mappable") or {}).items()
                    for names in groups.values() for n in names}
        pending = [u for u in product["unmatched"] if u not in reviewed]
        if pending:
            record_issue("unmatched-region", "Region names without a matching boundary",
                         "These first-level region names from OpenDengue did not match exactly one Natural Earth region of the "
                         "same country, so they are listed in the published tables but not drawn on maps. Add a reviewed "
                         "mapping to `config/admin1_aliases.yaml`, or list the name under `not_mappable` there (never guessed automatically):\n\n"
                         + "\n".join(f"- {u}" for u in pending), source_id="opendengue", dedupe_key="unmatched-regions")
        return {"dengue": {**product, "method": METHOD, "source_ids": ["opendengue", "naturalearth"],
                           "fetches": {"data": f_data.public(), "boundaries": f_shape.public()},
                           "release": data_ds.get("release"), "deep_link": data_ds.get("deep_link"), "generated_at": iso(now)}}
    except Exception as e:  # noqa: BLE001 - any failure here must not take the rest of the site down
        log("subnational failed:", type(e).__name__, e)
        record_issue("source-failure", "Subnational dengue data could not be built",
                     f"**Error:** {type(e).__name__}: {e}\n\n**Effect:** the last published subnational files stay live. "
                     "Nothing was changed automatically; a person needs to review.", source_id="opendengue", dedupe_key="subnational-dengue")
        return None
