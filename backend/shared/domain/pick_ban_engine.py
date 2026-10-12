"""What survived the ruleset-v2 cutover of the pick-ban engine: the pure,
DB-free rules that are NOT about resolving a step.

The step vocabulary, cursor, eligibility, undo target and projection all moved
to ``shared.domain.pick_ban_rules`` (design
``docs/plans/2026-09-28-pick-ban-constructor.md``). What stays here is the
encounter-level arithmetic both kinds still share: which round a board is on,
the play order of its settled picks, and which PARTICIPATION opens the next
round under a result-dependent rotation. What a series ADDS UP to is not here:
that is one engine for every encounter, ``shared.domain.encounter_scoring``.

Deliberately free of any AsyncSession/DB call — every function takes plain
data and returns plain data or raises ``ValueError`` (the RPC layer translates
to HTTP), so the whole module is unit-testable without a database.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Literal

from shared.core import enums

Action = Literal["ban", "pick", "protect", "decider", "side_pick"]


# ── board arithmetic ────────────────────────────────────────────────────────
#
# Both functions work over any object exposing ``status``/``round``/
# ``action_index``/``order`` -- ``PickBanEntry`` satisfies that structurally,
# so they stay free of a DB-model import.


def current_round(pool: list) -> int | None:
    """The round (map-of-the-series) the engine is resolving, or None in flat
    mode / once complete. Generalizes ``map_veto.current_slot`` — same
    arithmetic, `slot` renamed `round` for a pool-agnostic reading."""
    rounds = [e.round for e in pool if e.status == enums.MapPoolEntryStatus.AVAILABLE.value and e.round is not None]
    return min(rounds) if rounds else None


def settled_in_order(pool: list) -> list:
    """The pool's `picked` entries in PLAY order — for a map pool this is the
    series' map order, and index + 1 is the map's position in the series
    (``encounter_game.position``).

    Play order is ``action_index``, falling back to the legacy ``order``.
    ``order`` on its own is NOT the position: it is a per-round display/tiebreak
    field spaced by ``round * 1000`` (see ``captain._picked_map_ids``). Mirrors
    the frontend's ``pickedItemsInOrder``.
    """
    settled = (entry for entry in pool if entry.status == enums.MapPoolEntryStatus.PICKED.value)
    return sorted(settled, key=lambda entry: entry.action_index if entry.action_index is not None else entry.order)


# ── result-dependent rotation: who opens round N+1 ──────────────────────────


class RotationNeedsChoice(Exception):
    """Raised by `resolve_round_opener` when the rotation is
    `result_loser_choice` and no choice has been made yet — the caller must
    leave the round with `first_team_id=NULL`, `awaiting_choice=True` and wait
    for an `elect_opener` action instead of resolving an actor here."""


def resolve_round_opener(
    *,
    rotation: enums.FirstBanRotation,
    round_number: int,
    participants: Sequence[int],
    session_opener: int,
    previous_round_winner: int | None,
    previous_round_loser_choice: int | None,
) -> int:
    """Which PARTICIPATION opens `round_number`'s bans.

    Round 1 always uses `session_opener` (seed resolution — unrelated to any
    rotation setting, since there is no previous map). Round 2+ dispatches on
    `rotation`:

    - `fixed`: the same participation every round (`session_opener`).
    - `alternate`: moves one seat along the card each round, so a duel flips.
    - `result_winner_first` / `result_loser_first`: read
      `previous_round_winner`. A drawn map has no winner and no loser, so the
      rotation falls back to the snapshot opener (`session_opener`); that is
      also what a winner nobody seats any more means.
    - `result_loser_choice`: a draw leaves nobody to elect, so it too falls
      back to `session_opener`; otherwise it requires
      `previous_round_loser_choice` — if that is `None`, raises
      `RotationNeedsChoice` so the caller leaves the round in
      `awaiting_choice` state instead of resolving an actor.
    """
    seats = list(participants)
    if session_opener not in seats:
        raise ValueError("the session's opener is not one of this encounter's participations")
    if round_number <= 1 or rotation == enums.FirstBanRotation.FIXED:
        return session_opener
    if rotation == enums.FirstBanRotation.ALTERNATE:
        return seats[(seats.index(session_opener) + round_number - 1) % len(seats)]
    if rotation in (
        enums.FirstBanRotation.RESULT_WINNER_FIRST,
        enums.FirstBanRotation.RESULT_LOSER_FIRST,
        enums.FirstBanRotation.RESULT_LOSER_CHOICE,
    ):
        if previous_round_winner is None or previous_round_winner not in seats:
            return session_opener
        if rotation == enums.FirstBanRotation.RESULT_WINNER_FIRST:
            return previous_round_winner
        # The seat after the winner: for a duel that IS the loser, and for a
        # wider card it is the one rule that names exactly one participation.
        runner_up = seats[(seats.index(previous_round_winner) + 1) % len(seats)]
        if rotation == enums.FirstBanRotation.RESULT_LOSER_FIRST:
            return runner_up
        if previous_round_loser_choice is None:
            raise RotationNeedsChoice()
        return previous_round_loser_choice
    raise ValueError(f"unhandled rotation {rotation!r}")
