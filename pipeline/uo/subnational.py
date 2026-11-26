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
NNDSS_METHOD = {"name": "nndss_state_year_end", "version": "1", "new_york": "state = New York + New York City"}
# Flags in the weekly tables: "-" is "no reported cases" (a zero). Every other flag means no figure is available.
NNDSS_ZERO_FLAGS = {"-"}
RKI_METHOD = {"name": "rki_state_calendar_year", "version": "1", "age_group": "00+", "year": "ISO-week year, complete years only"}
RKI_ALL_AGES, RKI_NATIONAL_ID = "00+", "00"
UKHSA_METHOD = {"name": "ukhsa_region_onset_year", "version": "1", "year": "ISO-week year of symptom onset, complete years only",
                "boundaries": "Natural Earth areas of England combined into its nine regions"}
NYC, NY_REST = "New York City", "New York"
NAME_FIELDS = ("name", "name_alt", "name_local", "gn_name", "woe_name", "name_en", "gns_name", "abbrev", "postal")
GENERIC = r"\b(province|state|region|department|departamento|provincia|estado|prefecture|governorate|district|city|municipality|of|de|del|la|el)\b"


def fold(s: str) -> str:
    """Case-, accent- and punctuation-insensitive form of a region name, without generic words such as 'province'."""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(GENERIC, " ", s)
    return re.sub(r"\s+", " ", s).strip()


# ----------------------------------------------------------------------------- fetching

def _fetch(ds: dict, registry: dict, offline: bool, now: dt.datetime, load, save, get=None) -> Fetch | None:
    """Reuse the stored fetch unless it is older than refresh_days; returns None only when offline with nothing stored."""
    old = (load(ds["id"]) or [None])[0]
    if old is not None:
        age = (now - dt.datetime.fromisoformat(old.retrieved_at.replace("Z", "+00:00"))).days
        if offline or age < int(ds.get("refresh_days", 30)):
            return old
    if offline:
        return None
    content, headers = (get(ds), {}) if get else http_get(ds["url"], timeout=600)
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


def parse_nndss_records(content: bytes, today: dt.date, labels: list[str]) -> pd.DataFrame:
    """One value per (US reporting area, year): the cumulative year-to-date count at the last week of that year.

    The weekly tables are provisional and are published as they stood each week, so the figure for a year is what
    had been reported by its final week, not a later corrected total. Several labels (measles: imported and
    indigenous) are added together, and only when every one of them has a figure. The current year is left out.
    Rows for regions of the country and for the national total are not used: only rows for one reporting area.
    """
    import json as _json
    rows = _json.loads(content)
    need = {"states", "year", "week", "label", "location1"}
    if not isinstance(rows, list) or not rows or not need <= set().union(*(r.keys() for r in rows[:200])):
        raise SchemaChange("NNDSS weekly data: expected rows with states, year, week, label, location1",
                           expected=sorted(need), found=sorted(rows[0].keys()) if isinstance(rows, list) and rows else [])
    recs = []
    for r in rows:
        if r.get("label") not in labels or not r.get("location1"):
            continue
        year, week = int(r["year"]), int(r["week"])
        if year >= today.year:
            continue
        if r.get("m3") not in (None, ""):
            value = float(r["m3"])
        elif str(r.get("m3_flag", "")).strip() in NNDSS_ZERO_FLAGS:
            value = 0.0
        else:
            value = None
        name = str(r["location1"]).strip()
        if name.isupper():  # earlier years are in capitals: the same area must not appear twice
            name = name.title().replace(" Of ", " of ").replace("U.s.", "U.S.")
        recs.append({"name": name, "year": year, "week": week, "label": r["label"], "value": value})
    df = pd.DataFrame(recs, columns=["name", "year", "week", "label", "value"])
    if df.empty:
        return pd.DataFrame(columns=["iso3", "name", "year", "value", "ptype", "detail"])
    last = df.groupby("year")["week"].transform("max")
    df = df[(df["week"] == last) & (last >= 52)]
    out = []
    for (name, year), g in df.groupby(["name", "year"], sort=True):
        if set(g["label"]) != set(labels) or g["value"].isna().any():
            continue  # a label missing or without a figure: no total is published for this area and year
        out.append({"iso3": "USA", "name": name, "year": int(year), "value": float(g["value"].sum()), "ptype": "W",
                    "detail": f"provisional notified cases, cumulative to week {int(g['week'].iloc[0])} as then published"
                              + (f" ({' + '.join(labels)})" if len(labels) > 1 else "")})
    # New York City reports separately from the rest of New York State. The state's figure is the two added together,
    # and only when both are present; neither is shown on its own, because neither is the state.
    by = {(o["name"], o["year"]): o for o in out}
    out = [o for o in out if o["name"] not in (NYC, NY_REST)]
    for (name, year), rest in sorted(by.items()):
        if name == NY_REST and (NYC, year) in by:
            out.append({**rest, "value": rest["value"] + by[(NYC, year)]["value"], "detail": rest["detail"] + "; New York City, reported separately, is included"})
    return pd.DataFrame(out, columns=["iso3", "name", "year", "value", "ptype", "detail"])


