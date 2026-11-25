#!/usr/bin/env python3
"""List the outbreak notices whose figures a person should check, as a Markdown worksheet.

The site reads "N cases" and "N deaths" from a notice's text and labels every such reading as automated. It never
reads pictures, and many notices publish their per-country figures as a picture of a table. This script lists, from
the published event files, (1) notices that carry a table image and (2) automated readings nobody has reviewed yet,
with a ready-to-fill entry for ``config/count_reviews.yaml``. It changes nothing and fetches nothing.

    python scripts/count_review_queue.py [path/to/data/v1/events] > review-queue.md
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_events(folder: Path) -> list[dict]:
    out = []
    for f in sorted(folder.glob("*.json")):
        doc = json.loads(f.read_text())
        if isinstance(doc, dict) and "reports" in doc and "event_id" in doc:
            out.append(doc)
    return out


def queue(events: list[dict]) -> tuple[list[dict], list[dict]]:
    """(notices with a table image, unreviewed automated readings), newest notice first."""
    tables, readings = [], []
    for e in events:
        for r in e["reports"]:
            base = {"event_id": e["event_id"], "event": e.get("title", e["event_id"]), "report_id": r["report_id"], "title": r["title"],
                    "url": r["url"], "published": r["published"], "countries": r.get("countries") or []}
            if r.get("table_images"):
                tables.append({**base, "images": r["table_images"]})
            for field, c in (r.get("counts") or {}).items():
                if not c.get("review"):
                    readings.append({**base, "field": field, "country": None, "value": c["value"], "quote": c.get("quote", "")})
            for iso3, got in (r.get("country_counts") or {}).items():
                for field, c in got.items():
                    if not c.get("review"):
                        readings.append({**base, "field": field, "country": iso3, "value": c["value"], "quote": c.get("quote", "")})
    key = lambda x: (x["published"], x["report_id"])
    return sorted(tables, key=key, reverse=True), sorted(readings, key=key, reverse=True)


def render(tables: list[dict], readings: list[dict]) -> str:
    out = ["# Count review queue", "",
           "Generated from the published event files. Nothing here is on the site until a person adds an entry to",
           "`config/count_reviews.yaml`. Open each notice, compare, and copy the entry with your finding.", "",
           f"## Notices with a table published as a picture ({len(tables)})", "",
           "The site cannot read these. To add a figure from one, use `action: correct` with the `value` and, as `quote`,",
           "the table's own row and column wording.", ""]
    for t in tables:
        out += [f"### {t['published']} · {t['title']}", "", f"- Notice: <{t['url']}> (`{t['report_id']}`)",
                f"- Countries named in the title: {', '.join(t['countries']) or 'none'}"]
        out += [f"- Table: {i.get('label') or 'unlabelled'} — <{i['src']}>" for i in t["images"]]
        out += ["", "```yaml", f"- report_id: {t['report_id']}", "  field: cases            # cases | deaths",
                f"  country: {t['countries'][0] if t['countries'] else 'ISO3'}             # ISO3 code; omit for the notice's headline figure",
                "  action: correct", "  value: 0", '  quote: "Table 1, row …, column …"', '  reviewed: "YYYY-MM-DD"', "```", ""]
    out += [f"## Automated readings not yet reviewed ({len(readings)})", "",
            "| Published | Notice | Field | Country | Reading | The notice's words |", "|---|---|---|---|---|---|"]
    for r in readings:
        quote = r["quote"].replace("|", "\\|")
        out.append(f"| {r['published']} | [{r['report_id']}]({r['url']}) | {r['field']} | {r['country'] or '—'} | {r['value']} | {quote} |")
    out += ["", "To record a check, add for each row:", "", "```yaml", "- report_id: <id from the table>", "  field: cases",
            "  action: confirm          # or correct (with value) or reject", "  value: <the reading>", '  reviewed: "YYYY-MM-DD"', "```", ""]
    return "\n".join(out)


def main(argv: list[str]) -> int:
    folder = Path(argv[1]) if len(argv) > 1 else ROOT / "site" / "public" / "data" / "v1" / "events"
    if not folder.is_dir():
        print(f"no event files at {folder}: run the pipeline first", file=sys.stderr)
        return 1
    print(render(*queue(load_events(folder))))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
