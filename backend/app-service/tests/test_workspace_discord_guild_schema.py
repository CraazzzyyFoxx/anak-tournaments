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


@pytest.mark.parametrize("bad", ["notanumber", "12345", "1" * 20, "1" * 21, "123456789012345678a", "12 34"])
def test_update_rejects_anything_that_is_not_a_snowflake(bad):
    with pytest.raises(ValidationError):
        schemas.WorkspaceUpdate(discord_guild_id=bad)


@pytest.mark.parametrize("ok", ["1" * 17, "1" * 18, "1" * 19])
def test_update_accepts_every_length_a_bigint_could_hold(ok):
    assert schemas.WorkspaceUpdate(discord_guild_id=ok).discord_guild_id == ok


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
    # The same pin the other deliberately-exposed WorkspaceRead fields carry (see
    # test_workspace_timezone_schema.py:30 and test_workspace_branding_schema.py:98).
    # It looks tautological, but exposing this field on a PUBLIC read model is a
    # deliberate design decision, and nothing else in the suite fails if it
    # silently disappears -- the admin page would just render a blank guild.
    assert "discord_guild_id" in schemas.WorkspaceRead.model_fields
    assert schemas.WorkspaceRead.model_fields["discord_guild_id"].default is None
