from __future__ import annotations

import sys
from pathlib import Path

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"
for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)


from shared.core.enums import DraftPickStatus, HeroClass  # noqa: E402
from shared.domain.roster_shape import parse_roster_slots  # noqa: E402
from shared.models.balancer.draft import DraftPick, DraftPlayer, DraftPlayerRole, DraftTeam  # noqa: E402
from shared.models.tenancy.workspace import WorkspaceMember  # noqa: E402
from src.services.draft.export import _draft_to_balancer_payload  # noqa: E402

# The two shapes the payload behaves differently under: role slots keep rank
# role-specific, an all-flex roster has no role to key rank on.
ROLE_SHAPE = parse_roster_slots({"tank": 1, "dps": 2, "support": 2})
FLEX_SHAPE = parse_roster_slots({"flex": 5})


def _team(tid: int, pos: int, name: str) -> DraftTeam:
    return DraftTeam(id=tid, session_id=1, draft_position=pos, name=name)


def _player(
    pid: int, *, captain=False, bt=None, role=HeroClass.damage, rank=3000, sub=None, uid=None, role_ranks=None
) -> DraftPlayer:
    # dbarch03: user_id resolves via ``member`` and role_ranks via the ``roles``
    # child rows — both are read-only properties now, so seed the relationships.
    return DraftPlayer(
        id=pid,
        session_id=1,
        is_captain=captain,
        battle_tag=bt,
        primary_role=role.slot_code,
        rank_value=rank,
        sub_role=sub,
        member=WorkspaceMember(player_id=uid) if uid is not None else None,
        roles=[DraftPlayerRole(role=r, rank_value=rv) for r, rv in (role_ranks or {}).items()],
    )


def _pick(player_id: int, team_id: int, *, role: HeroClass | None, rank: int | None) -> DraftPick:
    return DraftPick(
        session_id=1,
        overall_no=player_id,
        round_no=1,
        pick_in_round=1,
        draft_team_id=team_id,
        picked_player_id=player_id,
        target_role=role.slot_code if role else None,
        target_rank_value=rank,
        status=DraftPickStatus.COMPLETED.value,
    )


def test_payload_orders_by_draft_position() -> None:
    teams = [_team(1, 2, "B"), _team(2, 1, "A")]
    roster = {1: [_player(10, captain=True, bt="Bcap#1")], 2: [_player(20, captain=True, bt="Acap#1")]}
    payload = _draft_to_balancer_payload(teams, roster, ROLE_SHAPE)
    assert [p.name for p in payload] == ["Acap#1", "Bcap#1"]  # position 1 (A) first


def test_payload_uses_captain_battle_tag_as_name() -> None:
    teams = [_team(1, 1, "Display")]
    roster = {1: [_player(10, captain=True, bt="Captain#1234"), _player(11, bt="Mate#1")]}
    payload = _draft_to_balancer_payload(teams, roster, ROLE_SHAPE)
    assert payload[0].name == "Captain#1234"


def test_payload_falls_back_to_team_name_without_captain_tag() -> None:
    teams = [_team(1, 1, "Fallback")]
    roster = {1: [_player(10, captain=True, bt=None)]}
    payload = _draft_to_balancer_payload(teams, roster, ROLE_SHAPE)
    assert payload[0].name == "Fallback"


def test_payload_totals_and_members() -> None:
    teams = [_team(1, 1, "T")]
    roster = {
        1: [
            _player(10, captain=True, bt="Cap#1", role=HeroClass.tank, rank=4000),
            _player(11, bt="A#1", role=HeroClass.damage, rank=3000),
            _player(12, bt="B#1", role=HeroClass.support, rank=3500),
        ]
    }
    payload = _draft_to_balancer_payload(teams, roster, ROLE_SHAPE)
    team = payload[0]
    assert team.total_sr == 10500
    assert team.avg_sr == 3500.0
    assert len(team.members) == 3
    roles = {m.name: m.role for m in team.members}
    assert roles == {"Cap#1": "tank", "A#1": "dps", "B#1": "support"}


def test_payload_empty_roster_team() -> None:
    teams = [_team(1, 1, "Empty")]
    payload = _draft_to_balancer_payload(teams, {}, ROLE_SHAPE)
    assert payload[0].total_sr == 0
    assert payload[0].avg_sr == 0.0
    assert payload[0].members == []


