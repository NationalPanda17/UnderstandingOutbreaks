#!/usr/bin/env python3
"""Write CITATION.cff and .zenodo.json from config/site.json so publisher identity lives in exactly one place.

    python scripts/make_metadata.py          # regenerate both files
    python scripts/make_metadata.py --check  # fail if placeholders are still in place (used before a release)

Never put a name, affiliation or ORCID anywhere else in the repository.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
site = json.loads((ROOT / "config" / "site.json").read_text())
ident = site["identity"]
PLACEHOLDER = "Understanding Outbreaks contributors"


def main() -> int:
    if "--check" in sys.argv:
        problems = []
        if ident["creator"] == PLACEHOLDER:
            problems.append("identity.creator is still the neutral placeholder")
        if not ident["contact"]:
            problems.append("identity.contact is empty")
        if problems:
            print("Maintainer metadata must be filled in config/site.json before minting a DOI:\n- " + "\n- ".join(problems))
            return 1
        return 0
    cff = [
        "cff-version: 1.2.0", f'title: "{site["name"]}"', 'message: "If you use this software or its datasets, please cite it using this metadata and cite the original data sources."',
        "type: software", "authors:", f'  - name: "{ident["creator"]}"', f'url: "{site["baseUrl"]}"', 'license: MIT',
        'abstract: "An open-source, static website and data pipeline that aggregates and explains official public reports of infectious disease activity, with record-level provenance. Not a surveillance system; not medical advice."',
        "keywords:", "  - infectious diseases", "  - outbreaks", "  - open data", "  - provenance", "  - epidemiology education",
    ]
    if ident.get("orcid"):
        cff[5] += f'\n    orcid: "{ident["orcid"]}"'
    if ident.get("affiliation"):
        cff[5] += f'\n    affiliation: "{ident["affiliation"]}"'
    if ident.get("doi"):
        cff.append(f'doi: "{ident["doi"]}"')
    (ROOT / "CITATION.cff").write_text("\n".join(cff) + "\n")
    creator = {"name": ident["creator"]}
    if ident.get("orcid"):
        creator["orcid"] = ident["orcid"]
    if ident.get("affiliation"):
        creator["affiliation"] = ident["affiliation"]
    zen = {"title": site["name"], "upload_type": "dataset", "creators": [creator], "license": "CC-BY-4.0", "access_right": "open",
           "description": "Dataset snapshot and source code of Understanding Outbreaks: aggregated official public reports of infectious disease activity with record-level provenance. Each source keeps its own license (see sources.json). Not a surveillance system; not medical advice.",
           "keywords": ["infectious diseases", "outbreaks", "open data", "provenance"]}
    (ROOT / ".zenodo.json").write_text(json.dumps(zen, indent=2) + "\n")
    print("wrote CITATION.cff and .zenodo.json from config/site.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
