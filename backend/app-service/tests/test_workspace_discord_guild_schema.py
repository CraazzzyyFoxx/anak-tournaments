"""Unit tests for the workspace Discord-guild schema validation (no DB required)."""

import pytest
from pydantic import ValidationError

from src import schemas


def test_update_accepts_a_snowflake():
    model = schemas.WorkspaceUpdate(discord_guild_id="1234567890123456789")
    assert model.discord_guild_id == "1234567890123456789"


def test_update_strips_surrounding_whitespace():
    model = schemas.WorkspaceUpdate(discord_guild_id="  1234567890123456789  ")
    assert model.discord_guild_id == "1234567890123456789"


@pytest.mark.parametrize("bad", ["notanumber", "12345", "1" * 21, "123456789012345678a", "12 34"])
def test_update_rejects_anything_that_is_not_a_snowflake(bad):
    with pytest.raises(ValidationError):
        schemas.WorkspaceUpdate(discord_guild_id=bad)


@pytest.mark.parametrize("blank", ["", "   ", "\t", "\n"])
def test_a_blank_id_clears_it_instead_of_failing_the_pattern(blank):
    model = schemas.WorkspaceUpdate(discord_guild_id=blank)
    assert model.discord_guild_id is None
    assert model.model_dump(exclude_unset=True) == {"discord_guild_id": None}


def test_omitting_the_field_writes_nothing():
    assert schemas.WorkspaceUpdate().model_dump(exclude_unset=True) == {}


def test_explicit_none_clears_it():
    model = schemas.WorkspaceUpdate(discord_guild_id=None)
    assert model.model_dump(exclude_unset=True) == {"discord_guild_id": None}


def test_read_carries_the_field_defaulting_to_none():
    assert "discord_guild_id" in schemas.WorkspaceRead.model_fields
    assert schemas.WorkspaceRead.model_fields["discord_guild_id"].default is None
