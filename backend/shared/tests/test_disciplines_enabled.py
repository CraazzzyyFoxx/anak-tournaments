"""D89: a workspace creates tournaments and mixes only in the disciplines enabled for it."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from shared.core.errors import BaseAPIException
from shared.services.ontology import assert_discipline_enabled, normalize_disciplines_enabled


def test_a_discipline_the_workspace_has_not_enabled_is_refused() -> None:
    assert_discipline_enabled(SimpleNamespace(disciplines_enabled=["overwatch", "lol"]), "lol")
    with pytest.raises(BaseAPIException) as raised:
        assert_discipline_enabled(SimpleNamespace(disciplines_enabled=["overwatch"]), "lol")
    assert raised.value.status_code == 422
    assert "discipline_not_enabled" in str(raised.value.detail)


def test_the_enabled_list_holds_known_codes_once_each() -> None:
    assert normalize_disciplines_enabled(["overwatch", "lol", "overwatch"]) == ["overwatch", "lol"]
    for bad in ([], ["chess"]):
        with pytest.raises(ValueError):
            normalize_disciplines_enabled(bad)