def parse_rki_flu_records(content: bytes, today: dt.date) -> pd.DataFrame:
    """One value per (German federal state, year): laboratory-confirmed influenza cases notified in that year.

    The file gives cases per reporting week (ISO 8601), state and age group. The row for all ages (``00+``) is added
    up over the weeks of each ISO-week year. The file has no rows with zero cases: a week without a row for a state is
    a week in which no case was notified there. A year is used only when the national row is present for every one
    of its weeks, which shows the file covers that year in full; the national row itself is not published here, and
    the current year is left out, so a partial year is never shown as a total.
    """
    import csv
    rows = list(csv.DictReader(io.StringIO(content.decode("utf-8-sig")), delimiter="\t"))
    need = {"Meldewoche", "Region", "Region_Id", "Altersgruppe", "Fallzahl"}
    if not rows or not need <= set(rows[0]):
        raise SchemaChange("RKI influenza cases: expected columns Meldewoche, Region, Region_Id, Altersgruppe, Fallzahl",
                           expected=sorted(need), found=sorted(rows[0]) if rows else [])
    recs, national = [], {}
    for r in rows:
        if r["Altersgruppe"] != RKI_ALL_AGES or r["Region_Id"] in ("NA", ""):
            continue
        m = re.fullmatch(r"(\d{4})-W(\d{2})", r["Meldewoche"].strip())
        if not m:
            raise SchemaChange(f"RKI influenza cases: unreadable week {r['Meldewoche']!r}")
        year, week = int(m.group(1)), int(m.group(2))
        if year >= today.year:
            continue
        if r["Region_Id"] == RKI_NATIONAL_ID:
            national.setdefault(year, set()).add(week)
        else:
            recs.append({"name": r["Region"].strip(), "year": year, "week": week, "value": float(r["Fallzahl"])})
    full = {y for y, weeks in national.items() if weeks == set(range(1, dt.date(y, 12, 28).isocalendar()[1] + 1))}
    df = pd.DataFrame(recs, columns=["name", "year", "week", "value"])
    out = []
    for (name, year), g in df.groupby(["name", "year"], sort=True):
        if int(year) not in full or g["week"].duplicated().any():
            continue
        weeks = dt.date(int(year), 12, 28).isocalendar()[1]
        out.append({"iso3": "DEU", "name": name, "year": int(year), "value": float(g["value"].sum()), "ptype": "W",
                    "detail": f"laboratory-confirmed cases notified in reporting weeks 1 to {weeks}, all ages"})
    return pd.DataFrame(out, columns=["iso3", "name", "year", "value", "ptype", "detail"])


