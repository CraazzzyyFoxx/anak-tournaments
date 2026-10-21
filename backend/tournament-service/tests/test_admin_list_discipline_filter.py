"""``discipline`` narrows the admin parsed-matches list and the teams list to one installed game (spec §8.1).

Absent is every game; a bogus code is a validation error (never an empty list, never another game's rows); the
filter reaches both the page and the count statement.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any

import pytest
import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

from shared.rpc.query import build_query_model  # noqa: E402
from src import schemas  # noqa: E402
from src.services.admin.matches import _Query  # noqa: E402
from src.services.team.service import TeamService  # noqa: E402

MODELS = (schemas.AdminMatchesQueryParams, schemas.TeamFilterQueryParams)


@pytest.mark.parametrize("model", MODELS)
def test_installed_code_narrows_and_absent_means_every_game(model: type) -> None:
    assert build_query_model(model, {"discipline": ["lol"]}).discipline == "lol"
    assert build_query_model(model, {}).discipline is None


@pytest.mark.parametrize("model", MODELS)
@pytest.mark.parametrize("bogus", ["starcraft", "", "all"])
def test_an_uninstalled_code_is_rejected_not_defaulted(model: type, bogus: str) -> None:
    with pytest.raises(ValidationError):
        build_query_model(model, {"discipline": [bogus]})


def _matches_sql(**query: Any) -> str:
    params = schemas.AdminMatchesSearchParams.from_query_params(schemas.AdminMatchesQueryParams(**query))
    statement = _Query(4, params).query
    return str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


def test_admin_matches_filter_by_the_game_only_when_one_is_named() -> None:
    assert "'lol'" in _matches_sql(discipline="lol")
    assert "'lol'" not in _matches_sql()


class _RecordingSession:
    def __init__(self) -> None:
        self.statements: list[sa.Select] = []

    async def execute(self, statement: sa.Select) -> _RecordingSession:
        self.statements.append(statement)
        return self

    async def scalar(self, statement: sa.Select) -> int:
        self.statements.append(statement)
        return 0

    def unique(self) -> _RecordingSession:
        return self

    def scalars(self) -> _RecordingSession:
        return self

    def all(self) -> list:
        return []


def _teams_sql(**query: Any) -> list[str]:
    async def run() -> list[str]:
        session = _RecordingSession()
        params = schemas.TeamFilterParams.from_query_params(schemas.TeamFilterQueryParams(**query))
        await TeamService().get_all(session, params)
        return [str(statement.compile(dialect=postgresql.dialect())) for statement in session.statements]

    return asyncio.run(run())


def test_teams_filter_page_and_count_by_their_tournaments_game() -> None:
    narrowed = _teams_sql(discipline="lol")
    assert len(narrowed) == 2
    assert all("tournament.discipline = " in sql for sql in narrowed)
    assert not any("tournament.discipline = " in sql for sql in _teams_sql())
