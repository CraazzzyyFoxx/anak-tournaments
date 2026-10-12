"""The encounter's games: one row per position, and what each participation did
in it.

A ``Match`` (``matches.match``) is what a parsed log OBSERVED; an
``EncounterGame`` is what the tournament DECIDED for one position. This service
owns that decision end to end -- opening positions (from the map pick-ban, or
one at a time in freeplay), accepting a result, cancelling -- for a duel and a
lobby alike: a game's numbers live in one ``encounter.game_team`` row per active
participation, so N seats are written the same way two are (D55, D58).

It never writes the encounter's standing itself. Every accepted or retired game
ends in :func:`shared.services.encounter.result.refresh_from_games`, the single
result writer, which re-scores the whole series through the encounter's own
``scoring_rule`` and confirms it once the rule's end condition holds (D57, D68).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import http_status as status
from shared.core.enums import (
    EncounterGameResultSource,
    EncounterGameState,
    EncounterResultAuditAction,
    EncounterResultStatus,
)
from shared.core.errors import ApiExc
from shared.core.errors import BaseAPIException as HTTPException
from shared.domain import pick_ban_engine as engine
from shared.domain.encounter_scoring import (
    EncounterOutcome,
    FfaResultError,
    GameLine,
    ScoringRules,
    compile_rules,
    evaluate_encounter,
)
from shared.domain.encounter_scoring import (
    normalize_game_lines as _normalize_game_lines,
)
from shared.models.encounter.encounter import Encounter
from shared.models.encounter.game import EncounterGame, EncounterGameTeam
from shared.models.encounter.pick_ban import PickBanEntry
from shared.repository import (
    EncounterGameClaimRepository,
    EncounterGameRepository,
    EncounterGameTeamRepository,
    PickBanEntryRepository,
    ScoringRuleRepository,
)
from shared.services.encounter.game_audit import cancel_games as _cancel_games
from shared.services.encounter.participants import active_teams
from shared.services.encounter.result import refresh_from_games
from src.services.encounter.settle import settle_confirmed
from src.services.encounter.veto_session import side_pick_pending
from src.services.tournament.events import enqueue_encounter_completed

__all__ = ("GameResultIn", "EncounterGameService", "OPEN_STATES", "encounter_game_service", "require_filled_seats")

# States a game can still move out of. ``cancelled`` is terminal history and
# ``confirmed`` only moves via the admin correction command.
OPEN_STATES = (
    EncounterGameState.PLANNED,
    EncounterGameState.AWAITING_RESULT,
    EncounterGameState.DISPUTED,
)


def require_filled_seats(encounter: Encounter, seats: Sequence) -> None:
    """409 while a slot of the encounter has nobody in it (D64).

    A game does not start before its slots are filled, and a result with an
    empty slot would let the one seated captain decide an encounter alone.
    """
    if len(seats) < encounter.slot_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=[
                ApiExc(
                    code="seats_incomplete",
                    msg="Every slot of this encounter has to be filled before a result can be reported",
                )
            ],
        )


@dataclass(frozen=True, slots=True)
class GameResultIn:
    """One participation's numbers for one game, as a caller states them.

    ``placement`` is left out when the rule derives it from the formula;
    ``column_values`` carries the organizer's columns, and is empty under the
    ``wins`` preset, where a game is decided by ``score`` alone.
    """

    encounter_team_id: int
    score: int | None = None
    placement: int | None = None
    column_values: Mapping[str, float] = field(default_factory=dict)


def _line(result: GameResultIn) -> GameLine:
    return GameLine(
        encounter_team_id=result.encounter_team_id,
        score=result.score,
        placement=result.placement,
        values=dict(result.column_values),
    )


def normalize_results(
    results: Sequence[GameResultIn],
    participant_ids: Sequence[int],
    rules: ScoringRules,
) -> tuple[GameLine, ...]:
    """Validate one game's lines against the rule, or raise 422 with its code."""
    try:
        return _normalize_game_lines([_line(item) for item in results], participant_ids, rules)
    except FfaResultError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=[ApiExc(code=exc.code, msg=str(exc))],
        ) from exc


