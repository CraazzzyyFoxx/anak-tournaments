from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"

for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)


from src.domain.balancer.result_serializer import lobby_document  # noqa: E402
from src.domain.mix_lobbies import lobby_state, seated_member_ids, seated_teams, with_captains  # noqa: E402


def _payload(*teams: dict[str, list[int]]) -> dict[str, object]:
    """One solver option: a role bucket per team, each holding member ids."""
    return {
        "teams": [
            {"roster": {role: [{"uuid": str(member_id)} for member_id in ids] for role, ids in team.items()}}
            for team in teams
        ]
    }


def test_membership_is_every_seat_of_the_named_option() -> None:
    document = lobby_document([_payload({"tank": [7], "damage": [8, 9]}, {"tank": [10], "damage": [11, 12]})])
    assert seated_member_ids(document, 0) == frozenset({7, 8, 9, 10, 11, 12})


def test_each_option_seats_its_own_lobby() -> None:
    # The pager decides who is playing: two options of one run can seat
    # different people, so the index is not decoration.
    document = lobby_document([_payload({"tank": [7]}), _payload({"tank": [8]})])
    assert seated_member_ids(document, 0) == frozenset({7})
    assert seated_member_ids(document, 1) == frozenset({8})


def test_a_lobby_nobody_balanced_seats_nobody() -> None:
    assert seated_member_ids(None, 0) == frozenset()


def test_an_index_past_the_stored_options_seats_nobody() -> None:
    # A mix re-balanced into fewer options leaves a stale pager behind; that
    # reads as "nobody is playing this lobby", not as a crash.
    document = lobby_document([_payload({"tank": [7]})])
    assert seated_member_ids(document, 1) == frozenset()
    assert seated_member_ids(document, -1) == frozenset()


def test_a_document_stored_before_the_lobby_form_still_answers() -> None:
    # Mixes balanced before ``lobby_document`` hold the raw solver payloads;
    # they are upgraded on read, so membership answers for them too.
    assert seated_member_ids({"variants": [_payload({"tank": [7], "damage": [8]})]}, 0) == frozenset({7, 8})


def test_a_seat_that_is_not_a_member_id_is_skipped_not_fatal() -> None:
    # A bench entry from an older document can carry a non-numeric uuid; the
    # read degrades to "not a member of this lobby" instead of failing the call.
    document = lobby_document([_payload({"tank": [7]})])
    document["variants"][0]["teams"][0]["roster"]["damage"] = ["not-a-member"]
    assert seated_member_ids(document, 0) == frozenset({7})


def test_teams_keep_their_order_so_each_one_gets_its_own_voice() -> None:
    # The voice mover needs team 1 and team 2 apart, not the union membership is.
    document = lobby_document([_payload({"tank": [7], "damage": [8]}, {"tank": [9]})])
    assert seated_teams(document, 0) == ((7, 8), (9,))


def test_teams_of_an_index_past_the_stored_options_are_empty() -> None:
    assert seated_teams(lobby_document([_payload({"tank": [7]})]), 1) == ()
    assert seated_teams(None, 0) == ()


def test_a_seat_that_is_not_a_member_id_is_left_out_of_its_team() -> None:
    document = lobby_document([_payload({"tank": [7]})])
    document["variants"][0]["teams"][0]["roster"]["damage"] = ["not-a-member"]
    assert seated_teams(document, 0) == ((7,),)


def _rated(*teams: dict[str, list[tuple[int, int]]]) -> dict[str, object]:
    """One option whose seats carry the rating the solver seated them at: ``{role: [(member, rating), ...]}``."""
    return {
        "teams": [
            {
                "roster": {
                    role: [{"uuid": str(member), "assigned_rating": rating} for member, rating in seats]
                    for role, seats in team.items()
                }
            }
            for team in teams
        ]
    }


def test_each_team_is_captained_by_its_strongest_seat() -> None:
    document = with_captains(
        lobby_document(
            [_rated({"tank": [(7, 2400)], "damage": [(8, 3100)]}, {"tank": [(9, 2900)], "support": [(10, 2800)]})]
        )
    )
    assert [team["captain_member_id"] for team in document["variants"][0]["teams"]] == [8, 9]


def test_a_rating_tie_goes_to_the_lower_member_id() -> None:
    document = with_captains(lobby_document([_rated({"tank": [(12, 3000)], "damage": [(11, 3000)]})]))
    assert document["variants"][0]["teams"][0]["captain_member_id"] == 11


def test_a_seated_captain_is_kept_and_one_who_left_is_replaced() -> None:
    document = lobby_document([_rated({"tank": [(7, 2400)], "damage": [(8, 3100)]}, {"tank": [(9, 2900)]})])
    first, second = document["variants"][0]["teams"]
    first["captain_member_id"] = 7  # a host's pick, still on the team
    second["captain_member_id"] = 8  # sits on the other team now
    with_captains(document)
    assert (first["captain_member_id"], second["captain_member_id"]) == (7, 9)


@pytest.mark.parametrize(
    ("document", "live", "pregame", "state"),
    [
        (None, None, False, "idle"),
        (lobby_document([_payload({"tank": [7]}, {"tank": [8]})]), None, False, "ready"),
        (lobby_document([_payload({"tank": [7]}, {"tank": [8]})]), 900, True, "pregame"),
        (lobby_document([_payload({"tank": [7]}, {"tank": [8]})]), 900, False, "live"),
    ],
)
def test_a_lobby_state_is_derived_never_stored(document, live, pregame, state) -> None:
    assert lobby_state(document, 0, live, pregame) == state
