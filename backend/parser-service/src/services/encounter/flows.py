from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from shared.domain.pick_ban_config import pool_allows
from shared.models.tournament.pick_ban import PickBanConfig
from src import models
from src.core import errors

from . import service


def _pool_scope(positions: dict[int, tuple[int | None, int]], encounter_id: int) -> dict[str, int | None]:
    """The ``(stage, round)`` a map pool is keyed on; an encounter outside any bracket has neither."""
    stage_id, round_ = positions.get(encounter_id, (None, None))
    return {"stage_id": stage_id, "round": round_}


async def resolve_for_log(
    session: AsyncSession,
    team_ids: tuple[int, int],
    *,
    log_name: str,
    map_id: int,
    map_pools: Sequence[PickBanConfig],
    attached_encounter_id: int | None = None,
) -> models.Encounter:
    """The encounter a parsed log's two teams played.

    ``team_ids`` are the tournament teams the log shows; an encounter is theirs
    while both hold an active participation in it, so a team a bracket
    correction replaced no longer resolves to the encounter it left.

    The encounter the uploader attached wins, provided it is the duel between
    the pair the log shows. Otherwise the pair has to name exactly one encounter: two teams can
    meet more than once in a tournament (groups then playoffs, a
    double-elimination rematch, a grand-final reset), and picking any of them
    files the map's statistics under the wrong series. A re-parse keeps the
    encounter an earlier run of the same file chose, so a pair that became
    ambiguous after that first run does not strand the log.

    When the pair alone is ambiguous, the log's map narrows it: only an
    encounter whose round pool admits the map can hold it, and an encounter
    that already holds that map from another log cannot hold a second one --
    matches are keyed by (encounter, map), so filing there would overwrite it.
    """
    if attached_encounter_id is not None:
        encounter = await session.get(models.Encounter, attached_encounter_id)
        if encounter is None or encounter.tournament_id is None:  # a mix round is not a tournament encounter (D77)
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[errors.ApiExc(code="encounter_not_found", msg=f"Encounter {attached_encounter_id} not found")],
            )
        if encounter.slot_count != len(team_ids) or set(team_ids) != await service.active_team_ids(
            session, encounter.id
        ):
            raise errors.ApiHTTPException(
                status_code=400,
                detail=[
                    errors.ApiExc(
                        code="attached_encounter_mismatch",
                        msg=(
                            f"Attached encounter {attached_encounter_id} is not the one between teams "
                            f"[{team_ids[0]}, {team_ids[1]}] this log shows"
                        ),
                    )
                ],
            )
        return encounter

    candidates = await service.list_by_teams(session, *team_ids)
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="not_found",
                    msg=f"Encounter with teams [{team_ids[0]}, {team_ids[1]}] not found",
                )
            ],
        )

    previous = await service.encounter_ids_with_log(session, [encounter.id for encounter in candidates], log_name)
    if len(previous) == 1:
        return next(encounter for encounter in candidates if encounter.id in previous)

    # Each narrowing only applies when it leaves someone: a map outside every
    # pool is the map-pool check's refusal to make, not this one's.
    positions = await service.bracket_positions(session, [encounter.id for encounter in candidates])
    candidates = [
        encounter
        for encounter in candidates
        if pool_allows(map_pools, **_pool_scope(positions, encounter.id), item_id=map_id)
    ] or candidates
    if len(candidates) > 1:
        played = await service.encounter_ids_with_map(session, [encounter.id for encounter in candidates], map_id)
        candidates = [encounter for encounter in candidates if encounter.id not in played] or candidates
    if len(candidates) == 1:
        return candidates[0]

    candidate_ids = ", ".join(str(encounter.id) for encounter in candidates)
    raise errors.ApiHTTPException(
        status_code=409,
        detail=[
            errors.ApiExc(
                code="encounter_ambiguous",
                msg=(
                    f"Teams [{team_ids[0]}, {team_ids[1]}] play several encounters ({candidate_ids}) "
                    f"that map {map_id} fits; attach the log to one of them"
                ),
            )
        ],
    )
