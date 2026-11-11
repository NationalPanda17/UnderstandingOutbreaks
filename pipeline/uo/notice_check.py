"""Hourly check: has an official source listed a notice the live site does not know about yet?

It reads the notice feeds (the same addresses and parsers as the full pipeline, but only the recent part of each
feed, and nothing is archived or published), then compares the notice ids with the list the last full run published
at events/report_ids.json. It prints the new ids and, under GitHub Actions, sets the output `new=true` so the
workflow can start a full update. It never changes data itself.

A source that cannot be read is skipped here without raising: the full update is what reports source failures.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys

from . import events as ev
from .core import CONFIG, PipelineError, http_get, load_diseases, load_site, load_yaml

RECENT_DAYS = 21


def recent_reports(ds: dict, normalizer, today: dt.date, get=http_get) -> list[dict]:
    """Notices currently listed by one feed, filtered the way the full pipeline filters them."""
    if ds["connector"] == "who_don":
        url = ds["url"].format(start=(today - dt.timedelta(days=RECENT_DAYS)).isoformat()) + "&$top=100"
    else:
        url = ds["url"]
    content, _ = get(url, retries=2, timeout=40)
    reps = ev.PARSERS[ds["connector"]](ds, content, "check")
    if ds.get("require_disease"):
        reps = [r for r in reps if normalizer.normalize(r["title"])[0] is not None]
    return reps


def new_ids(listed: list[str], known: list[str]) -> list[str]:
    seen = set(known)
    return sorted({i for i in listed if i not in seen})


def main() -> int:
    today = dt.datetime.now(dt.timezone.utc).date()
    base = load_site()["baseUrl"].rstrip("/")
    try:
        content, _ = http_get(f"{base}/data/v1/events/report_ids.json", retries=2, timeout=40)
        known = json.loads(content)["report_ids"]
    except Exception as e:  # not published yet, or the site is unreachable: do nothing rather than deploy blindly
        print(f"[check] cannot read the published notice list ({type(e).__name__}: {e}); nothing started", file=sys.stderr)
        return 0
    normalizer = ev.DiseaseNormalizer(load_diseases())
    listed: list[str] = []
    for ds in load_yaml(CONFIG / "datasets.yaml")["events"]:
        try:
            ids = [r["report_id"] for r in recent_reports(ds, normalizer, today)]
            listed += ids
            print(f"[check] {ds['id']}: {len(ids)} notices listed", file=sys.stderr)
        except (PipelineError, Exception) as e:  # noqa: BLE001
            print(f"[check] {ds['id']}: skipped ({type(e).__name__}: {e})", file=sys.stderr)
    fresh = new_ids(listed, known)
    print(f"[check] {len(fresh)} new: {', '.join(fresh[:10])}" if fresh else "[check] no new notices", file=sys.stderr)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as fh:
            fh.write(f"new={'true' if fresh else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
