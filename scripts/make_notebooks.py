#!/usr/bin/env python3
"""Build .ipynb and .qmd notebooks from the '# %%' cell sources in notebooks/src, plus notebooks/index.json.

The .py sources are the single place to edit; they are also what the test suite executes.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
NB = ROOT / "notebooks"
META = {
    "01_reproduce_charts_and_flags": ("Reproduce the main chart and signal flags (Python)", "Loads a disease's data, redraws a country chart with incomplete periods marked, recomputes the signal flags and checks them against the published ones, and loads a specific snapshot."),
    "02_revision_history_examples": ("Example gallery: using the revision history (Python)", "Three short analyses: how often values are revised by source, how large and how late revisions are, and one series at two snapshots."),
    "03_simulation_spec_and_sweeps": ("Run a sandbox model specification and a sweep (Python)", "Illustrative simulation, not a forecast. Loads a model spec exported from the sandbox, runs it with scipy, and sweeps one parameter."),
}


def cells(src: str):
    out, kind, buf = [], None, []
    for line in src.splitlines():
        m = re.match(r"^# %%( \[markdown\])?\s*$", line)
        if m:
            if kind:
                out.append((kind, buf))
            kind, buf = ("markdown" if m.group(1) else "code"), []
        elif kind:
            buf.append(re.sub(r"^# ?", "", line) if kind == "markdown" else line)
    if kind:
        out.append((kind, buf))
    return [(k, "\n".join(b).strip("\n")) for k, b in out]


def main():
    index = []
    for py in sorted((NB / "src").glob("*.py")):
        cs = cells(py.read_text(encoding="utf-8"))
        nb = {"nbformat": 4, "nbformat_minor": 5, "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"}, "language_info": {"name": "python"}},
              "cells": [{"cell_type": k, "metadata": {}, "source": s.splitlines(keepends=True), **({"outputs": [], "execution_count": None} if k == "code" else {})} for k, s in cs]}
        (NB / f"{py.stem}.ipynb").write_text(json.dumps(nb, indent=1) + "\n", encoding="utf-8")
        title, desc = META[py.stem]
        qmd = [f"---\ntitle: \"{title}\"\nformat: html\njupyter: python3\n---\n"]
        for k, s in cs:
            qmd.append(s + "\n" if k == "markdown" else "```{python}\n" + s + "\n```\n")
        (NB / f"{py.stem}.qmd").write_text("\n".join(qmd), encoding="utf-8")
        index.append({"id": py.stem, "title": title, "language": "python", "ipynb": f"{py.stem}.ipynb", "qmd": f"{py.stem}.qmd", "description": desc})
    index.append({"id": "reproduce_charts_r", "title": "Reproduce the main chart (R, tidyverse)", "language": "r", "qmd": "reproduce_charts.qmd", "script": "starter.R",
                  "description": "Loads the data with arrow and dplyr, redraws a country chart, and loads a specific snapshot. The in-browser console runs a base-R starter script."})
    index.append({"id": "simulation_spec_r", "title": "Run a sandbox model with deSolve (R)", "language": "r", "qmd": "simulation_spec.qmd",
                  "description": "Illustrative simulation, not a forecast. Runs the SEIR teaching model with deSolve and sweeps one parameter."})
    (NB / "index.json").write_text(json.dumps({"notebooks": index}, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {len(index)} notebook entries")


if __name__ == "__main__":
    main()
