"""The D99 literal gate: a game's vocabulary outside its module is caught; modules, ports and prose pass.

This source scanner is the expressly requested D99 exception to the behaviour-only test preference: the sources below are
fed to the real scanner with the real registry's token sets.
"""

from __future__ import annotations

import json
from pathlib import Path

from scripts import check_discipline_literals as d99

RULES = d99.build_rules()


def found(path: str, source: str) -> list[tuple[str, str]]:
    return [(f.rule, f.token) for f in d99.scan_text(path, source, RULES, d99.DISCIPLINES)]


CORE_TS = "frontend/src/lib/x.ts"
CORE_PY = "backend/app-service/src/services/x.py"


def test_a_game_default_in_core_is_caught_in_every_language() -> None:
    assert found(CORE_TS, 'const game = props.discipline ?? "overwatch";') == [("discipline-code", "overwatch")]
    assert found(CORE_PY, 'def f(discipline: str = "overwatch"): ...') == [("discipline-code", "overwatch")]
    assert found("gateway/internal/app/x.go", 'const game = "lol" // not "overwatch"') == [("discipline-code", "lol")]
    assert found("frontend/src/config/x.json", '{"game": "League of Legends"}') == [
        ("discipline-code", "League of Legends")
    ]


def test_unknown_role_to_damage_and_class_to_role_inference_are_caught() -> None:
    assert found(CORE_PY, 'role = ROLES.get(code, "damage")') == [("role-vocabulary", "damage")]
    assert found(CORE_TS, 'const role = hero.attrs.class === "support" ? "Support" : null;') == [
        ("role-vocabulary", "support"),
        ("role-vocabulary", "Support"),
    ]
    assert found(CORE_PY, 'CLASS_TO_ROLE = {"tank": "tank"}') == [("role-vocabulary", "tank")] * 2


def test_template_and_f_string_chunks_do_not_evade_contains_and_prefix_rules() -> None:
    assert found(CORE_TS, "const path = `/disciplines/${'x'}/overwatch/${id}`;") == [("discipline-code", "overwatch")]
    assert found(CORE_TS, "const key = `ow_${field}`;") == [("ow-prefix", "ow_")]
    assert found(CORE_PY, 'icon = f"/roles/{code}.png"') == [("asset-path", "/roles/")]
    # A whole-literal rule needs the whole literal: a substituted template is not a role name.
    assert found(CORE_TS, "const label = `${prefix}tank`;") == []
    assert found(CORE_TS, "const fixed = `tank`;") == [("role-vocabulary", "tank")]


def test_escaped_spellings_are_decoded_before_matching() -> None:
    assert found(CORE_TS, 'const game = requested ?? "\\u006fverwatch";') == [("discipline-code", "overwatch")]
    assert found(CORE_TS, "const role = '\\u0064amage';") == [("role-vocabulary", "damage")]
    assert found(CORE_TS, 'const role = "\\u{74}ank" + `\\x73upport`;') == [
        ("role-vocabulary", "tank"),
        ("role-vocabulary", "support"),
    ]
    assert found("gateway/internal/app/x.go", 'game := "\\x6fverwatch"') == [("discipline-code", "overwatch")]
    # Offsets are the token's own: the finding still names the source line.
    line = d99.scan_text(CORE_TS, 'const a = 1;\nconst b = "\\u006fverwatch";', RULES, d99.DISCIPLINES)[0].line
    assert line == 2


def test_comments_docstrings_and_regex_literals_are_not_literals() -> None:
    ts = '// overwatch default\n/* "damage" */\nconst re = /overwatch/;\nconst n = a / b / c;\n'
    assert found(CORE_TS, ts) == []
    py = '"""Overwatch prose: tank, damage."""\n# "overwatch"\nx = 1\n'
    assert found(CORE_PY, py) == []


def test_prose_page_hero_identifiers_and_p1_route_strings_pass() -> None:
    source = (
        'import { PageHero } from "@/components/site/PageHero";\n'
        'const hint = "Contact support if the bracket looks wrong";\n'
        't("footer.support"); const cls = "page-hero";\n'
        'const url = "/users/heroes-compare?left_hero_id=1&right_hero_id=2";\n'
    )
    assert found(CORE_TS, source) == []


