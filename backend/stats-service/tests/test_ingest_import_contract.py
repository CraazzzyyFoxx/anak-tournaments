"""Generic ingest reaches Overwatch only through the registry: real imports in a fresh interpreter, not source scans.

Every module under the parser's ``src/services/ingest`` and the shared repositories/services is imported; none may load
an Overwatch module beyond what ``import shared.disciplines`` itself loads, and the registry alone must not pull in the
decoder's pandas.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

backend_root = Path(__file__).resolve().parents[2]


def _run(script: str) -> dict:
    env = {
        **os.environ,
        "DEBUG": "true",
        "PYTHONPATH": os.pathsep.join([str(backend_root), str(backend_root / "stats-service")]),
    }
    done = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, env=env, cwd=backend_root, check=False
    )
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout.strip().splitlines()[-1])


def test_generic_ingest_and_shared_core_import_no_overwatch_module() -> None:
    out = _run(
        """
import importlib, json, pkgutil, sys

import shared.disciplines

def overwatch():
    return sorted(m for m in sys.modules if m.startswith("shared.disciplines.overwatch"))

baseline = overwatch()
roots = [("src.services.ingest",), ("shared.repository",), ("shared.services",)]
imported = []
for (root,) in roots:
    package = importlib.import_module(root)
    imported.append(root)
    for info in pkgutil.walk_packages(package.__path__, root + "."):
        importlib.import_module(info.name)
        imported.append(info.name)
print(json.dumps({"baseline": baseline, "after": overwatch(), "imported": imported}))
"""
    )
    assert out["after"] == out["baseline"], sorted(set(out["after"]) - set(out["baseline"]))
    assert {"src.services.ingest.validation", "shared.services.decode_context", "shared.repository.stats"} <= set(
        out["imported"]
    )
    # The registry itself declares the decoder through lazy wrappers.
    assert not [m for m in out["baseline"] if m.endswith((".ingest", ".impact", ".baselines", ".backfill"))]


def test_loading_the_registry_does_not_load_the_decoder_stack() -> None:
    out = _run(
        """
import json, sys
import shared.disciplines as d

print(json.dumps({
    "pandas": "pandas" in sys.modules,
    "ingestors": sorted(d.INGESTORS),
}))
"""
    )
    assert out["pandas"] is False
    assert out["ingestors"] == [["overwatch", "discord"], ["overwatch", "manual"], ["overwatch", "upload"]]
