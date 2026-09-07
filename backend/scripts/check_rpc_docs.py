#!/usr/bin/env python
"""Fail when the gateway routes an RPC subject the API documentation never mentions.

The services are headless: an RPC subject is only reachable because the gateway
maps a REST route onto it. What the *public* sees of that route -- its summary,
description, request and response schema -- comes from two per-service tables:

    src/openapi_schemas.py   OPERATIONS  subject -> Pydantic models
    src/openapi_docs.py      DOCS        subject -> summary + description

Nothing forced a new handler to appear in either. By the time this check was
written, 67 subjects were routed by the gateway and absent from both -- team
registration, the captain pick/ban and report surfaces, the whole custom-game
API, workspace player ranks, the RBAC deny overlay. Every one of them is
reachable over HTTP and invisible at /api/docs.

This is a coverage gate, not a schema gate: `export_openapi_schemas.sh --check`
already proves the committed manifest matches the tables. This proves the tables
cover what is actually routed.

Subjects are read as string literals -- `@broker.subscriber("rpc.x.y")` on the
Python side, `"rpc.x.y"` on the Go side. That is exactly how both ends resolve
them at runtime, so a literal is the right unit; a subject assembled at runtime
would be invisible to the gateway's own route table too.

Usage:
  uv run python scripts/check_rpc_docs.py            # report + fail on gaps
  uv run python scripts/check_rpc_docs.py --list     # print every gap, exit 0
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
GATEWAY = ROOT / "gateway" / "internal"

SUBSCRIBER_RE = re.compile(r"subscriber\(\s*[\"']([^\"']+)[\"']")
GO_SUBJECT_RE = re.compile(r"\"(rpc\.[a-z0-9_.]+)\"")
#: Both tables are keyed by subject; the generic CRUD engine appends `#entity`
#: to one subject, which is a schema distinction, not a routing one.
DOC_KEY_RE = re.compile(r"[\"'](rpc\.[^\"'#]+)(?:#[^\"']*)?[\"']\s*:")


def python_sources(service: Path):
    for path in service.rglob("*.py"):
        if "__pycache__" in path.parts or "tests" in path.parts:
            continue
        yield path


def subscribed_subjects(service: Path) -> set[str]:
    found: set[str] = set()
    for path in python_sources(service):
        found.update(SUBSCRIBER_RE.findall(path.read_text(encoding="utf-8")))
    return {s for s in found if s.startswith("rpc.")}


def documented_subjects(service: Path) -> set[str]:
    found: set[str] = set()
    for name in ("src/openapi_docs.py", "src/openapi_schemas.py"):
        path = service / name
        if path.exists():
            found.update(DOC_KEY_RE.findall(path.read_text(encoding="utf-8")))
    return found


def gateway_subjects() -> set[str]:
    found: set[str] = set()
    for path in GATEWAY.rglob("*.go"):
        if path.name.endswith("_test.go"):
            continue
        found.update(GO_SUBJECT_RE.findall(path.read_text(encoding="utf-8")))
    return found


def main(argv: list[str]) -> int:
    if argv and argv != ["--list"]:
        print(f"usage: {Path(__file__).name} [--list]", file=sys.stderr)
        return 2

    routed = gateway_subjects()
    gaps: dict[str, list[str]] = {}
    total_subjects = 0

    for service in sorted(BACKEND.glob("*-service")):
        subscribed = subscribed_subjects(service)
        if not subscribed:
            continue
        total_subjects += len(subscribed)
        documented = documented_subjects(service)
        missing = sorted(s for s in subscribed - documented if s in routed)
        if missing:
            gaps[service.name] = missing

    missing_total = sum(len(v) for v in gaps.values())
    if not gaps:
        print(f"every routed RPC subject is documented ({total_subjects} subjects)")
        return 0

    stream = sys.stdout if argv == ["--list"] else sys.stderr
    print(
        f"{missing_total} of {total_subjects} RPC subjects are routed by the gateway "
        f"but absent from both OPERATIONS and DOCS:\n",
        file=stream,
    )
    for service, missing in gaps.items():
        print(f"  {service} ({len(missing)}):", file=stream)
        for subject in missing:
            print(f"    {subject}", file=stream)
    if argv == ["--list"]:
        return 0
    print(
        "\nA subject reachable over HTTP and missing from /api/docs is an undocumented "
        "public API. Add an Op to src/openapi_schemas.py and a summary/description to "
        "src/openapi_docs.py, then run: bash scripts/export_openapi_schemas.sh",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
