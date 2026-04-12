from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

from faststream import FastStream


def test_serve_module_exposes_faststream_app() -> None:
    backend_root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(backend_root))
    sys.path.insert(0, str(backend_root / "parser-service"))

    os.environ["DEBUG"] = "true"

    serve = importlib.import_module("serve")

    assert isinstance(serve.app, FastStream)