def parse_ukhsa_region_records(content: bytes, today: dt.date) -> pd.DataFrame:
    """One value per (English region, year): measles cases by week of symptom onset, added up over a complete year.

    ``content`` is the JSON this site stores from the UKHSA data dashboard API: ``{"regions": {name: [rows]}}``, the
    weekly rows of one metric for each UKHSA region. Each row is one week (its date is the Monday) for all ages and
    both sexes; weeks without cases are present with a value of zero. A year is used only when every ISO week of it
    is present exactly once and none is flagged as still within the reporting delay. The current year is left out.
    """
    import json as _json
    doc = _json.loads(content)
    regions = doc.get("regions") if isinstance(doc, dict) else None
    if not isinstance(regions, dict) or not regions:
        raise SchemaChange("UKHSA measles by region: expected {'regions': {name: [rows]}}", expected=["regions"],
                           found=sorted(doc) if isinstance(doc, dict) else [type(doc).__name__])
    need = {"date", "metric_value", "age", "sex", "in_reporting_delay_period"}
    out = []
    for name, rows in sorted(regions.items()):
        if rows and not need <= set(rows[0]):
            raise SchemaChange("UKHSA measles by region: row fields missing", expected=sorted(need), found=sorted(rows[0]))
        by_year: dict[int, list] = {}
        for r in rows:
            if r.get("age") != "all" or r.get("sex") != "all" or r.get("stratum", "default") != "default":
                continue
            y, w, _ = dt.date.fromisoformat(str(r["date"])[:10]).isocalendar()
            by_year.setdefault(y, []).append((w, r["metric_value"], bool(r["in_reporting_delay_period"])))
        for year, got in sorted(by_year.items()):
            weeks = dt.date(year, 12, 28).isocalendar()[1]
            if year >= today.year or sorted(w for w, _, _ in got) != list(range(1, weeks + 1)):
                continue
            if any(delay or v is None for _, v, delay in got):
                continue
            out.append({"iso3": "GBR", "name": name, "year": year, "value": float(sum(v for _, v, _ in got)), "ptype": "W",
                        "detail": f"laboratory-confirmed cases by week of symptom onset, weeks 1 to {weeks}, all ages"})
    return pd.DataFrame(out, columns=["iso3", "name", "year", "value", "ptype", "detail"])


def dissolve(geoms: list[dict]) -> dict:
    """One outline for several neighbouring areas: borders that two of the areas share are removed.

    Works on exact coordinates. An edge that appears once in each direction is an internal border and is dropped; the
    edges left over are joined into rings. If they cannot all be joined (the areas do not share exact borders), the
    areas are returned side by side as one multi-polygon instead, which draws the same filled shape with its
    internal borders still visible. Rings are returned as separate polygons; holes are not reconstructed, which the
    fill rule of the map and of GeoJSON viewers handles for the island-and-enclave cases that occur here.
    """
    polys = [poly for g in geoms for poly in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]])]
    edges: dict[tuple, int] = {}
    for poly in polys:
        for ring in poly:
            pts = [tuple(pt[:2]) for pt in ring]
            for a_, b_ in zip(pts, pts[1:]):
                if a_ != b_:
                    edges[(a_, b_)] = edges.get((a_, b_), 0) + 1
    keep = [(a_, b_) for (a_, b_), n in edges.items() if (b_, a_) not in edges for _ in range(n)]
    nxt: dict[tuple, list] = {}
    for a_, b_ in keep:
        nxt.setdefault(a_, []).append(b_)
    rings = []
    while nxt:
        start = next(iter(nxt))
        ring, cur = [start], start
        while True:
            outs = nxt.get(cur)
            if not outs:
                return {"type": "MultiPolygon", "coordinates": [[[list(pt) for pt in r] for r in poly] for poly in polys]}
            b_ = outs.pop()
            if not outs:
                del nxt[cur]
            ring.append(b_)
            cur = b_
            if cur == start:
                break
        if len(ring) >= 4:
            rings.append([list(pt) for pt in ring])
    return {"type": "MultiPolygon", "coordinates": [[r] for r in rings]}


def group_shapes(shapes: list[dict], iso3: str, split_unit: str) -> list[dict]:
    """Regions of one country built by combining boundary areas that the boundary file itself assigns to them.

    Areas in the part of the country named ``split_unit`` (England) are combined by the file's own ``region``
    attribute; the other parts (Scotland, Wales, Northern Ireland) each become one shape, so the map shows them as
    areas without data rather than leaving them off. Nothing is assigned by this site: an area with no region
    attribute is left out and reported by the caller through the unmatched names.
    """
    groups: dict[tuple, list] = {}
    for s in shapes:
        if s["iso3"] != iso3 or not s.get("unit"):
            continue
        key = (s["unit"], s["group"]) if s["unit"] == split_unit else (s["unit"], "")
        if s["unit"] == split_unit and not s["group"]:
            continue
        groups.setdefault(key, []).append(s)
    out = []
    for (unit, group), members in sorted(groups.items()):
        name = group or unit
        code = f"{iso3}-G-" + re.sub(r"[^a-z0-9]+", "-", fold(name)).strip("-")
        out.append({"code": code, "iso3": iso3, "name": name, "names": [name], "geom": dissolve([m["geom"] for m in members]),
                    "unit": unit, "group": group, "n_members": len(members)})
    return out