def test_modules_and_the_registry_entrypoints_may_name_their_game() -> None:
    declaration = 'SPEC = DisciplineSpec("overwatch", "Overwatch", kinds={"character": "Hero"})\nROLE = "tank"\n'
    assert found("backend/shared/disciplines/overwatch/__init__.py", declaration) == []
    # ...but never another game's code.
    assert found("backend/shared/disciplines/overwatch/x.py", 'OTHER = "lol"') == [("discipline-code", "lol")]
    loader = 'export const LOADERS = { overwatch: () => import("../overwatch/rank") };'
    assert found("frontend/src/disciplines/registry/rank.ts", loader) == []
    assert found("frontend/src/disciplines/DisciplineWidget.tsx", loader) == [("discipline-code", "overwatch")]


def test_tests_migrations_and_generated_artifacts_are_out_of_scope_by_root() -> None:
    for path in (
        "frontend/src/lib/x.test.ts",
        "frontend/src/app/x.behavior.test.tsx",
        "frontend/src/test/support.ts",
        "frontend/src/types/api.generated.ts",
        "frontend/src/i18n/messages/en.json",
        "backend/app-service/tests/test_x.py",
        "backend/migrations/versions/x.py",
        "gateway/internal/app/x_test.go",
    ):
        assert d99.language(path) is None, path
    assert d99.language(CORE_TS) == "ts"
    # Exactly *.test.ts(x) and src/test/**: harnesses, fixtures and spec-named files are runtime code.
    for path in (
        "frontend/src/app/x/harness.behavior.tsx",
        "frontend/src/app/x/owner.fixture.ts",
        "frontend/src/lib/session.spec.ts",
        "frontend/src/app/x/__fixtures__/ladder.ts",
    ):
        assert d99.language(path) == "ts", path


def _finding(token: str = "overwatch", line: str = 'x = "overwatch"') -> d99.Finding:
    return d99.Finding(CORE_PY, 1, "discipline-code", token, line)


def _entry(**overrides: object) -> dict[str, object]:
    entry = {
        "path": CORE_PY,
        "rule": "discipline-code",
        "token": "overwatch",
        "context": "x =",
        "count": 1,
        "reason": "r",
        "owner": "P9",
        "remove_when": "w",
    }
    return {**entry, **overrides}


def test_an_exact_exception_covers_exactly_its_findings() -> None:
    assert d99.apply_exceptions([_finding()], [_entry()]) == ([], [])


def test_a_stale_or_too_broad_exception_fails() -> None:
    left, broken = d99.apply_exceptions([], [_entry()])
    assert left == [] and "stale exception" in broken[0]
    left, broken = d99.apply_exceptions([_finding(), _finding()], [_entry()])
    assert left == [] and "too-broad exception" in broken[0]
    # Growth beyond the declared context is a finding again.
    left, _ = d99.apply_exceptions([_finding(line='y = "overwatch"')], [_entry()])
    assert [f.text for f in left] == ['y = "overwatch"']


def test_directory_glob_and_shapeless_entries_are_rejected(tmp_path: Path) -> None:
    (tmp_path / "backend").mkdir()
    (tmp_path / "backend" / "x.py").write_text("")

    def errors(entry: dict[str, object]) -> list[str]:
        return d99.check_manifest({"version": 1, "exceptions": [entry]}, root=tmp_path)

    assert errors(_entry(path="backend/x.py")) == []
    assert errors(_entry(path="backend")) and errors(_entry(path="backend/*.py"))
    assert errors(_entry(path="backend/x.py", count=0))
    assert errors({k: v for k, v in _entry(path="backend/x.py").items() if k != "owner"})


def test_the_committed_manifest_is_well_formed() -> None:
    assert d99.check_manifest(json.loads(d99.EXCEPTIONS.read_text(encoding="utf-8"))) == []
