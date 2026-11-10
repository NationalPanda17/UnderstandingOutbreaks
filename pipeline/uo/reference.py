"""Reference data: countries (ISO 3166), population, boundaries, and the offline gazetteer.

All reference data carries provenance like any other record. Nothing here calls a geocoding service.
"""
from __future__ import annotations

import csv
import io
import json
import math
import zipfile
from collections import defaultdict

from .core import Fetch, SchemaChange, archive_raw, http_get, load_yaml, CONFIG

WHO_REGION_BY_CONTINENT = {"AF": "Africa", "AS": "Asia", "EU": "Europe", "NA": "North America", "SA": "South America",
                           "OC": "Oceania", "AN": "Antarctica"}


def fetch_reference(registry: dict) -> dict[str, Fetch]:
    out = {}
    for ds in load_yaml(CONFIG / "datasets.yaml")["reference"]:
        content, headers = http_get(ds["url"])
        out[ds["id"]] = archive_raw(ds, registry, ds["url"], content, headers)
    return out


def parse_countryinfo(content: bytes) -> list[dict]:
    rows = []
    for line in content.decode("utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        p = line.split("\t")
        if len(p) < 18:
            raise SchemaChange("GeoNames countryInfo: unexpected column count", expected=["19 tab columns"], found=[str(len(p))])
        rows.append({"iso2": p[0], "iso3": p[1], "name": p[4], "capital": p[5], "area_km2": float(p[6] or 0),
                     "continent": p[8], "neighbours_iso2": [n for n in p[17].split(",") if n]})
    return rows


def parse_worldbank_population(content: bytes) -> dict[str, dict]:
    doc = json.loads(content)
    if not isinstance(doc, list) or len(doc) < 2 or not isinstance(doc[1], list):
        raise SchemaChange("World Bank: expected [meta, rows]", expected=["[meta, rows]"], found=[type(doc).__name__])
    out = {}
    for r in doc[1]:
        iso3, v = r.get("countryiso3code"), r.get("value")
        if iso3 and v is not None and len(iso3) == 3:
            out[iso3] = {"population": int(v), "year": int(r["date"])}
    return out


def _ring_area_centroid(ring: list) -> tuple[float, float, float]:
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        cr = x0 * y1 - x1 * y0
        a += cr
        cx += (x0 + x1) * cr
        cy += (y0 + y1) * cr
    if abs(a) < 1e-12:
        xs, ys = [p[0] for p in ring], [p[1] for p in ring]
        return 0.0, sum(xs) / len(xs), sum(ys) / len(ys)
    return a / 2, cx / (3 * a), cy / (3 * a)


def polygon_centroid(geom: dict) -> tuple[float, float]:
    """Centroid of the largest polygon part (planar approximation; adequate for a country label point)."""
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    best = (0.0, 0.0, 0.0)
    for poly in polys:
        a, x, y = _ring_area_centroid([tuple(p[:2]) for p in poly[0]])
        if abs(a) >= abs(best[0]):
            best = (a, x, y)
    return round(best[1], 3), round(best[2], 3)


def parse_natural_earth(content: bytes, precision: int = 2) -> dict:
    """Read the Natural Earth admin-0 shapefile into a compact GeoJSON keyed by ISO 3166-1 alpha-3."""
    import shapefile  # pyshp

    with zipfile.ZipFile(io.BytesIO(content)) as z:
        names = z.namelist()
        shp = next((n for n in names if n.endswith(".shp")), None)
        dbf = next((n for n in names if n.endswith(".dbf")), None)
        if not shp or not dbf:
            raise SchemaChange("Natural Earth: .shp/.dbf missing", expected=[".shp", ".dbf"], found=names)
        rd = shapefile.Reader(shp=io.BytesIO(z.read(shp)), dbf=io.BytesIO(z.read(dbf)), encoding="utf-8")
    fields = [f[0] for f in rd.fields[1:]]
    for need in ("ADM0_A3", "ISO_A3_EH", "NAME"):
        if need not in fields:
            raise SchemaChange("Natural Earth: attribute missing", expected=[need], found=fields)
    feats = []
    for sr in rd.iterShapeRecords():
        rec = dict(zip(fields, sr.record))
        iso3 = rec["ISO_A3_EH"] if rec["ISO_A3_EH"] not in ("-99", "", None) else rec["ADM0_A3"]
        geom = sr.shape.__geo_interface__

        def rnd(c):
            if isinstance(c[0], (int, float)):
                return [round(c[0], precision), round(c[1], precision)]
            return [rnd(x) for x in c]

        def dedupe(ring):
            out = [ring[0]]
            for p in ring[1:]:
                if p != out[-1]:
                    out.append(p)
            return out

        coords = rnd(geom["coordinates"])
        if geom["type"] == "Polygon":
            coords = [dedupe(r) for r in coords]
            coords = [r for r in coords if len(r) >= 4]
        else:
            coords = [[dedupe(r) for r in poly] for poly in coords]
            coords = [[r for r in poly if len(r) >= 4] for poly in coords]
            coords = [p for p in coords if p]
        if not coords:
            continue
        g = {"type": geom["type"], "coordinates": coords}
        feats.append({"type": "Feature", "id": iso3, "properties": {"iso3": iso3, "name": rec["NAME"]}, "geometry": g})
    return {"type": "FeatureCollection", "features": feats}


def build_places(countryinfo: list[dict], population: dict, boundaries: dict) -> dict[str, dict]:
    iso2to3 = {c["iso2"]: c["iso3"] for c in countryinfo}
    cent = {f["id"]: polygon_centroid(f["geometry"]) for f in boundaries["features"]}
    places = {}
    for c in countryinfo:
        if not c["iso3"]:
            continue
        pop = population.get(c["iso3"], {})
        places[c["iso3"]] = {
            "iso3": c["iso3"], "iso2": c["iso2"], "name": c["name"], "continent": c["continent"],
            "region": WHO_REGION_BY_CONTINENT.get(c["continent"], "Other"),
            "population": pop.get("population"), "population_year": pop.get("year"),
            "area_km2": c["area_km2"] or None,
            "centroid": list(cent[c["iso3"]]) if c["iso3"] in cent else None,
            "neighbours": sorted(iso2to3[n] for n in c["neighbours_iso2"] if n in iso2to3),
            "on_map": c["iso3"] in cent,
        }
    return places


def build_ref(places: dict) -> dict:
    return {"iso2_to_iso3": {p["iso2"]: p["iso3"] for p in places.values()}, "iso3_set": set(places)}


# ----------------------------------------------------------------------------- gazetteer for offline geocoding

def parse_admin1(content: bytes) -> list[dict]:
    out = []
    for line in content.decode("utf-8").splitlines():
        p = line.split("\t")
        if len(p) < 4:
            continue
        iso2, code = p[0].split(".", 1)
        out.append({"iso2": iso2, "code": code, "name": p[1], "ascii": p[2], "geonameid": p[3]})
    return out


def parse_cities(content: bytes) -> list[dict]:
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        name = next(n for n in z.namelist() if n.endswith(".txt"))
        text = z.read(name).decode("utf-8")
    out = []
    for p in csv.reader(io.StringIO(text), delimiter="\t", quoting=csv.QUOTE_NONE):
        if len(p) < 15:
            raise SchemaChange("GeoNames cities: unexpected column count", expected=["19 tab columns"], found=[str(len(p))])
        out.append({"geonameid": p[0], "name": p[1], "ascii": p[2], "lat": float(p[4]), "lon": float(p[5]),
                    "iso2": p[8], "admin1": p[10], "population": int(p[14] or 0)})
    return out


def build_gazetteer(places: dict, admin1: list[dict], cities: list[dict]) -> dict:
    """Country, admin-1 and city lookup tables.

    Admin-1 coordinates are site-derived: the population-weighted mean position of GeoNames cities (>=15,000
    people) in that admin-1 unit (method ``admin1_centroid_from_cities`` v1). Units with no such city get no
    coordinate and can only be located at country precision.
    """
    iso2to3 = {p["iso2"]: p["iso3"] for p in places.values()}
    acc = defaultdict(lambda: [0.0, 0.0, 0.0, 0])
    for c in cities:
        w = max(c["population"], 1)
        k = (c["iso2"], c["admin1"])
        a = acc[k]
        a[0] += c["lon"] * w
        a[1] += c["lat"] * w
        a[2] += w
        a[3] += 1
    g_admin1 = defaultdict(list)
    for a in admin1:
        iso3 = iso2to3.get(a["iso2"])
        k = (a["iso2"], a["code"])
        if not iso3 or k not in acc:
            continue
        lon, lat, w, n = acc[k]
        g_admin1[iso3].append({"name": a["name"], "ascii": a["ascii"], "code": f"{a['iso2']}.{a['code']}",
                               "geonameid": a["geonameid"], "lon": round(lon / w, 3), "lat": round(lat / w, 3), "n_cities": n})
    g_city = defaultdict(list)
    for c in cities:
        iso3 = iso2to3.get(c["iso2"])
        if iso3 and c["population"] >= 100_000:
            g_city[iso3].append({"name": c["name"], "ascii": c["ascii"], "geonameid": c["geonameid"],
                                 "lon": round(c["lon"], 3), "lat": round(c["lat"], 3), "population": c["population"]})
    return {"admin1": dict(g_admin1), "cities": dict(g_city)}


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))