class EncounterGameService:
    """Game lifecycle. The only writer of ``encounter.game``/``game_team``."""

    def __init__(
        self,
        *,
        game_repo: EncounterGameRepository = EncounterGameRepository(),
        line_repo: EncounterGameTeamRepository = EncounterGameTeamRepository(),
        claim_repo: EncounterGameClaimRepository = EncounterGameClaimRepository(),
        entry_repo: PickBanEntryRepository = PickBanEntryRepository(),
        rule_repo: ScoringRuleRepository = ScoringRuleRepository(),
    ) -> None:
        self.game_repo = game_repo
        self.line_repo = line_repo
        self.claim_repo = claim_repo
        self.entry_repo = entry_repo
        self.rule_repo = rule_repo

    # -- reads ------------------------------------------------------------
    async def list_games(
        self, session: AsyncSession, encounter_id: int, *, include_cancelled: bool = False
    ) -> list[EncounterGame]:
        """The games in series order; cancelled positions are history."""
        games = await self.game_repo.list_for_encounter(session, encounter_id, include_cancelled=include_cancelled)
        return sorted(games, key=lambda game: (game.position, game.id or 0))

    async def lines_by_game(
        self, session: AsyncSession, games: Sequence[EncounterGame]
    ) -> dict[int, list[EncounterGameTeam]]:
        """``game_id -> its participation rows``; every given game gets a key."""
        grouped: dict[int, list[EncounterGameTeam]] = {game.id: [] for game in games}
        for row in await self.line_repo.list_for_games(session, [game.id for game in games]):
            grouped.setdefault(row.game_id, []).append(row)
        return grouped

    async def claims_by_game(self, session: AsyncSession, games: Sequence[EncounterGame]) -> dict[int, list[Any]]:
        """``game_id -> the claims filed against it``; every game gets a key."""
        grouped: dict[int, list[Any]] = {game.id: [] for game in games}
        for game in games:
            grouped[game.id] = list(await self.claim_repo.list_for_game(session, game.id))
        return grouped

    async def rules(self, session: AsyncSession, encounter: Encounter) -> ScoringRules:
        """The encounter's compiled scoring rule. A missing row is a 404, not a
        silent fallback: scoring a game by the wrong rule is worse than failing."""
        rule = await self.rule_repo.get(session, encounter.scoring_rule_id)
        if rule is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Encounter {encounter.id} points at scoring rule {encounter.scoring_rule_id}, which is gone",
            )
        return compile_rules(rule)

    async def confirmed_game_lines(self, session: AsyncSession, encounter: Encounter) -> list[list[GameLine]]:
        """The confirmed games the LIVE seats cover, oldest position first.

        A game whose line-up includes a participation that has since been taken
        over counts for nobody -- the same rule :func:`refresh_from_games`
        scores by, so a claim is validated against exactly what the writer
        would compute.
        """
        live = {seat.id for seat in await active_teams(session, encounter.id)}
        return [
            [
                GameLine(
                    encounter_team_id=row.encounter_team_id,
                    score=row.score,
                    placement=row.placement,
                    values=row.column_values or {},
                )
                for row in lines
            ]
            for lines in await self.line_repo.confirmed_lines(session, encounter.id)
            if live.issuperset(row.encounter_team_id for row in lines)
        ]

    async def standing(self, session: AsyncSession, encounter: Encounter) -> EncounterOutcome:
        """What the confirmed games add up to right now, without writing it.

        The same engine :func:`refresh_from_games` settles the official result
        by, so a reader asking "is another map due?" and the writer confirming
        the series can never answer it differently.
        """
        seats = await active_teams(session, encounter.id)
        return evaluate_encounter(
            await self.rules(session, encounter),
            best_of=encounter.best_of,
            team_ids=[seat.id for seat in seats],
            games=await self.confirmed_game_lines(session, encounter),
        )

    async def series_settled(self, session: AsyncSession, encounter: Encounter) -> bool:
        """Is the encounter over on the games already confirmed?"""
        return (await self.standing(session, encounter)).ended

    # -- opening positions -------------------------------------------------
    async def open_game(
        self,
        session: AsyncSession,
        encounter: Encounter,
        *,
        position: int,
        map_id: int | None = None,
        state: EncounterGameState = EncounterGameState.PLANNED,
    ) -> EncounterGame:
        """Open one position and seat every live participation in it.

        The ``game_team`` rows are written WITH the game: they are "who is in
        this game", and a position without them could collect a claim naming a
        participation the composite FK would then refuse.
        """
        game = await self.game_repo.create(
            session,
            EncounterGame(
                encounter_id=encounter.id,
                position=position,
                map_id=map_id,
                state=state,
            ),
        )
        await self.line_repo.create_many(
            session,
            [
                EncounterGameTeam(
                    game_id=game.id,
                    encounter_id=encounter.id,
                    encounter_team_id=seat.id,
                )
                for seat in await active_teams(session, encounter.id)
            ],
        )
        return game

    async def ensure_next_game(self, session: AsyncSession, encounter: Encounter) -> EncounterGame | None:
        """The position that should be played right now, opening one if the card
        still has room. ``None`` once the encounter is decided or full."""
        if await self.series_settled(session, encounter):
            return None
        games = await self.list_games(session, encounter.id)
        open_game = next((game for game in games if game.state in OPEN_STATES), None)
        if open_game is not None:
            return open_game
        if len(games) >= encounter.best_of:
            return None
        return await self.open_game(
            session,
            encounter,
            position=max((game.position for game in games), default=0) + 1,
        )

    async def sync_games_with_picks(
        self,
        session: AsyncSession,
        encounter: Encounter,
        map_pick_ban: Any,
        *,
        blocked_positions: frozenset[int] = frozenset(),
    ) -> list[EncounterGame]:
        """Make the live games mirror the map session's settled picks.

        Never touches a confirmed game: an undo that would strand one is refused
        upstream, so reaching here means the tail is still unplayed.

        ``blocked_positions`` are positions that may be NAMED but must not open
        for claims yet -- a game cannot start while a required ``side_pick`` of
        its round is unresolved (spec §6 row 9), so the map lands and the state
        stays ``planned`` until the pick does.
        """
        entries = list(await self.entry_repo.list_by_session(session, map_pick_ban.id))
        games = await self.list_games(session, encounter.id)
        claims = await self.claims_by_game(session, games)
        changes, stale = self._pick_game_changes(entries, games, claims)
        if not changes and not stale:
            return games
        for position, entry, game in changes:
            opening = (
                EncounterGameState.PLANNED if position in blocked_positions else EncounterGameState.AWAITING_RESULT
            )
            if game is None:
                game = await self.open_game(
                    session,
                    encounter,
                    position=position,
                    map_id=entry.item_id,
                    state=opening,
                )
                games.append(game)
            else:
                game.map_id = entry.item_id
                if game.state == EncounterGameState.PLANNED and position not in blocked_positions:
                    game.state = EncounterGameState.AWAITING_RESULT
        if stale:
            await self.cancel_games(session, encounter, stale, actor_user_id=None, reason="pick_undone")
        await session.flush()
        return sorted(
            (game for game in games if game.state != EncounterGameState.CANCELLED),
            key=lambda game: (game.position, game.id or 0),
        )

    @staticmethod
    def _pick_game_changes(
        entries: Sequence[PickBanEntry],
        games: Sequence[EncounterGame],
        claims: Mapping[int, Sequence[Any]],
    ) -> tuple[list[tuple[int, PickBanEntry, EncounterGame | None]], list[EncounterGame]]:
        """The exact write plan, also used for the room's unlocked drift check."""
        settled = engine.settled_in_order(entries)
        by_position = {game.position: game for game in games}

        changes = []
        for position, entry in enumerate(settled, 1):
            game = by_position.get(position)
            if game is None or (
                game.map_id != entry.item_id
                and game.state in (EncounterGameState.PLANNED, EncounterGameState.AWAITING_RESULT)
                and not claims.get(game.id)
            ):
                changes.append((position, entry, game))

        stale = [
            game
            for game in games
            if game.position > len(settled) and game.state != EncounterGameState.CONFIRMED and not claims.get(game.id)
        ]
        return changes, stale

    # -- commands ----------------------------------------------------------
    async def assert_side_settled(self, session: AsyncSession, encounter: Encounter, game: EncounterGame) -> None:
        """409 while the position still owes a ``side_pick`` an answer.

        A game cannot START before the side it is played on is decided (spec §6
        row 9), and "started" is exactly what a map selection, a claim or an
        accepted result make of it. Leaving the row ``planned`` was never the
        gate -- nothing reads that state as a refusal -- so the three write
        paths ask the room directly.
        """
        if await side_pick_pending(session, encounter.id, game.position):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=[
                    ApiExc(
                        code="side_pick_pending",
                        msg="This map's sides have not been picked yet; finish the pick-ban first",
                    )
                ],
            )

    async def record_result(
        self,
        session: AsyncSession,
        encounter: Encounter,
        game: EncounterGame,
        *,
        results: Sequence[GameResultIn],
        source: EncounterGameResultSource,
        actor_user_id: int | None,
        reason: str | None = None,
    ) -> EncounterOutcome:
        """Write one position's accepted numbers and re-score the encounter.

        First write confirms the game; a later one is a correction. Both bump
        ``game.result_version`` -- the number a claim's ``basis_version`` is
        checked against -- and both end in the single result writer, so the
        encounter's standing can never disagree with its games.
        """
        await self.assert_side_settled(session, encounter, game)
        rules = await self.rules(session, encounter)
        seats = await active_teams(session, encounter.id)
        require_filled_seats(encounter, seats)
        normalized = normalize_results(results, [seat.id for seat in seats], rules)
        # Only an ENTERED place is stored: a rule that derives the place does so
        # again on every read, so persisting today's ranking would freeze it
        # under a formula the organizer may still change.
        entered = any(item.placement is not None for item in results)

        correcting = game.state == EncounterGameState.CONFIRMED
        by_team = {row.encounter_team_id: row for row in await self.line_repo.list_for_games(session, [game.id])}
        new_rows: list[EncounterGameTeam] = []
        for line in normalized:
            row = by_team.get(line.encounter_team_id)
            if row is None:
                row = EncounterGameTeam(
                    game_id=game.id,
                    encounter_id=encounter.id,
                    encounter_team_id=line.encounter_team_id,
                )
                new_rows.append(row)
            row.score = line.score
            row.placement = line.placement if entered else None
            row.column_values = dict(line.values)

        game.state = EncounterGameState.CONFIRMED
        game.result_source = source
        game.confirmed_at = datetime.now(UTC)
        game.result_version = (game.result_version or 0) + 1
        await self.line_repo.create_many(session, new_rows)

        was_confirmed = encounter.result_status == EncounterResultStatus.CONFIRMED
        outcome = await refresh_from_games(
            session,
            encounter,
            action=(EncounterResultAuditAction.GAME_CORRECT if correcting else EncounterResultAuditAction.GAME_CONFIRM),
            audit_source=source.value,
            actor_user_id=actor_user_id,
            game=game,
            reason=reason,
        )
        # Under D57 this is the MAIN way an encounter completes: the last map
        # being accepted is what ends the series, and a lobby finishes its card
        # the same way. So it owes what every confirmation owes -- the
        # announcement (one consumer: achievement and MVP evaluation), the
        # bracket advancing and the standings -- or a claim-decided series
        # would leave its winner out of the next round.
        if not was_confirmed and encounter.result_status == EncounterResultStatus.CONFIRMED:
            await enqueue_encounter_completed(session, encounter)
            await settle_confirmed(session, encounter)
        return outcome

    async def select_map(
        self, session: AsyncSession, encounter: Encounter, game: EncounterGame, *, map_id: int
    ) -> EncounterGame:
        """Name the map a live position is played on (freeplay's half of what the
        pick-ban does automatically)."""
        if game.state not in OPEN_STATES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=[ApiExc(code="result_locked", msg="This game's result is already settled")],
            )
        await self.assert_side_settled(session, encounter, game)
        if await self.claim_repo.list_for_game(session, game.id) and game.map_id != map_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=[ApiExc(code="map_locked", msg="A captain already reported this map; it cannot be changed")],
            )
        game.map_id = map_id
        if game.state == EncounterGameState.PLANNED:
            game.state = EncounterGameState.AWAITING_RESULT
        await session.flush()
        return game

    async def cancel_games(
        self,
        session: AsyncSession,
        encounter: Encounter,
        games: Sequence[EncounterGame],
        *,
        actor_user_id: int | None,
        reason: str,
    ) -> None:
        """Retire positions as history and re-score what is left.

        A cancelled confirmed game takes its points out of the standing, so the
        encounter is re-scored here rather than by whoever cancelled.
        """
        if not _cancel_games(games):
            return
        await session.flush()
        await refresh_from_games(
            session,
            encounter,
            action=EncounterResultAuditAction.GAME_CANCEL,
            audit_source="admin" if actor_user_id is not None else "system",
            actor_user_id=actor_user_id,
            reason=reason,
        )

    # -- serialization -----------------------------------------------------
    async def claim_payloads(
        self, session: AsyncSession, games: Sequence[EncounterGame]
    ) -> dict[int, list[dict[str, Any]]]:
        """``game_id -> the claims filed against it``, wire-shaped, every game keyed.

        Both participations' numbers go out as filed: the room decides what to
        show a viewer before everyone has claimed, exactly as it did when the
        claims were ``reports[]`` (spec §6).
        """
        grouped = await self.claims_by_game(session, games)
        by_claim = await self.claim_repo.results_for_claims(
            session, [claim.id for claims in grouped.values() for claim in claims]
        )
        return {
            game_id: [
                {
                    "claimant_team_id": claim.claimant_team_id,
                    "basis_version": claim.basis_version,
                    "results": [
                        {
                            "encounter_team_id": row.encounter_team_id,
                            "score": row.score,
                            "placement": row.placement,
                            "column_values": dict(row.column_values or {}),
                        }
                        for row in by_claim[claim.id]
                    ],
                }
                for claim in claims
            ]
            for game_id, claims in grouped.items()
        }

    def serialize(
        self, game: EncounterGame, lines: Sequence[EncounterGameTeam], claims: Sequence[dict[str, Any]]
    ) -> dict[str, Any]:
        return {
            "id": game.id,
            "position": game.position,
            "map_id": game.map_id,
            "state": game.state.value if game.state is not None else None,
            "result_source": game.result_source.value if game.result_source is not None else None,
            "result_version": game.result_version,
            "confirmed_at": game.confirmed_at.isoformat() if game.confirmed_at is not None else None,
            "results": [
                {
                    "encounter_team_id": row.encounter_team_id,
                    "score": row.score,
                    "placement": row.placement,
                    "column_values": dict(row.column_values or {}),
                }
                for row in sorted(lines, key=lambda row: row.encounter_team_id)
            ],
            #: One per claimant, by participation id; empty until somebody claims.
            "claims": list(claims),
        }


encounter_game_service = EncounterGameService()
