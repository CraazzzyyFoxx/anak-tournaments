"""``_optional_discipline``: a list read's game filter, absent meaning every game (spec §8.1)."""

import pytest

from shared.core.errors import ApiHTTPException
from src.rpc._helpers import _optional_discipline


def _query(**params: str) -> dict:
    return {"query": {key: [value] for key, value in params.items()}}


@pytest.mark.parametrize("params", [{}, {"discipline": ""}, {"discipline": "all"}])
def test_absent_empty_or_all_is_every_game(params: dict[str, str]) -> None:
    assert _optional_discipline(_query(**params)) is None


def test_an_installed_code_is_that_game() -> None:
    assert _optional_discipline(_query(discipline="lol")) == "lol"


def test_an_unknown_code_is_404_discipline_not_installed_never_every_game() -> None:
    with pytest.raises(ApiHTTPException) as raised:
        _optional_discipline(_query(discipline="chess"))
    assert raised.value.status_code == 404
    # ``ApiHTTPException`` stores each ``ApiExc`` as its JSON dump (``backend/shared/core/errors.py:43-54``).
    assert raised.value.detail[0]["code"] == "discipline_not_installed"
