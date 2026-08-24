from datetime import UTC, datetime

from shared.domain.workspace_player_backfill import (
    RegistrationBackfillRow,
    RoleBackfillRow,
    plan_backfill,
)

T1 = datetime(2026, 1, 1, tzinfo=UTC)
T2 = datetime(2026, 2, 1, tzinfo=UTC)


def _reg(
    id: int,
    *,
    workspace_id: int = 1,
    battle_tag: str | None = "Foo#1234",
    battle_tag_normalized: str | None = "foo#1234",
    display_name: str | None = "Foo",
    player_id: int | None = None,
    overridden_at: datetime | None = None,
    roles: list[RoleBackfillRow] | None = None,
) -> RegistrationBackfillRow:
    return RegistrationBackfillRow(
        id=id,
        workspace_id=workspace_id,
        battle_tag=battle_tag,
        battle_tag_normalized=battle_tag_normalized,
        display_name=display_name,
        player_id=player_id,
        overridden_at=overridden_at,
        roles=roles or (),
    )


def test_two_regs_same_tag_later_rank_is_canon_older_pinned():
    plan = plan_backfill(
        [
            _reg(1, display_name="Old", roles=[RoleBackfillRow("tank", 3200, T1)]),
            _reg(2, display_name="New", roles=[RoleBackfillRow("tank", 3400, T2)]),
        ]
    )
    assert len(plan.players) == 1
    player = plan.players[0]
    assert player.workspace_id == 1
    assert player.battle_tag_normalized == "foo#1234"
    assert player.display_name == "New"
    assert player.ranks == {"tank": 3400}
    assert player.registration_ids == (1, 2)
    assert plan.pin_ids == frozenset({1})


def test_skips_reg_without_tag():
    plan = plan_backfill(
        [
            _reg(1, battle_tag=None, battle_tag_normalized=None, roles=[RoleBackfillRow("tank", 3200, T1)]),
            _reg(2, battle_tag="", battle_tag_normalized="", roles=[RoleBackfillRow("tank", 3200, T1)]),
        ]
    )
    assert plan.players == ()
    assert plan.pin_ids == frozenset()


def test_already_overridden_stays_pinned():
    plan = plan_backfill(
        [
            _reg(1, overridden_at=T1, roles=[RoleBackfillRow("tank", 3400, T1)]),
            _reg(2, roles=[RoleBackfillRow("tank", 3400, T2)]),
        ]
    )
    assert plan.players[0].ranks == {"tank": 3400}
    assert 1 in plan.pin_ids
    assert 2 not in plan.pin_ids
