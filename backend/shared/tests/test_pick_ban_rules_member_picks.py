"""Hero picks in a mix room (spec §11, §11.6): member answers, Fearless, the team-pick matching rule and the
assignment -- the engine's half, over plain rows."""

from random import Random
from types import SimpleNamespace

from shared.domain import pick_ban_rules as pbr

HOME, AWAY = 1001, 1002
#: Each participation's seats (``encounter.team_member`` ids) in pick order.
MEMBERS = {HOME: (11, 12), AWAY: (21, 22)}
HEROES = tuple(range(1, 9))
EACH = {"id": "each", "action": "pick", "actors": "both", "member": "each"}


def resolve(*steps):
    ruleset = pbr.parse_ruleset({"version": 2, "timer_seconds": 30, "phases": [{"id": "main", "steps": list(steps)}]})
    return pbr.resolve_round(
        ruleset, kind="hero", round=1, start_index=0, participants=(HOME, AWAY), opener=HOME, members=MEMBERS
    )


def row(step_index, team, items, *, member=None, state="locked"):
    return SimpleNamespace(
        step_index=step_index,
        encounter_team_id=team,
        team_member_id=member,
        attempt=1,
        state=state,
        items_json=[item if isinstance(item, dict) else {"item_id": item, "target_player_id": None} for item in items],
        locked_at=None,
        revealed_at=None,
    )


def entry(item_id):
    return SimpleNamespace(
        item_id=item_id,
        round=1,
        order=0,
        action_index=None,
        picked_by_kind=None,
        picked_by_team_id=None,
        picked_for_member_id=None,
        protected_by_kind=None,
        protected_by_team_id=None,
        status="available",
        carried_from_round=None,
    )


def ctx(steps, rows, *, available=HEROES, exclusions=None):
    return pbr.RuntimeCtx(
        kind="hero",
        round=1,
        available_item_ids=tuple(available),
        history=pbr.history_of(steps, rows),
        members=MEMBERS,
        exclusions={member: frozenset(heroes) for member, heroes in (exclusions or {}).items()},
    )


def assigned(member, hero):
    return {"item_id": hero, "target_player_id": None, "member_id": member}


def hero(item_id):
    return [{"item_id": item_id, "target_player_id": None}]


def test_an_each_step_waits_for_every_member_and_records_whose_hero_it_is():
    (step,) = resolve(EACH)
    rows = [row(0, HOME, [1], member=11), row(0, HOME, [2], member=12), row(0, AWAY, [3], member=21)]

    assert pbr.current_step([step], rows) is step
    assert not pbr.ready_to_reveal(step, rows)
    assert pbr.step_progress(step, rows) == {HOME: {"locked": True, "filled": 2}, AWAY: {"locked": False, "filled": 1}}
    assert pbr.actor_submission(rows, 0, HOME) is None

    rows.append(row(0, AWAY, [4], member=22))
    entries = [entry(item) for item in HEROES]
    pbr.project_entries(entries, [step], rows)

    assert pbr.ready_to_reveal(step, rows)
    assert {(e.item_id, e.picked_by_team_id, e.picked_for_member_id) for e in entries if e.status == "picked"} == {
        (1, HOME, 11),
        (2, HOME, 12),
        (3, AWAY, 21),
        (4, AWAY, 22),
    }


def test_a_team_out_of_members_owes_its_next_step_nothing():
    steps = resolve(*({"id": f"p{index}", "action": "pick", "actors": "first", "member": "next"} for index in range(3)))
    rows = [row(0, HOME, [1], member=11, state="revealed"), row(1, HOME, [2], member=12, state="revealed")]

    assert [step.member_seats for step in steps] == [[(HOME, 11)], [(HOME, 12)], []]
    assert pbr.current_step(steps, rows) is None


def test_fearless_keeps_a_member_off_their_earlier_heroes_and_nobody_else():
    (step,) = resolve(EACH)
    rules = ctx([step], [], exclusions={11: {3}})

    assert 3 not in pbr.eligible_items(step, HOME, rules, member=11).item_ids
    assert 3 in pbr.eligible_items(step, HOME, rules, member=12).item_ids
    assert pbr.validate_items(step, HOME, [{"item_id": 3, "target_player_id": None}], rules, member=11) == [
        "item_not_eligible"
    ]


def test_the_clock_gives_a_member_a_hero_they_may_take():
    (step,) = resolve(EACH)
    rules = ctx([step], [], available=(3, 4), exclusions={11: {3}})

    for seed in range(20):
        assert pbr.random_fill(step, HOME, [], rules, Random(seed), member=11) == hero(4)


