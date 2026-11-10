"""Source link checker.

    python -m uo.linkcheck

Checks every registry landing URL, every dataset deep link, and the license URLs. Results go to
state/linkcheck.json (shown on the data-quality page and in trace panels). Broken links open a GitHub issue;
nothing is edited automatically. Trace panels offer the archived copy or a Wayback Machine link as fallback.
"""
from __future__ import annotations

import sys
import time

from .core import CONFIG, STATE, USER_AGENT, iso, load_registry, load_yaml, record_issue, utcnow, write_json


def wayback(url: str) -> str:
    return "https://web.archive.org/web/2/" + url


def check(url: str, timeout: int = 30) -> dict:
    import requests

    for attempt in range(3):
        try:
            r = requests.get(url, headers={"User-Agent": USER_AGENT, "Range": "bytes=0-2048"}, timeout=timeout, stream=True, allow_redirects=True)
            code = r.status_code
            r.close()
            if code in (200, 206):
                return {"status": "ok", "http": code}
            if code in (401, 403, 405, 429):
                # reachable but refuses automated clients: not counted as broken, flagged for a manual look
                return {"status": "blocked-automated-check", "http": code}
            if code >= 500 and attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            return {"status": "broken", "http": code, "wayback": wayback(url)}
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                return {"status": "broken", "error": type(e).__name__, "wayback": wayback(url)}
            time.sleep(2 * (attempt + 1))
    return {"status": "broken", "wayback": wayback(url)}


def targets() -> dict[str, list[tuple[str, str]]]:
    reg = load_registry()
    cfg = load_yaml(CONFIG / "datasets.yaml")
    out: dict[str, list[tuple[str, str]]] = {}
    for sid, s in reg.items():
        if s["landing_url"].startswith("https://"):
            out.setdefault(sid, []).append(("landing", s["landing_url"]))
        if s["license_url"].startswith("https://"):
            out.setdefault(sid, []).append(("license", s["license_url"]))
    for group in ("datasets", "reference"):
        for d in cfg[group]:
            link = d["deep_link"].replace("{iso3}", "KEN").replace("{iso2}", "KE")
            out.setdefault(d["source_id"], []).append((f"deep:{d['id']}", link))
    return out


def main() -> int:
    now = iso(utcnow())
    results: dict = {}
    broken = []
    for sid, links in targets().items():
        per = []
        for kind, url in links:
            res = {**check(url), "kind": kind, "url": url, "checked_at": now}
            per.append(res)
            key = url.split("{")[0].rstrip("?&")
            results[key] = res
            if res["status"] == "broken":
                broken.append((sid, kind, url, res))
            print(f"[linkcheck] {res['status']:<24} {sid:<24} {url}", file=sys.stderr)
        worst = "broken" if any(p["status"] == "broken" for p in per) else ("blocked-automated-check" if any(p["status"] != "ok" for p in per) else "ok")
        results[sid] = {"status": worst, "checked_at": now, "links": per}
    write_json(STATE / "linkcheck.json", results, compact=False)
    if broken:
        body = "These source links did not resolve. The site shows \"original link unavailable\" and offers the archived copy or a Wayback Machine link.\n\n"
        body += "\n".join(f"- `{sid}` ({kind}): {url} — {res.get('http', res.get('error'))}; fallback: {res['wayback']}" for sid, kind, url, res in broken)
        body += "\n\nA person needs to update `config/sources.yaml` or `config/datasets.yaml`. Nothing was changed automatically."
        record_issue("broken-link", "Broken source links", body, dedupe_key="broken-source-links")
    return 0


if __name__ == "__main__":
    sys.exit(main())