def test_payload_uses_drafted_off_role_and_its_rank() -> None:
    # Player's primary is DPS@4000 but they were drafted on SUPPORT@2800.
    teams = [_team(1, 1, "T")]
    p = _player(11, bt="Mate#1", role=HeroClass.damage, rank=4000, uid=11, role_ranks={"dps": 4000, "support": 2800})
    roster = {1: [_player(10, captain=True, bt="Cap#1", role=HeroClass.tank, rank=3900, uid=10), p]}
    picks = {11: _pick(11, 1, role=HeroClass.support, rank=2800)}
    payload = _draft_to_balancer_payload(teams, roster, ROLE_SHAPE, picks)
    member = next(m for m in payload[0].members if m.name == "Mate#1")
    assert member.role == "support"  # drafted role, not primary "dps"
    assert member.rank == 2800  # off-role rank, not primary 4000


def test_payload_derives_off_role_rank_when_pick_rank_missing() -> None:
    # Legacy pick with target_role but no frozen target_rank_value -> derive from role_ranks.
    teams = [_team(1, 1, "T")]
    p = _player(11, bt="Mate#1", role=HeroClass.damage, rank=4000, uid=11, role_ranks={"dps": 4000, "support": 2800})
    roster = {1: [p]}
    picks = {11: _pick(11, 1, role=HeroClass.support, rank=None)}
    payload = _draft_to_balancer_payload(teams, roster, ROLE_SHAPE, picks)
    member = payload[0].members[0]
    assert member.role == "support"
    assert member.rank == 2800


def test_payload_captain_without_pick_uses_primary_role() -> None:
    teams = [_team(1, 1, "T")]
    roster = {1: [_player(10, captain=True, bt="Cap#1", role=HeroClass.tank, rank=3900, uid=10)]}
    payload = _draft_to_balancer_payload(teams, roster, ROLE_SHAPE, {})
    member = payload[0].members[0]
    assert member.role == "tank"
    assert member.rank == 3900


def test_flex_shape_exports_the_flex_slot_code_and_the_max_role_rank() -> None:
    # An all-flex roster drafted nobody onto a role, so the rank frozen on the
    # pick names a role the shape gives no meaning to: export the maximum. The
    # slot code says "no fixed role" outright instead of guessing the primary --
    # bulk_create_from_balancer turns it into HeroClass.flex.
    teams = [_team(1, 1, "T")]
    p = _player(11, bt="Mate#1", role=HeroClass.support, rank=2800, uid=11, role_ranks={"dps": 4000, "support": 2800})
    roster = {1: [p]}
    picks = {11: _pick(11, 1, role=None, rank=2800)}
    payload = _draft_to_balancer_payload(teams, roster, FLEX_SHAPE, picks)
    member = payload[0].members[0]
    assert member.role == "flex"
    assert member.rank == 4000


def test_flex_shape_exports_the_max_role_rank_for_a_captain() -> None:
    teams = [_team(1, 1, "T")]
    cap = _player(
        10, captain=True, bt="Cap#1", role=HeroClass.tank, rank=3100, uid=10, role_ranks={"tank": 3100, "dps": 3700}
    )
    payload = _draft_to_balancer_payload(teams, {1: [cap]}, FLEX_SHAPE, {})
    member = payload[0].members[0]
    assert member.role == "flex"
    assert member.rank == 3700
    assert payload[0].total_sr == 3700


def test_role_shape_still_exports_a_game_role_never_flex() -> None:
    # The flex slot code is reachable only from a role-less shape: a roster with
    # role slots assigns a real role to every pick, captains included.
    teams = [_team(1, 1, "T")]
    roster = {
        1: [
            _player(10, captain=True, bt="Cap#1", role=HeroClass.tank, rank=3100, uid=10),
            _player(11, bt="Mate#1", role=HeroClass.damage, rank=4000, uid=11, role_ranks={"support": 2800}),
        ]
    }
    picks = {11: _pick(11, 1, role=HeroClass.support, rank=2800)}
    payload = _draft_to_balancer_payload(teams, roster, ROLE_SHAPE, picks)
    assert sorted(m.role for m in payload[0].members) == ["support", "tank"]