def test_an_expired_member_step_gives_every_owing_seat_a_distinct_hero_it_may_take():
    (step,) = resolve(EACH)
    owing = [(HOME, 11), (AWAY, 21)]
    # 12 and 22 already locked heroes 3 and 4. 11 may take 1 or 2, 21 only 1: handing 11 hero 1 would strand 21.
    rules = ctx([step], [], available=(1, 2), exclusions={21: {2}})

    for seed in range(20):
        assert pbr.fill_member_answers(step, owing, rules, Random(seed)) == {(HOME, 11): hero(2), (AWAY, 21): hero(1)}
    open_rules = ctx([step], [], available=(1, 2))
    outcomes = {
        tuple(items[0]["item_id"] for items in pbr.fill_member_answers(step, owing, open_rules, Random(seed)).values())
        for seed in range(20)
    }
    assert outcomes == {(1, 2), (2, 1)}
    # A seat nobody can give a hero is told so rather than handed someone else's.
    assert pbr.fill_member_answers(step, owing, ctx([step], [], available=(1,)), Random(0)) in (
        {(HOME, 11): hero(1), (AWAY, 21): []},
        {(HOME, 11): [], (AWAY, 21): hero(1)},
    )


def test_a_team_pick_keeps_every_hero_the_team_picks_assignable():
    team_pick = {"action": "pick", "actors": "first"}
    steps = resolve({**team_pick, "id": "t1"}, {**team_pick, "id": "t2"}, {**team_pick, "id": "t3"})

    # Neither member may play hero 1: picking it would leave a hero nobody can take.
    assert 1 not in pbr.eligible_items(steps[0], HOME, ctx(steps, [], exclusions={11: {1}, 12: {1}})).item_ids
    # Two members, two heroes already picked: a third has nobody to go to.
    rows = [row(0, HOME, [2], state="revealed"), row(1, HOME, [3], state="revealed")]
    assert pbr.eligible_items(steps[2], HOME, ctx(steps, rows, available=(4, 5))).item_ids == ()


def _assignment_room(exclusions=None):
    team_pick = {"action": "pick", "actors": "first"}
    steps = resolve(
        {**team_pick, "id": "t1"},
        {**team_pick, "id": "t2"},
        {"id": "a", "action": "assign", "actors": "both", "count": 2},
    )
    rows = [row(0, HOME, [4], state="revealed"), row(1, HOME, [5], state="revealed")]
    return steps, rows, ctx(steps, rows, exclusions=exclusions)


def test_an_assignment_gives_each_pick_to_a_different_member_their_fearless_allows():
    steps, rows, rules = _assignment_room(exclusions={11: {4}})
    assign = steps[2]

    def issues(*pairs, final=True):
        return pbr.validate_items(assign, HOME, [assigned(m, h) for h, m in pairs], rules, final=final)

    assert issues((5, 11), (4, 12)) == []
    assert issues((4, 11), (5, 12)) == ["item_not_eligible"]
    assert issues((5, 11), (5, 12)) == ["duplicate_item"]
    assert issues((4, 12), (5, 12)) == ["duplicate_member"]
    assert issues((6, 11), (4, 12)) == ["item_not_picked"]
    assert issues((5, 21), (4, 12)) == ["member_unknown"]
    assert issues((5, 11)) == ["not_enough_items"]
    assert pbr.eligible_items(assign, HOME, rules, member=11).item_ids == (5,)

    entries = [entry(item) for item in HEROES]
    pbr.project_entries(entries, steps, [*rows, row(2, HOME, [assigned(11, 5), assigned(12, 4)], state="revealed")])
    assert {(e.item_id, e.picked_for_member_id) for e in entries if e.status == "picked"} == {(4, 12), (5, 11)}


def test_a_draft_that_would_leave_a_hero_nobody_can_play_is_refused():
    # 11 may play 4 or 5, 12 only 4: giving 11 hero 4 leaves 5 to nobody.
    steps, _, rules = _assignment_room(exclusions={12: {5}})

    assert pbr.validate_items(steps[2], HOME, [assigned(11, 4)], rules) == ["item_not_eligible"]
    assert pbr.validate_items(steps[2], HOME, [assigned(11, 5)], rules) == []


def test_a_timed_out_assignment_is_random_never_against_fearless_and_keeps_the_captains_part():
    steps, rows, rules = _assignment_room(exclusions={11: {4}})
    assign = steps[2]

    for seed in range(20):
        filled = pbr.random_fill(assign, HOME, [], rules, Random(seed))
        assert {(item["item_id"], item["member_id"]) for item in filled} == {(5, 11), (4, 12)}
    open_steps, _, open_rules = _assignment_room()
    outcomes = {
        frozenset(
            (item["item_id"], item["member_id"])
            for item in pbr.random_fill(open_steps[2], HOME, [], open_rules, Random(seed))
        )
        for seed in range(20)
    }
    assert len(outcomes) == 2
    assert pbr.random_fill(assign, HOME, [assigned(11, 5)], rules, Random(0)) == [assigned(11, 5), assigned(12, 4)]


def test_a_timed_out_draft_that_blocks_the_assignment_is_rematched():
    # 11 may play 4 or 5, 12 only 4; the captain's draft {11: 4} (saved before it could be refused) leaves 5 to nobody.
    steps, _, rules = _assignment_room(exclusions={12: {5}})

    for seed in range(20):
        filled = pbr.random_fill(steps[2], HOME, [assigned(11, 4)], rules, Random(seed))
        assert {(item["item_id"], item["member_id"]) for item in filled} == {(5, 11), (4, 12)}
