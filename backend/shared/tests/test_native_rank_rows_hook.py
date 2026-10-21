from dataclasses import fields

from shared.disciplines import DISCIPLINES
from shared.disciplines.spec import DisciplineSpec, NativeRankRows


def test_the_overview_twin_hook_is_optional_and_off_by_default() -> None:
    hook = next(f for f in fields(DisciplineSpec) if f.name == "native_rank_rows")
    assert (hook.default, hook.compare) == (None, False)
    assert DisciplineSpec("x", "X").native_rank_rows is None
    assert DISCIPLINES["overwatch"].native_rank_rows is None
    assert NativeRankRows is not None
