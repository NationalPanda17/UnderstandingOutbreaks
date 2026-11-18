#!/usr/bin/env python3
"""Turn the pipeline's issue requests (state/issues/*.json) into GitHub issues.

Issues only. This script never opens pull requests, never pushes commits, and never merges anything.
An open issue with the same title is commented on instead of duplicated.

Requires the GitHub CLI (`gh`) and GH_TOKEN with `issues: write`. With --dry-run it only prints.
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]


def gh(*args: str) -> str:
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def ensure_labels(names: set[str]) -> None:
    """Create any missing labels: `gh issue create --label` fails outright on a label the repository does not have."""
    have = {x["name"] for x in json.loads(gh("label", "list", "--limit", "200", "--json", "name"))}
    for n in sorted(names - have):
        gh("label", "create", n, "--color", "6b7280", "--description", "Opened by the data pipeline; needs a person")


def close_recovered() -> None:
    """Close a source-failure issue once that source has been read successfully again, with a note saying when.

    Only issues this pipeline opened ("[pipeline] Source failure: <dataset>") are touched, and only when the published
    data-quality file shows the dataset in good state with a successful read later than the issue.
    """
    q = ROOT / "site" / "public" / "data" / "v1" / "quality.json"
    if not q.exists():
        return
    ok = {d["dataset_id"]: d.get("last_success") for d in json.loads(q.read_text())["datasets"] if d.get("state", "ok") == "ok" and d.get("last_success")}
    prefix = "[pipeline] Source failure: "
    for i in json.loads(gh("issue", "list", "--state", "open", "--label", "source-failure", "--limit", "100", "--json", "number,title,createdAt")):
        ds = i["title"][len(prefix):] if i["title"].startswith(prefix) else None
        if ds in ok and ok[ds] > i["createdAt"]:
            gh("issue", "close", str(i["number"]), "--reason", "completed", "--comment",
               f"Recovered: `{ds}` was read successfully again at {ok[ds]}. Closed automatically; a new failure opens a new issue.")


def main() -> int:
    dry = "--dry-run" in sys.argv
    d = ROOT / "state" / "issues"
    files = sorted(d.glob("*.json")) if d.exists() else []
    for f in files:
        rec = json.loads(f.read_text())
        title = f"[pipeline] {rec['title']}"
        if dry:
            print(f"--- {title}\n{rec['body']}\n")
            continue
        ensure_labels({"pipeline", rec["kind"]})
        existing = json.loads(gh("issue", "list", "--state", "open", "--search", f'"{title}" in:title', "--json", "number,title"))
        match = next((i for i in existing if i["title"] == title), None)
        if match:
            gh("issue", "comment", str(match["number"]), "--body", f"Still occurring ({rec['created_at']}).\n\n{rec['body']}")
        else:
            gh("issue", "create", "--title", title, "--body", rec["body"], "--label", f"pipeline,{rec['kind']}")
        f.unlink()
    if not dry:
        close_recovered()
    print(f"{len(files)} issue request(s) processed" + (" (dry run)" if dry else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
