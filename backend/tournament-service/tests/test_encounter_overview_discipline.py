"""``discipline`` narrows the encounters overview and insights before any strip limit.

Every board read (the counts, the live and closest strips, the insights' aggregates) is built by
``_apply_encounter_filters``, so a game filter there is applied upstream of every limit and aggregate, and a
client never has to filter a truncated cross-game sample.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

from shared import models  # noqa: E402
from shared.rpc.query import build_query_model  # noqa: E402
from src import schemas  # noqa: E402
from src.services.encounter.service import _apply_encounter_filters  # noqa: E402


def _params(query: dict) -> schemas.EncounterSearchParams:
    return schemas.EncounterSearchParams.from_query_params(build_query_model(schemas.EncounterSearchQueryParams, query))


def _sql(params: schemas.EncounterSearchParams) -> str:
    statement = _apply_encounter_filters(sa.select(models.Encounter.id), params)
    return str(statement.compile(dialect=postgresql.dialect()))


def test_the_game_reaches_the_filters_every_board_read_shares() -> None:
    assert "encounter.discipline = " in _sql(_params({"discipline": ["lol"]}))
    assert "encounter.discipline = " not in _sql(_params({}))


@pytest.mark.parametrize("bogus", ["starcraft", "", "all"])
def test_an_uninstalled_game_is_rejected(bogus: str) -> None:
    with pytest.raises(ValidationError):
        build_query_model(schemas.EncounterSearchQueryParams, {"discipline": [bogus]})
