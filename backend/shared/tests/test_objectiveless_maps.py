from shared.domain.objectiveless_maps import AcceptedGame, LoggedMap, Series, resolve_scores

#: Two participations, and the source tournament teams the logs name.
FIRST, SECOND = 101, 102
HOME, AWAY = 10, 20
CONTROL, ESCORT, PUSH, CLASH = 1, 2, 3, 4
OBJECTIVELESS = {PUSH, CLASH}


def series(first: int, second: int, *, completed: bool = True) -> Series:
    return Series(
        teams={FIRST: HOME, SECOND: AWAY},
        completed=completed,
        scores={FIRST: float(first), SECOND: float(second)},
    )


def game(map_id: int | None, first: int | None, second: int | None) -> AcceptedGame:
    return AcceptedGame(map_id=map_id, scores={FIRST: first, SECOND: second})


def logged(match_id: int, map_id: int, score: tuple[int, int] = (0, 0), *, flipped: bool = False) -> LoggedMap:
    """``flipped``: the log lists the encounter's second seat first."""
    return LoggedMap(
        match_id=match_id,
        map_id=map_id,
        home_team_id=AWAY if flipped else HOME,
        home_score=score[0],
        away_score=score[1],
        objectiveless=map_id in OBJECTIVELESS,
    )


def test_accepted_game_decides_the_map_in_the_logs_orientation() -> None:
    scores = resolve_scores(
        series(0, 0, completed=False),
        [logged(1, PUSH, flipped=True)],
        [game(PUSH, 1, 0)],
    )
    assert scores == {1: (0, 1)}


def test_last_unknown_map_goes_to_the_side_still_owed_a_win() -> None:
    # Control: first wins. Escort, logged second-first as 3:1: second wins. 1:2 -> Push is second's.
    maps = [logged(1, CONTROL, (2, 0)), logged(2, ESCORT, (3, 1), flipped=True), logged(3, PUSH, flipped=True)]
    assert resolve_scores(series(1, 2), maps, []) == {3: (1, 0)}


def test_wins_that_do_not_add_up_decide_nothing() -> None:
    maps = [logged(1, CONTROL, (2, 0)), logged(2, PUSH)]
    # 2:1 needs three decisive maps; one decisive log is missing.
    assert resolve_scores(series(2, 1), maps, []) == {2: (0, 0)}
    # The second seat is owed nothing and the first already has its one win:
    # Push was a draw or a log is wrong.
    assert resolve_scores(series(1, 0), maps, []) == {2: (0, 0)}


def test_several_unknown_maps_are_decided_only_when_one_side_takes_them_all() -> None:
    maps = [logged(1, CONTROL, (2, 0)), logged(2, PUSH), logged(3, CLASH)]
    assert resolve_scores(series(3, 0), maps, []) == {2: (1, 0), 3: (1, 0)}
    assert resolve_scores(series(2, 1), maps, []) == {2: (0, 0), 3: (0, 0)}


def test_accepted_game_count_must_match_the_logs() -> None:
    # Wins add up (2:0), but three games were played: a drawn map has no log.
    maps = [logged(1, CONTROL, (2, 0)), logged(2, PUSH)]
    games = [game(None, 1, 0)] * 2 + [game(None, 0, 0)]
    assert resolve_scores(series(2, 0), maps, games) == {2: (0, 0)}
    assert resolve_scores(series(2, 0), maps, games[:2]) == {2: (1, 0)}


def test_open_series_is_never_decided_by_exclusion() -> None:
    assert resolve_scores(series(2, 0, completed=False), [logged(1, CONTROL, (2, 0)), logged(2, PUSH)], []) == {
        2: (0, 0)
    }


def test_map_played_twice_is_decided_by_neither_game() -> None:
    games = [game(PUSH, 1, 0), game(PUSH, 0, 1)]
    assert resolve_scores(series(1, 1, completed=False), [logged(1, PUSH)], games) == {1: (0, 0)}


def test_a_game_missing_a_seats_number_decides_nothing() -> None:
    """``game_team.score`` is nullable: a position with no numbers entered for
    one seat is not a result, and must not be read as a 0."""
    assert resolve_scores(series(0, 0, completed=False), [logged(1, PUSH)], [game(PUSH, 1, None)]) == {1: (0, 0)}


def test_a_lobby_is_never_resolved_by_exclusion() -> None:
    """Exclusion is a two-sided argument; three seats have no home/away at all."""
    lobby = Series(
        teams={FIRST: HOME, SECOND: AWAY, 103: 30},
        completed=True,
        scores={FIRST: 1.0, SECOND: 1.0, 103: 1.0},
    )
    assert resolve_scores(lobby, [logged(1, PUSH)], []) == {1: (0, 0)}
