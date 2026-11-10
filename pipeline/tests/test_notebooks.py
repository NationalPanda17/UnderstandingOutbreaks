"""The notebook sources are executed against the published data: they must run and reproduce the published flags."""
import os
import subprocess
import sys

import pytest

from uo import core

SRC = core.ROOT / "notebooks" / "src"
pytestmark = pytest.mark.skipif(not (core.DATA_OUT / "manifest.json").exists(), reason="no published data")


@pytest.mark.parametrize("name", ["01_reproduce_charts_and_flags.py", "02_revision_history_examples.py", "03_simulation_spec_and_sweeps.py"])
def test_notebook_source_runs(name, tmp_path):
    env = {**os.environ, "UO_BASE": str(core.DATA_OUT), "MPLBACKEND": "Agg"}
    r = subprocess.run([sys.executable, str(SRC / name)], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, r.stderr[-2000:]
    if name.startswith("01"):
        assert "identical: True" in r.stdout
    if name.startswith("03"):
        assert "ILLUSTRATIVE SIMULATION: not a forecast" in r.stdout and "population conserved" in r.stdout


def test_built_notebooks_match_their_sources():
    import json
    for py in SRC.glob("*.py"):
        nb = json.loads((py.parent.parent / f"{py.stem}.ipynb").read_text())
        code = "".join("".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code")
        for line in [l for l in py.read_text().splitlines() if l.strip() and not l.startswith("#")][:40]:
            assert line in code, f"{py.name}: notebook is stale, run scripts/make_notebooks.py"
