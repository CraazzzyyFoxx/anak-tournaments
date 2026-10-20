"""``optional_discipline``: a list read's game filter, absent meaning every game (spec §8.1)."""

import pytest

from shared.core.errors import ApiHTTPException
from src.rpc import _common as c
from tests.conftest import build_query


@pytest.mark.parametrize("query", [{}, {"discipline": ""}, {"discipline": "all"}])
def test_absent_empty_or_all_is_every_game(query: dict[str, str]) -> None:
    assert c.optional_discipline({"query": build_query(query)}) is None


def test_an_installed_code_is_that_game() -> None:
    assert c.optional_discipline({"query": build_query({"discipline": "lol"})}) == "lol"


def test_a_path_segment_reads_like_the_query() -> None:
    assert c.optional_discipline({"discipline": "all"}, in_path=True) is None
    assert c.optional_discipline({"discipline": "lol"}, in_path=True) == "lol"


def test_an_unknown_code_is_404_discipline_not_installed_never_every_game() -> None:
    with pytest.raises(ApiHTTPException) as raised:
        c.optional_discipline({"query": build_query({"discipline": "chess"})})
    assert raised.value.status_code == 404
    # ``ApiHTTPException`` stores each ``ApiExc`` as its JSON dump (``backend/shared/core/errors.py:43-54``).
    assert raised.value.detail[0]["code"] == "discipline_not_installed"