def _ukhsa_get(ds: dict) -> bytes:
    """All weekly rows of one metric for every UKHSA region, as one JSON document (the API serves them in pages)."""
    import json as _json
    from urllib.parse import quote
    base = ds["url"].rstrip("/")
    listing, _ = http_get(base + "/geographies", timeout=120)
    names = [g["name"] for g in _json.loads(listing)]
    if not names:
        raise SchemaChange("UKHSA measles by region: the API lists no regions")
    regions = {}
    for name in names:
        url = f"{base}/geographies/{quote(name)}/metrics/{ds['metric']}?page_size=365"
        rows: list = []
        for _ in range(20):
            page = _json.loads(http_get(url, timeout=120)[0])
            rows += page.get("results") or []
            url = page.get("next")
            if not url:
                break
        else:
            raise SchemaChange(f"UKHSA measles by region: too many pages for {name}")
        regions[name] = sorted(rows, key=lambda r: str(r.get("date")))
    return _json.dumps({"metric": ds["metric"], "regions": regions}, sort_keys=True, separators=(",", ":")).encode()


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
                    "names": [str(rec[k]) for k in NAME_FIELDS if rec.get(k)], "geom": sr.shape.__geo_interface__,
                    "unit": str(rec.get("geonunit") or ""), "group": str(rec.get("region") or "")})
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
        # the region's own name, kept apart: a reviewed alias that two regions answer to (the state of Washington and
        # Washington, D.C.) is settled in favour of the region whose own name it is
        c.setdefault("=primary", {}).setdefault(fold(s["name"]), set()).add(s["code"])  # type: ignore[union-attr]
    return idx


def match_name(iso3: str, name: str, idx: dict, aliases: dict) -> str | None:
    """Region code for a source name, or None. Only an exact folded match to a single region counts."""
    by_country = idx.get(iso3, {})
    reviewed = (aliases.get(iso3) or {}).get(name)
    if reviewed:
        hit = by_country.get(fold(reviewed)) or set()
        if len(hit) > 1:
            hit = (by_country.get("=primary") or {}).get(fold(reviewed)) or set()
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


def _nndss_products(cfg: dict, registry: dict, offline: bool, now: dt.datetime, load, save, log, f_shape: Fetch, aliases: dict, reviewed: set) -> dict:
    """US state products (one per disease) from the NNDSS weekly tables. A failure here never affects dengue: the
    last derived products are reused if there are any, and an issue is recorded."""
    ds = cfg.get("nndss_states")
    if not ds:
        return {}
    cache_path = STATE / "subnational" / "nndss_states.json"
    cached = read_json(cache_path)
    try:
        f = _fetch(ds, registry, offline, now, load, save)
        if f is None:
            return (cached or {}).get("products", {})
        key = {"data": f.raw_file_hash, "shapes": f_shape.raw_file_hash, "method": NNDSS_METHOD, "aliases": aliases, "year": now.year, "diseases": ds["diseases"]}
        if cached and cached.get("key") == key:
            return cached["products"]
        log("subnational: deriving US state figures from NNDSS")
        content = open(f.raw_path, "rb").read()
        shapes = [s for s in read_admin1_shapes(open(f_shape.raw_path, "rb").read()) if s["iso3"] == "USA"]
        products, total, pending = {}, 0, []
        for disease, labels in ds["diseases"].items():
            records = parse_nndss_records(content, now.date(), list(labels))
            total += len(records)
            if records.empty:
                continue
            prod = build_dengue_product(records, shapes, aliases)
            pending += [u for u in prod["unmatched"] if u not in reviewed]
            products[disease] = {**prod, "method": NNDSS_METHOD, "source_ids": [ds["source_id"], "naturalearth"],
                                 "fetches": {"data": f.public(), "boundaries": f_shape.public()}, "release": ds.get("release"),
                                 "deep_link": ds.get("deep_link"), "generated_at": iso(now),
                                 "note": "US CDC NNDSS weekly tables. Provisional counts, cumulative to the last week of each year as published that week; later corrections are not included."}
        if total < int(ds.get("expected_min_rows", 1)):
            raise SchemaChange(f"NNDSS weekly data: only {total} area-years derived")
        if pending:
            record_issue("unmatched-region", "US reporting areas without a matching boundary",
                         "These reporting areas in the NNDSS weekly tables did not match exactly one Natural Earth region of the "
                         "United States, so they are listed in the published tables but not drawn on maps. Add a reviewed mapping to "
                         "`config/admin1_aliases.yaml`, or list the name under `not_mappable` there (never guessed automatically):\n\n"
                         + "\n".join(f"- {u}" for u in sorted(set(pending))), source_id=ds["source_id"], dedupe_key="unmatched-us-areas")
        write_json(cache_path, {"key": key, "products": products})
        return products
    except Exception as e:  # noqa: BLE001 - never take dengue or the rest of the site down
        log("subnational (NNDSS) failed:", type(e).__name__, e)
        record_issue("source-failure", "US state figures could not be built",
                     f"**Error:** {type(e).__name__}: {e}\n\n**Effect:** the last derived US state figures stay live. "
                     "Nothing was changed automatically; a person needs to review.", source_id=ds.get("source_id"), dedupe_key="subnational-nndss")
        return (cached or {}).get("products", {})


