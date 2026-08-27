"""Public participants list visibility contract for ``_reg_to_read``.

The roster renders a column per built-in field and per organizer-defined custom
field, so every one of them has to survive serialization for an anonymous
caller. Smurf tags are declared alternate battle tags (anti-smurf transparency,
same class as the public ``battle_tag``); free-text notes are a
participant-facing form field; custom fields are questions the organizer chose
to ask on a public sign-up form.

``custom_fields_json`` used to be stripped behind an ``include_private`` flag,
which left every custom column on the roster permanently empty under a header
that advertised it. The flag is gone -- one read model, one visibility rule.
"""

from datetime import datetime
from types import SimpleNamespace

# Importing the read model instantiates the service Settings(); this file used
# to rely on whichever sibling test module happened to be collected first.


from src.schemas.registration_build import _reg_to_read  # noqa: E402
from shared.domain.member_rank import ResolvedRank  # noqa: E402


def _reg_stub() -> SimpleNamespace:
    return SimpleNamespace(
        id=1,
        tournament_id=78,
        workspace_member=SimpleNamespace(player_id=42),
        battle_tag="Player#1234",
        smurf_tags_json=["Alt#1111", "Alt#2222"],
        discord_nick="player",
        twitch_nick="player_tv",
        boosty_nick="player_boosty",
        stream_pov=False,
        roles=[],
        notes="anything you'd like organizers to know",
        custom_fields_json={"vk": "vk.com/player"},
        status="approved",
        balancer_status="ready",
        checked_in=False,
        submitted_at=datetime(2026, 1, 1),
        reviewed_at=None,
    )


def test_the_roster_read_carries_every_column_it_renders():
    read = _reg_to_read(_reg_stub(), workspace_id=1)

    # Anti-smurf transparency data (the roster's whole point).
    assert read.smurf_tags_json == ["Alt#1111", "Alt#2222"]
    # Notes are a roster column.
    assert read.notes == "anything you'd like organizers to know"
    # The custom columns are built from the form's definitions, so their
    # answers have to arrive or the header lies.
    assert read.custom_fields_json == {"vk": "vk.com/player"}
    # Every identity handle the form collects gets its own column.
    assert read.discord_nick == "player"
    assert read.twitch_nick == "player_tv"
    assert read.boosty_nick == "player_boosty"
    # Balancer progress is public: the roster shows it and the registrant's
    # own card renders the balancing step from it.
    assert read.balancer_status == "ready"
    assert read.balancer_status_meta is not None


def test_ranks_stay_hidden_unless_the_form_publishes_them():
    stub = _reg_stub()
    stub.roles = [
        SimpleNamespace(role="tank", subrole=None, is_primary=True, priority=0, rank_value=3200, hero_entries=[])
    ]

    hidden = _reg_to_read(stub, workspace_id=1)
    shown = _reg_to_read(stub, workspace_id=1, show_ranks=True)

    assert hidden.roles[0].rank_value is None
    assert shown.roles[0].rank_value == 3200



def test_follow_reg_uses_inherited_workspace_rank():
    stub = _reg_stub()
    stub.roles = [
        SimpleNamespace(role="tank", subrole=None, is_primary=True, priority=0, rank_value=None, hero_entries=[])
    ]

    read = _reg_to_read(
        stub,
        workspace_id=1,
        show_ranks=True,
        resolved_ranks={"tank": ResolvedRank(3200, "workspace")},
    )

    assert read.roles[0].rank_value == 3200

def test_read_payload_includes_profile_visibility():
    read = _reg_to_read(_reg_stub(), workspace_id=1, profiles_open=True)

    assert read.profiles_open is True
