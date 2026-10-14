"""Core reaches a discipline module only through the registry (D83, D99).

``backend/.importlinter`` holds the line inside ``shared``. The services each have the root package ``src``, which a
single import-linter graph cannot address, so their ``src`` trees are scanned here.
"""

from __future__ import annotations

import ast
import configparser
import pathlib

BACKEND = pathlib.Path(__file__).resolve().parents[1]
DISCIPLINES_DIR = BACKEND / "shared" / "disciplines"


def _imported_names(source: str) -> list[str]:
    names: list[str] = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.append(node.module)
            names.extend(f"{node.module}.{alias.name}" for alias in node.names)
    return names


def _module_of(name: str) -> str | None:
    """``shared.disciplines.overwatch.catalog_sync`` -> ``overwatch``; ``shared.disciplines.DISCIPLINES`` -> None."""
    parts = name.split(".")
    if parts[:2] == ["shared", "disciplines"] and len(parts) > 2 and (DISCIPLINES_DIR / parts[2]).is_dir():
        return parts[2]
    return None


def test_the_scan_sees_both_import_forms() -> None:
    names = _imported_names(
        "import shared.disciplines.lol\nfrom shared.disciplines import overwatch\nfrom shared.disciplines import DISCIPLINES\n"
    )
    assert sorted(module for module in map(_module_of, names) if module) == ["lol", "overwatch"]


def test_no_service_imports_a_discipline_module() -> None:
    offenders = sorted(
        f"{path.relative_to(BACKEND).as_posix()}: {name}"
        for path in BACKEND.glob("*-service/src/**/*.py")
        for name in _imported_names(path.read_text(encoding="utf-8"))
        if _module_of(name)
    )
    assert offenders == []


def test_import_linter_covers_every_shared_runtime_module_and_package() -> None:
    config = configparser.ConfigParser()
    config.read(BACKEND / ".importlinter", encoding="utf-8")
    covered = set(config["importlinter:contract:core-reaches-modules-through-the-registry"]["source_modules"].split())
    shared = BACKEND / "shared"
    modules = {f"shared.{path.stem}" for path in shared.glob("*.py") if path.stem != "__init__"}
    packages = {
        f"shared.{path.name}" for path in shared.iterdir() if path.is_dir() and (path / "__init__.py").is_file()
    }
    # Tests intentionally exercise concrete modules. shared.testing is runtime support and stays covered.
    assert covered == (modules | packages) - {"shared.disciplines", "shared.tests"}