def _rki_products(cfg: dict, registry: dict, offline: bool, now: dt.datetime, load, save, log, f_shape: Fetch, aliases: dict, reviewed: set) -> dict:
    """Influenza by German federal state, from the Robert Koch Institute's open data. A failure here never affects
    the other products: the last derived product is reused if there is one, and an issue is recorded."""
    ds = cfg.get("rki_flu_states")
    if not ds:
        return {}
    cache_path = STATE / "subnational" / "rki_flu_states.json"
    cached = read_json(cache_path)
    try:
        f = _fetch(ds, registry, offline, now, load, save)
        if f is None:
            return (cached or {}).get("products", {})
        key = {"data": f.raw_file_hash, "shapes": f_shape.raw_file_hash, "method": RKI_METHOD, "aliases": aliases, "year": now.year}
        if cached and cached.get("key") == key:
            return cached["products"]
        log("subnational: deriving influenza by German federal state")
        records = parse_rki_flu_records(open(f.raw_path, "rb").read(), now.date())
        if len(records) < int(ds.get("expected_min_rows", 1)):
            raise SchemaChange(f"RKI influenza cases: only {len(records)} state-years derived")
        shapes = [s for s in read_admin1_shapes(open(f_shape.raw_path, "rb").read()) if s["iso3"] == "DEU"]
        prod = build_dengue_product(records, shapes, aliases)
        pending = [u for u in prod["unmatched"] if u not in reviewed]
        if pending:
            record_issue("unmatched-region", "German federal states without a matching boundary",
                         "These names in the RKI influenza file did not match exactly one Natural Earth region of Germany, so they "
                         "are listed in the published tables but not drawn on maps. Add a reviewed mapping to "
                         "`config/admin1_aliases.yaml` (never guessed automatically):\n\n" + "\n".join(f"- {u}" for u in sorted(set(pending))),
                         source_id=ds["source_id"], dedupe_key="unmatched-de-states")
        products = {ds["disease"]: {**prod, "method": RKI_METHOD, "source_ids": [ds["source_id"], "naturalearth"],
                                    "fetches": {"data": f.public(), "boundaries": f_shape.public()}, "release": ds.get("release"),
                                    "deep_link": ds.get("deep_link"), "generated_at": iso(now),
                                    "note": "Robert Koch Institute. Laboratory-confirmed influenza cases notified under the German Infection Protection Act, "
                                            "added up over the reporting weeks of each complete year. Counts depend on how much testing is done."}}
        write_json(cache_path, {"key": key, "products": products})
        return products
    except Exception as e:  # noqa: BLE001 - never take the other products or the rest of the site down
        log("subnational (RKI) failed:", type(e).__name__, e)
        record_issue("source-failure", "German state influenza figures could not be built",
                     f"**Error:** {type(e).__name__}: {e}\n\n**Effect:** the last derived figures stay live. "
                     "Nothing was changed automatically; a person needs to review.", source_id=ds.get("source_id"), dedupe_key="subnational-rki")
        return (cached or {}).get("products", {})


