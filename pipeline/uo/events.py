"""Event-based outbreak reports: connectors, disease normalization, offline geocoding, grouping, status, ranking.

Design rules enforced here:
  * a disease is never guessed: unmapped names go to "other" and raise a GitHub issue;
  * locations come only from the project's own gazetteer, and carry an explicit precision;
  * status words ("ongoing", "declared over") are used only when the source text says so;
  * counts are taken only from the notice text, with the exact quoted phrase kept next to them;
  * source text is not redistributed: only titles, links, and short quoted phrases are published.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import html
import json
import math
import re
import unicodedata
import xml.etree.ElementTree as ET

from .core import Fetch, PipelineError, SchemaChange, archive_raw, http_get

RANK_METHOD = {"name": "active_rank", "version": "1",
               "weights": {"recency": 0.45, "cases": 0.25, "deaths": 0.10, "countries": 0.10, "source_type": 0.10},
               "recency_half_scale_days": 30, "active_window_days": 180}
GROUP_METHOD = {"name": "group_by_disease_place_gap", "version": "1", "max_gap_days": 120}
GEOCODE_METHOD = {"name": "gazetteer_match", "version": "1"}
SUMMARY_METHOD = {"name": "template_summary", "version": "1"}
COUNT_METHOD = {"name": "regex_count_extraction", "version": "1"}
NO_RECENT_UPDATE_DAYS = 90
ADMIN_WORDS = r"(?:Province|Region|State|District|County|Governorate|Department|Prefecture|Oblast|Division|Zone|Territory)"


def strip_html(s: str | None) -> str:
    if not s:
        return ""
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", s, flags=re.S | re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def fold(s: str) -> str:
    """Lower-case, strip accents and normalise punctuation for matching."""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").lower()
    s = s.replace("’", "'").replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", s).strip()


# ----------------------------------------------------------------------------- connectors

def fetch_who_don(ds: dict, registry: dict) -> list[Fetch]:
    base = ds["url"].format(start=ds["start"])
    out, skip, top = [], 0, 100
    while True:
        url = f"{base}&$top={top}&$skip={skip}"
        content, headers = http_get(url)
        out.append(archive_raw(ds, registry, url, content, headers, part=f"s{skip}"))
        try:
            n = len(json.loads(content).get("value", []))
        except json.JSONDecodeError as e:
            raise SchemaChange(f"WHO DON: response is not JSON: {e}")
        if n < top:
            break
        skip += top
        if skip > 10000:
            raise PipelineError("WHO DON: too many pages")
    return out


def parse_who_don(ds: dict, content: bytes, fetch_id: str) -> list[dict]:
    doc = json.loads(content)
    if "value" not in doc:
        raise SchemaChange("WHO DON: OData 'value' array missing", expected=["value"], found=list(doc))
    need = ["DonId", "Title", "PublicationDate", "UrlName", "Summary", "Overview"]
    out = []
    for r in doc["value"]:
        missing = [c for c in need if c not in r]
        if missing:
            raise SchemaChange("WHO DON: fields missing", expected=need, found=list(r))
        title = (r.get("OverrideTitle") if r.get("UseOverrideTitle") and r.get("OverrideTitle") else r["Title"]) or r["Title"]
        out.append({
            "report_id": f"who_don:{r['DonId'] or r['UrlName']}", "source_id": ds["source_id"], "dataset_id": ds["id"],
            "title": title.strip(), "url": ds["item_url"].format(UrlName=r["UrlName"]),
            "published": str(r["PublicationDate"])[:10], "last_modified": str(r.get("LastModified") or "")[:19],
            "text": (strip_html(r.get("Summary")) + " " + strip_html(r.get("Overview"))).strip(),
            "fetch_id": fetch_id, "raw_record_ref": f"DonId={r['DonId'] or r['UrlName']}", "countries_hint": None,
            "source_weight": ds.get("source_type_weight", 1.0),
        })
    return out


def fetch_cdc_travel(ds: dict, registry: dict) -> list[Fetch]:
    content, headers = http_get(ds["url"])
    return [archive_raw(ds, registry, ds["url"], content, headers)]


def parse_cdc_travel(ds: dict, content: bytes, fetch_id: str) -> list[dict]:
    try:
        root = ET.fromstring(content)
    except ET.ParseError as e:
        raise SchemaChange(f"CDC travel notices: feed is not XML: {e}")
    items = root.findall("./channel/item")
    if root.find("./channel") is None:
        raise SchemaChange("CDC travel notices: RSS channel missing", expected=["channel/item"], found=[root.tag])
    out = []
    for it in items:
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        pub = it.findtext("pubDate")
        if not title or not link or not pub:
            raise SchemaChange("CDC travel notices: item fields missing", expected=["title", "link", "pubDate"],
                               found=[c.tag for c in it])
        d = dt.datetime.strptime(pub.strip()[:25].strip(), "%a, %d %b %Y %H:%M:%S").date()
        desc = strip_html(it.findtext("description"))
        hint = None
        m = re.search(r"Country List\s*:\s*(.+?)(?:Country List\s*:|$)", desc)
        if m:
            hint = m.group(1).strip()
        text = re.split(r"Country List\s*:", desc)[0].strip()
        slug = link.rstrip("/").split("/")[-1]
        out.append({
            "report_id": f"cdc_travel:{slug}:{d.isoformat()}", "source_id": ds["source_id"], "dataset_id": ds["id"],
            "title": title, "url": link, "published": d.isoformat(), "last_modified": d.isoformat(),
            "text": text, "fetch_id": fetch_id, "raw_record_ref": f"guid={link};pubDate={d.isoformat()}",
            "countries_hint": hint, "source_weight": ds.get("source_type_weight", 0.6),
        })
    return out


# ----------------------------------------------------------------------------- disease normalization

class DiseaseNormalizer:
    """Declarative alias matching. The longest alias wins; nothing is inferred beyond the mapping table."""

    def __init__(self, diseases_doc: dict):
        self.alias: list[tuple[str, str, re.Pattern]] = []
        for d in diseases_doc["diseases"]:
            for a in d.get("aliases", []):
                f = fold(a)
                self.alias.append((f, d["id"], re.compile(r"(?<![a-z0-9])" + re.escape(f) + r"(?![a-z0-9])")))
        self.alias.sort(key=lambda x: -len(x[0]))
        # Names a person reviewed and left unclassified: exact match only, never mapped, never re-raised as an issue.
        self.reviewed_unclassified = {fold(n) for n in diseases_doc.get("reviewed_unclassified", [])}

    def normalize(self, text: str) -> tuple[str | None, str | None]:
        """Return (disease_id, matched_alias) or (None, None)."""
        f = fold(text)
        best = None
        for alias, did, rx in self.alias:
            m = rx.search(f)
            if m and (best is None or len(alias) > len(best[0]) or (len(alias) == len(best[0]) and m.start() < best[2])):
                best = (alias, did, m.start())
        return (best[1], best[0]) if best else (None, None)


def title_parts(title: str) -> tuple[str, str]:
    """Split a notice title into (disease part, place part). Handles 'X - Place', 'X in Place', 'Level N - X in Place'."""
    t = re.sub(r"^Level\s+\d\s*[-–]\s*", "", title.strip())
    t = re.sub(r"^(Alert|Watch|Warning)\s*[-–]\s*", "", t)
    for sep in (" – ", " - ", " — ", " | "):
        if sep in t:
            a, b = t.split(sep, 1)
            return a.strip(), b.strip()
    m = re.search(r"\s+in\s+(?=[A-Z])", t)
    if m:
        return t[:m.start()].strip(), t[m.end():].strip()
    return t, ""


# ----------------------------------------------------------------------------- geocoding (offline)

class Geocoder:
    def __init__(self, places: dict, aliases_doc: dict, gazetteer: dict):
        self.places = places
        self.gaz = gazetteer
        names: list[tuple[str, str]] = []
        for iso3, p in places.items():
            names.append((fold(p["name"]), iso3))
        for iso3, al in aliases_doc.get("aliases", {}).items():
            if iso3 in places:
                names += [(fold(a), iso3) for a in al]
        seen = {}
        for n, iso3 in names:
            seen.setdefault(n, iso3)
        self.country_names = sorted(seen.items(), key=lambda x: -len(x[0]))
        self.country_rx = [(iso3, re.compile(r"(?<![a-z])" + re.escape(n) + r"(?![a-z])")) for n, iso3 in self.country_names]

    def countries(self, text: str) -> list[str]:
        """ISO3 codes named in ``text``; longer names are matched first and masked so 'Guinea' cannot match inside 'Guinea-Bissau'."""
        f = fold(text)
        found: list[tuple[int, str]] = []
        for iso3, rx in self.country_rx:
            for m in list(rx.finditer(f)):
                found.append((m.start(), iso3))
                f = f[:m.start()] + "#" * (m.end() - m.start()) + f[m.end():]
        out = []
        for _, iso3 in sorted(found):
            if iso3 not in out:
                out.append(iso3)
        return out

    def locate(self, countries: list[str], text: str) -> list[dict]:
        """Derived locations with explicit precision. Sub-national matches need an administrative keyword next to the name."""
        locs = []
        ftext = fold(text)
        for iso3 in countries:
            p = self.places.get(iso3)
            if not p or not p.get("centroid"):
                locs.append({"iso3": iso3, "precision": "country", "lon": None, "lat": None, "name": p["name"] if p else iso3,
                             "method": GEOCODE_METHOD["name"], "method_version": GEOCODE_METHOD["version"],
                             "source_ids": ["geonames"], "note": "no boundary centroid available"})
                continue
            locs.append({"iso3": iso3, "precision": "country", "lon": p["centroid"][0], "lat": p["centroid"][1],
                         "name": p["name"], "method": GEOCODE_METHOD["name"], "method_version": GEOCODE_METHOD["version"],
                         "source_ids": ["naturalearth", "geonames"], "gazetteer_ref": f"country:{iso3}"})
            for a in self.gaz.get("admin1", {}).get(iso3, []):
                for nm in {fold(a["name"]), fold(a["ascii"])}:
                    if len(nm) < 5:
                        continue
                    aw = ADMIN_WORDS.lower()
                    if re.search(r"(?<![a-z])" + re.escape(nm) + r"\s+" + aw + r"(?![a-z])", ftext) or \
                            re.search(aw + r"\s+of\s+" + re.escape(nm) + r"(?![a-z])", ftext):
                        locs.append({"iso3": iso3, "precision": "admin1", "lon": a["lon"], "lat": a["lat"], "name": a["name"],
                                     "admin1_code": a["code"], "method": GEOCODE_METHOD["name"],
                                     "method_version": GEOCODE_METHOD["version"], "source_ids": ["geonames"],
                                     "gazetteer_ref": f"geonames:{a['geonameid']}",
                                     "note": "position is the population-weighted centre of listed cities in this unit"})
                        break
            for c in self.gaz.get("cities", {}).get(iso3, []):
                nm = fold(c["ascii"])
                if len(nm) < 5:
                    continue
                if re.search(r"(?:city|town|municipality) of " + re.escape(nm) + r"(?![a-z])", ftext) or \
                        re.search(r"(?<![a-z])" + re.escape(nm) + r" (?:city|town|municipality)(?![a-z])", ftext):
                    locs.append({"iso3": iso3, "precision": "point", "lon": c["lon"], "lat": c["lat"], "name": c["name"],
                                 "method": GEOCODE_METHOD["name"], "method_version": GEOCODE_METHOD["version"],
                                 "source_ids": ["geonames"], "gazetteer_ref": f"geonames:{c['geonameid']}",
                                 "note": "city named in the notice; the position is the city, not a case location"})
        return locs


# ----------------------------------------------------------------------------- counts, status (only what the text says)

NUM = r"(\d{1,3}(?:[,   ]\d{3})+|\d+)"
CASE_RX = re.compile(NUM + r"\s+((?:(?:laboratory[- ]confirmed|lab[- ]confirmed|confirmed|suspected|probable|cumulative|human|new|total|reported|and|or|,)\s+){0,5})cases\b", re.I)
DEATH_RX = re.compile(NUM + r"\s+((?:(?:confirmed|suspected|probable|related|associated|reported|and|or|,)\s+){0,3})deaths\b", re.I)
OVER_RX = re.compile(r"(declared (?:the )?(?:end|over)[^.;]{0,60}|outbreak (?:was|has been|is) declared over[^.;]{0,40}|end of the outbreak (?:was|has been) declared[^.;]{0,40})", re.I)
ONGOING_RX = re.compile(r"((?:outbreak|transmission|epidemic)[^.;]{0,30}\b(?:is|remains|are) ongoing|ongoing (?:outbreak|transmission|epidemic)[^.;]{0,40})", re.I)


def _to_int(s: str) -> int:
    return int(re.sub(r"[^\d]", "", s))


def _clip(text: str, a: int, b: int, max_words: int = 14) -> str:
    """A short quoted phrase around a match (never more than ``max_words`` words)."""
    words = text[a:b].split()
    return " ".join(words[:max_words])


def extract_counts(text: str) -> dict:
    """First stated case and death counts in the notice text, with the exact phrase and the stated definition."""
    out: dict = {}
    m = CASE_RX.search(text)
    if m:
        adj = m.group(2).lower()
        kinds = [k for k in ("confirmed", "probable", "suspected") if k in adj]
        cdef = kinds[0] if len(kinds) == 1 else ("notified" if len(kinds) > 1 else "unknown")
        out["cases"] = {"value": _to_int(m.group(1)), "case_definition": cdef, "quote": _clip(text, m.start(), m.end()),
                        "method": COUNT_METHOD["name"], "method_version": COUNT_METHOD["version"]}
    m = DEATH_RX.search(text)
    if m:
        out["deaths"] = {"value": _to_int(m.group(1)), "quote": _clip(text, m.start(), m.end()),
                         "method": COUNT_METHOD["name"], "method_version": COUNT_METHOD["version"]}
    return out


def status_from_text(text: str) -> tuple[str, str | None]:
    m = OVER_RX.search(text)
    if m:
        return "declared_over", _clip(text, m.start(), m.end())
    m = ONGOING_RX.search(text)
    if m:
        return "ongoing", _clip(text, m.start(), m.end())
    return "reported", None


# ----------------------------------------------------------------------------- normalize, group, rank

def normalize_reports(reports: list[dict], normalizer: DiseaseNormalizer, geocoder: Geocoder) -> tuple[list[dict], list[str]]:
    """Attach disease, countries, locations, counts and status to each report. Returns (reports, unmapped names)."""
    unmapped: list[str] = []
    for r in reports:
        dpart, ppart = title_parts(r["title"])
        did, alias = normalizer.normalize(dpart)
        if did is None:
            did, alias = normalizer.normalize(r["title"])
        if did is None:
            did = "other"
            if fold(dpart) not in normalizer.reviewed_unclassified:
                unmapped.append(dpart)
        r["disease"], r["disease_alias"], r["disease_name_in_source"] = did, alias, dpart
        countries = geocoder.countries(ppart) if ppart else []
        if not countries and r.get("countries_hint"):
            countries = geocoder.countries(r["countries_hint"])
        r["countries"] = countries
        r["scope"] = "country" if countries else "multi-country or global (no single country named in the title)"
        r["locations"] = geocoder.locate(countries, r["text"])
        r["counts"] = extract_counts(r["text"])
        r["status_stated"], r["status_quote"] = status_from_text(r["text"])
    return reports, sorted(set(unmapped))


def group_events(reports: list[dict], id_map: dict[str, str], today: dt.date) -> list[dict]:
    """Group reports of the same event (method ``group_by_disease_place_gap`` v1) and assign stable ids.

    Two reports belong together when they share a disease, name at least one common country (or both name
    none), and are no more than ``max_gap_days`` apart. 'other' diseases also need the same source wording.
    ``id_map`` (report_id -> event_id) persists between runs so ids never change once assigned.
    """
    groups: list[dict] = []
    for r in sorted(reports, key=lambda x: (x["published"], x["report_id"])):
        d = dt.date.fromisoformat(r["published"])
        matches = []
        for g in groups:
            if g["disease"] != r["disease"]:
                continue
            if (d - dt.date.fromisoformat(g["last_report"])).days > GROUP_METHOD["max_gap_days"]:
                continue
            if r["disease"] == "other" and fold(g["name_in_source"]) != fold(r["disease_name_in_source"]):
                continue
            if (set(g["countries"]) & set(r["countries"])) or (not g["countries"] and not r["countries"]):
                matches.append(g)
        target = matches[0] if matches else None
        for extra in matches[1:]:  # a notice naming places from two open groups joins them into the earlier one
            target["reports"] += extra["reports"]
            target["reports"].sort(key=lambda x: (x["published"], x["report_id"]))
            target["countries"] += [c for c in extra["countries"] if c not in target["countries"]]
            target["last_report"] = max(target["last_report"], extra["last_report"])
            groups.remove(extra)
        if target is None:
            target = {"disease": r["disease"], "countries": [], "reports": [], "first_report": r["published"],
                      "last_report": r["published"], "name_in_source": r["disease_name_in_source"]}
            groups.append(target)
        target["reports"].append(r)
        target["last_report"] = r["published"]
        for c in r["countries"]:
            if c not in target["countries"]:
                target["countries"].append(c)
    events = []
    used: set[str] = set()
    for g in groups:
        existing = [id_map[r["report_id"]] for r in g["reports"] if r["report_id"] in id_map]
        eid = next((e for e in existing if e not in used), None)
        if eid is None:
            first = g["reports"][0]
            place = (first["countries"][0] if first["countries"] else "multi").lower()
            h = hashlib.sha1(first["report_id"].encode()).hexdigest()[:6]
            eid = f"{g['disease'].replace('_', '-')}-{place}-{first['published'][:7].replace('-', '')}-{h}"
        used.add(eid)
        for r in g["reports"]:
            id_map[r["report_id"]] = eid
        events.append(build_event(eid, g, today))
    return events


def build_event(eid: str, g: dict, today: dt.date) -> dict:
    reps = g["reports"]
    latest = reps[-1]
    days = (today - dt.date.fromisoformat(g["last_report"])).days
    stated, quote = latest["status_stated"], latest["status_quote"]
    if stated == "declared_over":
        status, basis = "declared_over", "source-stated"
    elif days > NO_RECENT_UPDATE_DAYS:
        status, basis = "no_recent_update", "recency-indicator"
    else:
        status, basis = stated, "source-stated" if stated == "ongoing" else "source-published"
    latest_counts = next((r["counts"] for r in reversed(reps) if r["counts"]), {})
    counts_report = next((r for r in reversed(reps) if r["counts"]), None)
    locs, seen = [], set()
    for r in reps:
        for l in r["locations"]:
            k = (l["iso3"], l["precision"], l["name"])
            if k not in seen:
                seen.add(k)
                locs.append({**l, "report_id": r["report_id"]})
    qf = ["counts-extracted-automatically"] if latest_counts else ["no-counts-stated"]
    if g["disease"] == "other":
        qf.append("disease-unmapped")
    if not g["countries"]:
        qf.append("no-country-in-title")
    ev = {
        "event_id": eid, "disease": g["disease"], "name_in_source": g["name_in_source"], "pathogen": None,
        "countries": g["countries"], "locations": locs, "first_report": g["first_report"], "last_report": g["last_report"],
        "event_start_date": None, "status": status, "status_basis": basis, "status_quote": quote if status == stated else None,
        "days_since_last_report": days,
        "cases": ({**latest_counts["cases"], "as_of": counts_report["published"], "report_id": counts_report["report_id"]}
                  if "cases" in latest_counts else None),
        "deaths": ({**latest_counts["deaths"], "as_of": counts_report["published"], "report_id": counts_report["report_id"]}
                   if "deaths" in latest_counts else None),
        "source_ids": sorted({r["source_id"] for r in reps}), "quality_flags": qf, "origin_type": "site-derived",
        "methods": {"grouping": GROUP_METHOD, "geocoding": GEOCODE_METHOD, "summary": SUMMARY_METHOD, "counts": COUNT_METHOD},
        "reports": [{k: r[k] for k in ("report_id", "source_id", "dataset_id", "title", "url", "published", "last_modified",
                                       "fetch_id", "raw_record_ref", "countries", "counts", "status_stated", "status_quote",
                                       "disease_name_in_source")} | {"origin_type": "source-reported"} for r in reps],
        "source_weight": max(r["source_weight"] for r in reps),
    }
    ev["rank"] = rank_event(ev)
    return ev


def rank_event(ev: dict) -> dict:
    """Transparent ordering score for the active list (method ``active_rank`` v1). It orders a list; it is not a severity rating."""
    w = RANK_METHOD["weights"]
    comp = {
        "recency": math.exp(-ev["days_since_last_report"] / RANK_METHOD["recency_half_scale_days"]),
        "cases": min(1.0, math.log10(1 + ev["cases"]["value"]) / 5) if ev.get("cases") else 0.0,
        "deaths": min(1.0, math.log10(1 + ev["deaths"]["value"]) / 4) if ev.get("deaths") else 0.0,
        "countries": min(1.0, len(ev["countries"]) / 5),
        "source_type": ev["source_weight"],
    }
    score = sum(w[k] * comp[k] for k in w)
    active = ev["status"] != "declared_over" and ev["days_since_last_report"] <= RANK_METHOD["active_window_days"]
    return {"score": round(score, 4), "components": {k: round(v, 4) for k, v in comp.items()}, "active": active,
            "method": RANK_METHOD["name"], "method_version": RANK_METHOD["version"]}


def validate_events(reports: list[dict], prev_count: int) -> list[str]:
    problems = []
    if not reports:
        problems.append("no event reports parsed")
    ids = [r["report_id"] for r in reports]
    if len(ids) != len(set(ids)):
        problems.append("duplicate report ids")
    if prev_count and len(reports) - prev_count > max(50, 0.3 * prev_count):
        problems.append(f"sudden flood of new reports: {prev_count} -> {len(reports)}")
    if prev_count and len(reports) < 0.7 * prev_count:
        problems.append(f"report count fell from {prev_count} to {len(reports)}")
    return problems


def event_fingerprint(ev: dict) -> dict:
    return {"status": ev["status"], "cases": ev["cases"]["value"] if ev["cases"] else None,
            "deaths": ev["deaths"]["value"] if ev["deaths"] else None, "n_reports": len(ev["reports"]),
            "last_report": ev["last_report"], "countries": ev["countries"]}
