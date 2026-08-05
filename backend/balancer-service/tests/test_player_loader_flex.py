"""Flex slots at the balancer input boundary.

A roster shape may contain ``flex`` slots, up to and including the role-less
``{"flex": N}`` roster. The mask handed to the algorithm is that shape, so
``parse_player_node`` has to answer a question it never had to answer before:
what rating does a player bring to a slot that has no role?

Answer: the best rating he actually has. It is the same "ready to play
anything" policy the draft already applies (``lifecycle._map_registration``,
pinned by ``test_forced_flex_parity.py`` against
``docs/superpowers/fixtures/forced-flex-eff-rank.json``), so both halves of the
product agree on what a flex player is worth.

Without the synthesis every player is dropped (no role line resolves into a
flex-only mask, ``ratings`` stays empty, ``parse_player_node`` returns
``None``) and the Rust solver rejects the request with "player count must equal
total roster slots" — see ``native/moo_core/src/context.rs`` line 41.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import pytest

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"

for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")
os.environ.setdefault("S3_ACCESS_KEY", "test")
os.environ.setdefault("S3_SECRET_KEY", "test")
os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost")
os.environ.setdefault("S3_BUCKET_NAME", "test")
os.environ["DEBUG"] = "false"

from shared.domain.roster_shape import DEFAULT_ROSTER_SLOTS, FLEX_SLOT_CODE  # noqa: E402
from src.services.balancer.algorithm.entities import Team  # noqa: E402
from src.services.balancer.algorithm.moo_backend import _serialize_native_request  # noqa: E402
from src.services.balancer.algorithm.player_loader import (  # noqa: E402
    load_players_from_dict,
    parse_player_node,
)
from src.services.balancer.algorithm.result_serializer import teams_to_json  # noqa: E402
from src.services.balancer.algorithm.runtime import _prepare_balance_context  # noqa: E402
from src.services.balancer.config.defaults import AlgorithmConfig  # noqa: E402
from src.services.balancer.config.presets import ConfigBuilder, ConfigPresets  # noqa: E402
from src.services.balancer.config.provider import EDITABLE_CONFIG_FIELD_KEYS  # noqa: E402
from src.services.balancer.config.public_contract import PUBLIC_CONFIG_KEYS  # noqa: E402

FLEX_ONLY_MASK = {FLEX_SLOT_CODE: 6}
ROLE_MASK = {"tank": 1, "dps": 2, "support": 2}
LEGACY_ROLE_MASK = {"Tank": 1, "Damage": 2, "Support": 2}


def _class(rank: int, priority: int, *, is_active: bool = True, subtype: str = "") -> dict[str, Any]:
    node: dict[str, Any] = {"isActive": is_active, "rank": rank, "priority": priority}
    if subtype:
        node["subtype"] = subtype
    return node


def _node(name: str, classes: dict[str, Any], *, is_full_flex: bool = False) -> dict[str, Any]:
    return {
        "identity": {"name": name, "isFullFlex": is_full_flex},
        "stats": {"classes": classes},
    }


# ---------------------------------------------------------------------------
# 1-3. The flex-only mask: nobody is dropped, flex carries the best rating
# ---------------------------------------------------------------------------


def _tank_and_support_player():
    # Support is the stronger role but the lower priority, so a "max, not
    # primary" policy is observable: 3100 rather than 2600.
    player = parse_player_node(
        "u-1",
        _node("Tank And Support", {"Tank": _class(2600, 0), "Support": _class(3100, 1)}),
        FLEX_ONLY_MASK,
    )
    assert player is not None, "a flex slot accepts anyone — the player must survive parsing"
    return player


def test_flex_only_mask_keeps_the_player_and_synthesizes_the_best_rank() -> None:
    player = _tank_and_support_player()

    assert player.ratings[FLEX_SLOT_CODE] == 3100
    assert player.preferences[0] == FLEX_SLOT_CODE


def test_flex_slot_costs_no_discomfort() -> None:
    # entities.py:48 — flex is preferences[0], so its index * 100 is 0. Without
    # the prepend it would land on the "playable but unpreferred" 1000 branch.
    assert _tank_and_support_player().discomfort_map[FLEX_SLOT_CODE] == 0


def test_role_ratings_survive_a_mask_without_role_slots() -> None:
    # ``all_ratings`` in the saved balance is the admin panel's view of what a
    # player can do; collapsing him to a single flex number would erase it.
    ratings = _tank_and_support_player().ratings

    assert ratings == {"tank": 2600, "support": 3100, FLEX_SLOT_CODE: 3100}


# ---------------------------------------------------------------------------
# 4. Hybrid roster: some role slots, some flex slots
# ---------------------------------------------------------------------------


def test_hybrid_mask_carries_both_the_role_rating_and_the_flex_rating() -> None:
    player = parse_player_node(
        "u-2",
        _node("Hybrid", {"Tank": _class(2600, 1), "Support": _class(3100, 0)}),
        {"tank": 1, FLEX_SLOT_CODE: 5},
    )

    assert player is not None
    assert player.ratings["tank"] == 2600
    assert player.ratings[FLEX_SLOT_CODE] == 3100
    # Flex outranks the role preference: a flex slot is never a compromise.
    assert player.preferences[0] == FLEX_SLOT_CODE
    assert "tank" in player.preferences


# ---------------------------------------------------------------------------
# 5. Nothing to synthesize from
# ---------------------------------------------------------------------------


def test_player_without_a_single_ranked_active_role_is_still_dropped() -> None:
    node = _node(
        "Empty",
        {
            "Tank": _class(2600, 0, is_active=False),
            "Support": _class(0, 1),
        },
    )

    assert parse_player_node("u-3", node, FLEX_ONLY_MASK) is None


# ---------------------------------------------------------------------------
# 6. A mask without flex behaves exactly as before
# ---------------------------------------------------------------------------


def test_mask_without_flex_is_unchanged() -> None:
    player = parse_player_node(
        "u-4",
        _node(
            "Classic",
            {
                "Tank": _class(2600, 1),
                "Damage": _class(2900, 0, subtype="hitscan"),
                "Support": _class(3100, 2),
            },
        ),
        ROLE_MASK,
    )

    assert player is not None
    assert FLEX_SLOT_CODE not in player.ratings
    assert FLEX_SLOT_CODE not in player.discomfort_map
    assert player.ratings == {"tank": 2600, "dps": 2900, "support": 3100}
    assert player.preferences == ["dps", "tank", "support"]
    assert player.subclasses == {"dps": "hitscan"}
    assert player.discomfort_map == {"dps": 0, "tank": 100, "support": 200}


# ---------------------------------------------------------------------------
# 7. A flex assignment is not an off-role assignment
# ---------------------------------------------------------------------------


def test_flex_assignment_is_not_counted_as_off_role() -> None:
    mask = {FLEX_SLOT_CODE: 2}
    teams = []
    for team_index, ranks in enumerate(((3100, 2600), (3000, 2700)), start=1):
        team = Team(team_index, mask)
        for player_index, rank in enumerate(ranks):
            player = parse_player_node(
                f"u-{team_index}-{player_index}",
                _node(f"P{team_index}{player_index}", {"Tank": _class(rank, 0)}),
                mask,
            )
            assert player is not None
            team.add_player(FLEX_SLOT_CODE, player)
        teams.append(team)

    result = teams_to_json(teams, mask)

    assert result["statistics"]["off_role_count"] == 0
    assert result["statistics"]["off_role_rate"] == 0.0


# ---------------------------------------------------------------------------
# 8. The invariant the Rust solver depends on
# ---------------------------------------------------------------------------


def test_flex_only_mask_loses_no_player() -> None:
    roles = ("Tank", "Damage", "Support", "Tank", "Damage", "Support")
    payload = {
        "players": {
            f"u-{index}": _node(f"Player {index}", {role: _class(2500 + index * 10, 0)})
            for index, role in enumerate(roles)
        }
    }

    players = load_players_from_dict(payload, FLEX_ONLY_MASK)

    assert len(players) == len(roles) == sum(FLEX_ONLY_MASK.values())
    assert all(FLEX_SLOT_CODE in player.ratings for player in players)


# ---------------------------------------------------------------------------
# 9. What actually reaches Rust
# ---------------------------------------------------------------------------


def test_native_request_carries_the_flex_mask_and_flex_ratings() -> None:
    # The native module builds only on Linux, so the contract under test is the
    # serialized request, not the solver run.
    payload = {
        "players": {f"u-{index}": _node(f"Player {index}", {"Damage": _class(2500 + index, 0)}) for index in range(6)}
    }
    players = load_players_from_dict(payload, FLEX_ONLY_MASK)
    config = AlgorithmConfig(role_mask=dict(FLEX_ONLY_MASK))

    request = json.loads(
        _serialize_native_request(
            players=players,
            num_teams=1,
            config=config,
            role_assignment={player.uuid: FLEX_SLOT_CODE for player in players},
            seed=7,
        )
    )

    assert request["mask"] == FLEX_ONLY_MASK
    assert len(request["players"]) == 6
    for entry in request["players"]:
        assert FLEX_SLOT_CODE in entry["ratings"]
        assert entry["preferences"][0] == FLEX_SLOT_CODE
        assert entry["seed_role"] == FLEX_SLOT_CODE


# ---------------------------------------------------------------------------
# 10-11. The mask is no longer a balancer setting
# ---------------------------------------------------------------------------


def test_role_mask_is_not_an_editable_or_public_config_field() -> None:
    # It is a projection of the tournament roster shape, resolved per run; an
    # editable copy would be a second source of truth that silently wins.
    assert "role_mask" not in EDITABLE_CONFIG_FIELD_KEYS
    assert "role_mask" not in PUBLIC_CONFIG_KEYS


def test_default_role_mask_is_the_canonical_roster_shape() -> None:
    assert AlgorithmConfig().role_mask == DEFAULT_ROSTER_SLOTS
    assert ConfigPresets.DEFAULT["role_mask"] == DEFAULT_ROSTER_SLOTS


# ---------------------------------------------------------------------------
# 12. Saved legacy configs keep resolving
# ---------------------------------------------------------------------------


def test_legacy_capitalized_mask_still_resolves_player_roles() -> None:
    # ``balance.config_json`` rows saved before the roster shape existed carry
    # {"Tank": 1, "Damage": 2, "Support": 2}. ``resolve_input_role_name`` is the
    # bridge that keeps them loadable; deleting it would break every old row.
    player = parse_player_node(
        "u-5",
        _node("Legacy", {"Tank": _class(2600, 1), "Damage": _class(2900, 0), "Support": _class(3100, 2)}),
        LEGACY_ROLE_MASK,
    )

    assert player is not None
    assert player.ratings == {"Tank": 2600, "Damage": 2900, "Support": 3100}
    assert player.preferences == ["Damage", "Tank", "Support"]
    assert FLEX_SLOT_CODE not in player.ratings


# ---------------------------------------------------------------------------
# 13. ConfigBuilder validates through the canon
# ---------------------------------------------------------------------------


def test_config_builder_normalizes_the_mask_through_the_roster_canon() -> None:
    built = ConfigBuilder().with_role_mask({FLEX_SLOT_CODE: 5, "tank": 1}).build()

    # Canonical order comes from ROSTER_SLOT_CODES, not from the caller.
    assert list(built["role_mask"].items()) == [("tank", 1), (FLEX_SLOT_CODE, 5)]


@pytest.mark.parametrize(
    "garbage",
    [
        {},
        {"tank": 0},
        {"Tank": 1, "Damage": 2, "Support": 2},
        {"tank": "1"},
        {"tank": 1, "healer": 2},
        {"tank": 99},
        [("tank", 1)],
    ],
)
def test_config_builder_rejects_a_mask_the_canon_rejects(garbage: Any) -> None:
    with pytest.raises(ValueError):
        ConfigBuilder().with_role_mask(garbage)


# ---------------------------------------------------------------------------
# 14. The run takes the mask from the resolver
# ---------------------------------------------------------------------------


def test_balance_run_takes_the_mask_from_the_resolved_roster_shape() -> None:
    payload = {
        "players": {
            f"u-{index}": _node(
                f"Player {index}",
                {("Tank", "Damage", "Support")[index % 3]: _class(2500 + index, 0)},
            )
            for index in range(12)
        }
    }

    # Captains stay on: role assignment and captain pinning must also survive a
    # roster with no role slots, since that is what the whole run depends on.
    config, valid_players, num_teams, _, role_assignment, _ = _prepare_balance_context(
        payload,
        # A stale saved config must not win over the tournament's shape.
        {"role_mask": ROLE_MASK},
        None,
        role_mask=dict(FLEX_ONLY_MASK),
    )

    assert config.role_mask == FLEX_ONLY_MASK
    assert num_teams == 2
    assert len(valid_players) == 12
    assert set(role_assignment.values()) == {FLEX_SLOT_CODE}
    assert sum(1 for player in valid_players if player.is_captain) == num_teams
