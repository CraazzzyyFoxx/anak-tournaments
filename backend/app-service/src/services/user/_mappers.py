"""ORM → narrow DTO conversion helpers for user/ flows.

These replace the wide `to_pydantic_*` family that lived in `_internal/` —
each function produces a DTO defined in `src.schemas.user` that contains
only the fields the frontend actually renders on user-scoped pages.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

import sqlalchemy as sa

from shared.core.impact import BADGE_THRESHOLD
from shared.division_grid import DivisionGrid
from shared.services.division_grid.resolution import resolve_tournament_division
from src import models, schemas
from src.core import enums
from src.schemas.base import Score
from src.schemas.division_grid import DivisionGridVersionRead

_IDENTITY_ENTITIES = ("social_accounts", "battle_tag", "discord", "twitch")


def _is_globally_visible(account: models.SocialAccount) -> bool:
    """True when the account is shown on the public profile (has a global,
    workspace-less visibility row). Fail-open when ``visibilities`` isn't
    eager-loaded so a read path that forgot to load it never silently hides
    everything — mirrors the ``visible_global=True`` default in the read model."""
    if "visibilities" in sa.inspect(account).unloaded:
        return True
    return any(v.workspace_id is None for v in account.visibilities)


def _social_account_read(account: models.SocialAccount) -> schemas.SocialAccountRead:
    """Serialize a social account, including display-visibility scopes when the
    ``visibilities`` relationship is eager-loaded (admin profile dialog). When it
    isn't loaded we leave the defaults (``visible_global=True``) and never touch
    the relationship — avoiding a lazy load outside the async greenlet."""
    read = schemas.SocialAccountRead.model_validate(account, from_attributes=True)
    if "visibilities" not in sa.inspect(account).unloaded:
        scopes = list(account.visibilities)
        read.visible_global = any(v.workspace_id is None for v in scopes)
        read.visible_workspace_ids = sorted({v.workspace_id for v in scopes if v.workspace_id is not None})
    return read


def resolve_team_placement(team: models.Team) -> int | None:
    """Pick the best (lowest, positive) overall_position across standings.

    Replaces `_internal.team.flows.resolve_team_placement` — same logic.
    """
    standings = getattr(team, "standings", None) or []
    positive_positions = [
        standing.overall_position for standing in standings if getattr(standing, "overall_position", 0) > 0
    ]
    if positive_positions:
        return min(positive_positions)
    return None


def _division_grid_version(tournament: models.Tournament) -> DivisionGridVersionRead | None:
    if getattr(tournament, "division_grid_version", None) is None:
        return None
    return DivisionGridVersionRead.model_validate(tournament.division_grid_version, from_attributes=True)


def to_user_tournament_summary(
    tournament: models.Tournament,
    *,
    division_grid_version: DivisionGridVersionRead | None,
) -> schemas.UserTournamentSummary:
    """Narrow tournament card for UserProfile.tournaments + filter lists.

    ``division_grid_version`` is supplied by the caller (resolved in bulk) so
    an unpinned tournament still reports the grid its divisions are on, which
    the ORM relationship alone cannot express.
    """
    return schemas.UserTournamentSummary(
        id=tournament.id,
        name=tournament.name,
        is_league=tournament.is_league,
        is_finished=tournament.is_finished,
        status=tournament.status,
        division_grid_version=division_grid_version,
    )


def to_user_tournament_player(
    player: models.Player,
    *,
    grid: DivisionGrid,
    avg_mvp: float | None = None,
    heroes: list[dict] | None = None,
) -> schemas.UserTournamentPlayer:
    """Player card inside UserTournament.players.

    ``avg_mvp`` and ``heroes`` are supplied by the caller from bulk lookups
    keyed by (tournament_id, user_id) — see ``queries.encounters`` — so this stays a
    pure ORM→DTO conversion with no per-player queries.
    """
    return schemas.UserTournamentPlayer(
        id=player.id,
        name=player.name,
        role=player.role,
        sub_role=player.sub_role,
        rank=player.rank,
        division=resolve_tournament_division(player.rank, tournament_grid=grid),
        # workspace_member_id is NOT NULL (contract step, iwrefac07): the
        # identity anchor is always workspace_member.player_id.
        user_id=player.workspace_member.player_id,
        is_substitution=player.is_substitution,
        is_newcomer=player.is_newcomer,
        is_newcomer_role=player.is_newcomer_role,
        related_player_id=player.related_player_id,
        relative_player=getattr(player, "relative_player", None),
        avg_mvp=avg_mvp,
        heroes=[schemas.HeroRead.model_validate(h) for h in (heroes or [])],
    )


def _duel_team_ids(seats: Sequence[models.EncounterTeam]) -> tuple[int | None, int | None]:
    """Source teams of slots 1 and 2 (``None`` for a seat that is empty or has no team)."""
    by_slot = {seat.slot: seat.team_id for seat in seats}
    return by_slot.get(1), by_slot.get(2)


def encounter_oriented_score(match: models.Match, seats: Sequence[models.EncounterTeam]) -> Score:
    """Map score in the encounter's slot order, not the log's.

    Parsed logs often write ``Match.home_team_id`` as the uploader's side, which
    is the opposite of slot 1 of the encounter. The Run then paints the
    winner's maps as losses.
    """
    first, second = _duel_team_ids(seats)
    if match.home_team_id == second and match.away_team_id == first and first != second:
        return Score(home=match.away_score, away=match.home_score)
    return Score(home=match.home_score, away=match.away_score)


def to_match_with_user_stats(
    match: models.Match,
    *,
    seats: Sequence[models.EncounterTeam],
    performance: int | None,
    heroes: list[dict] | None,
    impact_rank: int | float | None = None,
    impact_points: float | None = None,
    overperformance_score: float | None = None,
    overperf_pos: int | None = None,
) -> schemas.MatchReadWithUserStats:
    """One match in a user-scoped encounter — includes the viewer's stats.

    ``overperf_pos`` is the viewer's rank (1 = best) among all match
    participants by OverperformanceScore (match-wide window, not scoped to the
    viewer) — used only to compute ``overperformance_badge`` and not exposed
    on the schema itself. ``score`` and the two team ids follow the encounter's
    slots 1 and 2, not the log's.
    """
    map_read = schemas.MapRead.from_entity(match.map, with_gamemode=True) if match.map is not None else None
    hero_objs = [schemas.HeroRead.model_validate(h) for h in (heroes or [])]
    first, second = _duel_team_ids(seats)
    return schemas.MatchReadWithUserStats(
        id=match.id,
        home_team_id=first,
        away_team_id=second,
        score=encounter_oriented_score(match, seats),
        time=match.time,
        log_name=match.log_name,
        encounter_id=match.encounter_id,
        map_id=match.map_id,
        map_index=match.map_index,
        code=getattr(match, "code", None),
        map=map_read,
        performance=performance,
        impact_rank=int(impact_rank) if impact_rank is not None else None,
        impact_points=impact_points,
        overperformance_score=overperformance_score,
        overperformance_badge=(
            overperf_pos == 1 and overperformance_score is not None and overperformance_score >= BADGE_THRESHOLD
        ),
        heroes=hero_objs,
    )


def to_encounter_tournament_summary(
    tournament: models.Tournament | None,
) -> schemas.UserEncounterTournament | None:
    if tournament is None:
        return None
    return schemas.UserEncounterTournament(
        id=tournament.id,
        name=tournament.name,
        is_league=tournament.is_league,
        is_finished=tournament.is_finished,
        status=tournament.status,
    )


def to_encounter_stage_summary(
    stage: models.Stage | None,
) -> schemas.UserEncounterStageSummary | None:
    if stage is None:
        return None
    return schemas.UserEncounterStageSummary(id=stage.id, name=stage.name)


def to_encounter_stage_item_summary(
    stage_item: models.StageItem | None,
) -> schemas.UserEncounterStageItemSummary | None:
    if stage_item is None:
        return None
    return schemas.UserEncounterStageItemSummary(id=stage_item.id, name=stage_item.name)


@dataclass(frozen=True, slots=True)
class RosterEntry:
    """One roster snapshot row of a participation, with the account it belongs to."""

    member: models.EncounterTeamMember
    user_id: int
    #: Every role code of the member (a role and a sub-role are two rows).
    roles: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class EncounterContext:
    """What the user pages need around an encounter row: its live seats with their
    rosters, and where it sits in the bracket (nothing, outside a bracket)."""

    seats: list[tuple[models.EncounterTeam, list[RosterEntry]]]
    position: models.BracketEncounter | None = None
    stage: models.Stage | None = None
    stage_item: models.StageItem | None = None

    @property
    def participations(self) -> list[models.EncounterTeam]:
        return [seat for seat, _ in self.seats]


def _hero_class(roles: tuple[str, ...]) -> enums.HeroClass | None:
    """The first role code that is a roster role (a sub-role code is not one).

    Codes are the lowercase member NAMES -- what ``tournament.player.role`` stores.
    """
    return next((enums.HeroClass[role] for role in roles if role in enums.HeroClass.__members__), None)


def _to_encounter_team_player_ref(entry: RosterEntry) -> schemas.UserEncounterTeamPlayerRef:
    return schemas.UserEncounterTeamPlayerRef(
        id=entry.member.id,
        user_id=entry.user_id,
        role=_hero_class(entry.roles),
        name=entry.member.display_name_snapshot,
    )


def to_encounter_team_summary(
    seat: models.EncounterTeam, roster: list[RosterEntry]
) -> schemas.UserEncounterTeamSummary:
    return schemas.UserEncounterTeamSummary(
        id=seat.id,
        slot=seat.slot,
        team_id=seat.team_id,
        name=seat.name,
        score=seat.score,
        placement=seat.placement,
        players=[_to_encounter_team_player_ref(entry) for entry in roster],
    )


def _resolve_user_team_id(context: EncounterContext, user_id: int) -> int | None:
    """The source team of the seat whose roster snapshot holds the viewer."""
    for seat, roster in context.seats:
        if any(entry.user_id == user_id for entry in roster):
            return seat.team_id
    return None


def to_encounter_with_user_stats(
    encounter: models.Encounter,
    context: EncounterContext,
    matches: list[schemas.MatchReadWithUserStats],
    *,
    viewer_user_id: int | None = None,
) -> schemas.EncounterReadWithUserStats:
    """User-scoped encounter view.

    Populates tournament/team/stage summaries always — the repository loads
    the tournament, and ``context`` carries the seats and the bracket position.
    `viewer_user_id` is used to fill the convenience `user_team_id` shortcut so
    the frontend doesn't have to scan rosters itself.
    """
    return schemas.EncounterReadWithUserStats(
        id=encounter.id,
        name=encounter.name,
        slot_count=encounter.slot_count,
        round=context.position.round if context.position is not None else 0,
        best_of=encounter.best_of,
        tournament_id=encounter.tournament_id,
        status=encounter.status,
        closeness=encounter.closeness,
        has_logs=encounter.has_logs,
        result_status=getattr(encounter, "result_status", "none"),
        user_team_id=_resolve_user_team_id(context, viewer_user_id) if viewer_user_id is not None else None,
        tournament=to_encounter_tournament_summary(getattr(encounter, "tournament", None)),
        stage=to_encounter_stage_summary(context.stage),
        stage_item=to_encounter_stage_item_summary(context.stage_item),
        teams=[to_encounter_team_summary(seat, roster) for seat, roster in context.seats],
        matches=matches,
    )


_SETTLED_POOL_STATUSES = frozenset({"picked", "played"})
_MISSING_PLAYED_AT = datetime.min.replace(tzinfo=UTC)


def _pool_status(value: object) -> str:
    return str(getattr(value, "value", value))


def encounter_play_key(encounter: models.Encounter) -> tuple[datetime, int]:
    """Sort key for a series: when it was played, then id.

    Bracket rows are inserted playoffs-first, so ``id``/``created_at`` are not
    play order. ``confirmed_at`` is when the result landed; ``scheduled_at`` is
    ignored — it is a plan, not a play.
    """
    played = encounter.ended_at or encounter.confirmed_at or encounter.started_at or encounter.created_at
    return (played or _MISSING_PLAYED_AT, encounter.id)


def sort_user_matches(
    matches: list[schemas.MatchReadWithUserStats],
    pool_map_ids: list[int] | None = None,
) -> list[schemas.MatchReadWithUserStats]:
    """Play order: ``map_index``, then map-pool settle order for unindexed rows."""
    if not matches:
        return matches
    indexed = sorted(matches, key=lambda match: (match.map_index is None, match.map_index or 0, match.id))
    if not pool_map_ids or all(match.map_index is not None for match in matches):
        return indexed

    claimed: set[int] = set()
    ordered: list[schemas.MatchReadWithUserStats] = []
    for position, map_id in enumerate(pool_map_ids, start=1):
        exact = next(
            (
                match
                for match in matches
                if match.id not in claimed and match.map_id == map_id and match.map_index == position
            ),
            None,
        )
        if exact is not None:
            claimed.add(exact.id)
            ordered.append(exact)
            continue
        adopted = next(
            (
                match
                for match in matches
                if match.id not in claimed and match.map_id == map_id and match.map_index is None
            ),
            None,
        )
        if adopted is not None:
            claimed.add(adopted.id)
            ordered.append(adopted)
    ordered.extend(match for match in indexed if match.id not in claimed)
    return ordered


def settled_map_ids(rows: list[tuple[object, object, object, object]]) -> list[int]:
    """``(map_id, status, action_index, order)`` → play-order map ids."""
    settled = [row for row in rows if _pool_status(row[1]) in _SETTLED_POOL_STATUSES]
    settled.sort(key=lambda row: row[2] if row[2] is not None else row[3])
    return [int(row[0]) for row in settled]