def _ukhsa_products(cfg: dict, registry: dict, offline: bool, now: dt.datetime, load, save, log, f_shape: Fetch, aliases: dict, reviewed: set) -> dict:
    """Measles by English region, from the UKHSA data dashboard. A failure here never affects the other products."""
    ds = cfg.get("ukhsa_measles_regions")
    if not ds:
        return {}
    cache_path = STATE / "subnational" / "ukhsa_measles_regions.json"
    cached = read_json(cache_path)
    try:
        f = _fetch(ds, registry, offline, now, load, save, get=_ukhsa_get)
        if f is None:
            return (cached or {}).get("products", {})
        key = {"data": f.raw_file_hash, "shapes": f_shape.raw_file_hash, "method": UKHSA_METHOD, "aliases": aliases, "year": now.year}
        if cached and cached.get("key") == key:
            return cached["products"]
        log("subnational: deriving measles by English region")
        records = parse_ukhsa_region_records(open(f.raw_path, "rb").read(), now.date())
        if len(records) < int(ds.get("expected_min_rows", 1)):
            raise SchemaChange(f"UKHSA measles by region: only {len(records)} region-years derived")
        shapes = group_shapes(read_admin1_shapes(open(f_shape.raw_path, "rb").read()), "GBR", "England")
        prod = build_dengue_product(records, shapes, aliases)
        pending = [u for u in prod["unmatched"] if u not in reviewed]
        if pending:
            record_issue("unmatched-region", "English regions without a matching boundary",
                         "These region names in the UKHSA measles data did not match exactly one region built from the Natural Earth "
                         "areas of England, so they are listed in the published tables but not drawn on maps. Add a reviewed mapping "
                         "to `config/admin1_aliases.yaml` (never guessed automatically):\n\n" + "\n".join(f"- {u}" for u in sorted(set(pending))),
                         source_id=ds["source_id"], dedupe_key="unmatched-en-regions")
        products = {ds["disease"]: {**prod, "method": UKHSA_METHOD, "source_ids": [ds["source_id"], "naturalearth"],
                                    "fetches": {"data": f.public(), "boundaries": f_shape.public()}, "release": ds.get("release"),
                                    "deep_link": ds.get("deep_link"), "generated_at": iso(now),
                                    "note": "UK Health Security Agency data dashboard. England only: laboratory-confirmed measles cases by week of symptom onset, "
                                            "added up over each complete year, for England's nine regions. Scotland, Wales and Northern Ireland "
                                            "are not in this source and are shown without data."}}
        write_json(cache_path, {"key": key, "products": products})
        return products
    except Exception as e:  # noqa: BLE001 - never take the other products or the rest of the site down
        log("subnational (UKHSA) failed:", type(e).__name__, e)
        record_issue("source-failure", "English region measles figures could not be built",
                     f"**Error:** {type(e).__name__}: {e}\n\n**Effect:** the last derived figures stay live. "
                     "Nothing was changed automatically; a person needs to review.", source_id=ds.get("source_id"), dedupe_key="subnational-ukhsa")
        return (cached or {}).get("products", {})


def add_products(out: dict, more: dict) -> None:
    """Add products to ``out`` (disease -> list of products). Two sources can cover one disease in different countries."""
    for disease, prod in more.items():
        out.setdefault(disease, []).append(prod)


def run(registry: dict, offline: bool, now: dt.datetime, load, save, log) -> dict | None:
    """Fetch (or reuse), derive (or reuse the cached derivation) and return {disease: [products]}, or None on failure.

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
        out: dict = {}
        add_products(out, {"dengue": {**product, "method": METHOD, "source_ids": ["opendengue", "naturalearth"],
                                      "fetches": {"data": f_data.public(), "boundaries": f_shape.public()},
                                      "release": data_ds.get("release"), "deep_link": data_ds.get("deep_link"), "generated_at": iso(now)}})
        for build in (_nndss_products, _rki_products, _ukhsa_products):
            add_products(out, build(cfg, registry, offline, now, load, save, log, f_shape, aliases, reviewed))
        return out
    except Exception as e:  # noqa: BLE001 - any failure here must not take the rest of the site down
        log("subnational failed:", type(e).__name__, e)
        record_issue("source-failure", "Subnational dengue data could not be built",
                     f"**Error:** {type(e).__name__}: {e}\n\n**Effect:** the last published subnational files stay live. "
                     "Nothing was changed automatically; a person needs to review.", source_id="opendengue", dedupe_key="subnational-dengue")
        return None
