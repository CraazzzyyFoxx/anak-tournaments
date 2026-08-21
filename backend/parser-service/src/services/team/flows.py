import asyncio

import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from shared.division_grid import DEFAULT_GRID
from shared.repository import ChallongeMappingRepository
from shared.repository.identity import UserRepository
from shared.services.division_grid_resolution import resolve_tournament_division
from shared.services.team_export import ExportPlan, team_materialization
from src import models, schemas
from src.clients.challonge import challonge_client
from src.core import errors, utils
from src.domain.challonge_team_sync import (
    _build_team_suggestion_index,
    _ChallongeParticipantRow,
    _effective_challonge_id,
    _ParticipantFetchPlan,
    _ParticipantGroupContext,
    _suggest_team_id,
    _to_materialization_teams,
    _validate_challonge_team_mappings,
    resolve_team_placement,
)
from src.services.tournament import flows as tournament_flows

from . import service

_CHALLONGE_FETCH_CONCURRENCY = 4

def _user_to_pydantic(user: models.User, entities: list[str]) -> schemas.UserRead:
    """Wire-map a ``User`` embedded in a team/player read. The filter+sort of
    which social accounts to expose lives once in ``UserRepository`` (the
    shared model); this is just this service's own ``UserRead`` shape."""
    accounts = UserRepository.visible_social_accounts(user, entities)
    return schemas.UserRead(
        id=user.id,
        name=user.name,
        avatar_url=user.avatar_url,
        social_accounts=[schemas.SocialAccountRead.model_validate(a, from_attributes=True) for a in accounts],
    )


class TeamFlowsService:
    def __init__(self, *, challonge_repo: ChallongeMappingRepository = ChallongeMappingRepository()) -> None:
        self.challonge_repo = challonge_repo

    async def to_pydantic(
        self,
        session: AsyncSession,
        team: models.Team,
        entities: list[str],
    ) -> schemas.TeamRead:
        tournament: schemas.TournamentRead | None = None
        players_read: list[schemas.PlayerRead] = []
        captain: schemas.UserRead | None = None
        placement: int | None = None

        if "tournament" in entities and team.tournament is not None:
            tournament = await tournament_flows.to_pydantic(session, team.tournament, [])
        if "players" in entities:
            players_entities = utils.prepare_entities(entities, "players")
            players_read = [await to_pydantic_player(session, player, players_entities) for player in team.players]
        if "captain" in entities and team.captain is not None:
            captain = _user_to_pydantic(team.captain, utils.prepare_entities(entities, "captain"))
        if "placement" in entities:
            placement = resolve_team_placement(team)

        return schemas.TeamRead(
            id=team.id,
            name=team.name,
            image_url=team.image_url,
            avg_sr=team.avg_sr,
            total_sr=team.total_sr,
            tournament_id=team.tournament_id,
            captain_id=team.captain_id,
            tournament=tournament,
            players=players_read,
            captain=captain,
            placement=placement,
        )

    async def to_pydantic_player(
        self,
        session: AsyncSession,
        player: models.Player,
        entities: list[str],
    ) -> schemas.PlayerRead:
        user: schemas.UserRead | None = None
        tournament: schemas.TournamentRead | None = None
        team: schemas.TeamRead | None = None

        if "user" in entities:
            # workspace_member_id is NOT NULL (contract step, iwrefac07) and is always
            # eager-loaded regardless of the "user" entity flag (see the workspace_member
            # dereference below), so the old "workspace_member is not None" guard here was
            # dead — dropped to match tournament-service's to_pydantic_player.
            user = _user_to_pydantic(player.workspace_member.player, utils.prepare_entities(entities, "user"))
        if "tournament" in entities and player.tournament is not None:
            tournament = await tournament_flows.to_pydantic(session, player.tournament, [])
        if "team" in entities and player.team is not None:
            team = await to_pydantic(session, player.team, [])

        division = getattr(player, "division", None)
        if division is None:
            division = resolve_tournament_division(
                player.rank,
                fallback_grid=DEFAULT_GRID,
            )

        player_dict = player.to_dict()
        # Player.user_id was dropped in the contract step (iwrefac07); PlayerRead.user_id
        # is resolved from workspace_member.player_id instead (workspace_member is always
        # loaded by team_entities/player_entities regardless of the "user" entity flag).
        player_dict["user_id"] = player.workspace_member.player_id

        return schemas.PlayerRead(
            **player_dict,
            division=division,
            tournament=tournament,
            team=team,
            user=user,
        )

    async def bulk_create_from_balancer(
        self, session: AsyncSession, tournament_id: int, payload: list[schemas.BalancerTeam]
    ) -> None:
        """Import balancer teams into a tournament.

        Strict (``on_unresolved="error"``): the first unresolvable battle tag or an
        unknown slot code fails the whole import with a 400, preserving this
        service's per-item error contract. balancer-service is deliberately lenient
        on the same writer instead.

        Commits once — the shared orchestrator owns the transaction boundary, which
        is why the RPC caller now commits nothing of its own.
        """
        # Preserves this service's 404 on an unknown tournament: the shared writer
        # treats a missing tournament as a logged no-op (balancer-service's contract).
        await tournament_flows.get(session, tournament_id, [])

        await team_materialization.run(
            session,
            ExportPlan(
                tournament_id=tournament_id,
                teams=_to_materialization_teams(payload),
                on_unresolved="error",
            ),
        )
        return None

    async def _get_or_create_challonge_source_id(
        self,
        session: AsyncSession,
        tournament: models.Tournament,
        *,
        challonge_tournament_id: int,
        slug: str | None,
        group: models.TournamentGroup | None = None,
        create: bool = False,
    ) -> int | None:
        result = await session.execute(
            sa.select(models.ChallongeSource).where(
                models.ChallongeSource.tournament_id == tournament.id,
                models.ChallongeSource.challonge_tournament_id == challonge_tournament_id,
            )
        )
        source = result.scalar_one_or_none()
        if source is not None or not create:
            return getattr(source, "id", None)

        # A group/playoff source is scoped to the group's stage; the tournament-scoped
        # source has no stage. (The deprecated stage.challonge_id lookup that used to
        # attach a matching stage here has been dropped.)
        stage = getattr(group, "stage", None)
        stage_item_id = None
        if stage is not None and getattr(stage, "items", None):
            stage_item_id = sorted(stage.items, key=lambda item: (item.order, item.id))[0].id

        source = models.ChallongeSource(
            tournament_id=tournament.id,
            stage_id=stage.id if stage is not None else None,
            stage_item_id=stage_item_id,
            challonge_tournament_id=challonge_tournament_id,
            slug=slug,
            source_type=(
                "group" if group is not None and group.is_groups else "playoff" if group is not None else "tournament"
            ),
        )
        await self.challonge_repo.sources.create(session, source)
        return source.id

    async def _build_participant_fetch_plans(
        self,
        session: AsyncSession,
        tournament: models.Tournament,
        *,
        create_sources: bool,
    ) -> list[_ParticipantFetchPlan]:
        """Do all the DB work for a participant sync (source get-or-create, group
        context capture) and return plain-value fetch plans, so the Challonge HTTP
        round-trips can run outside any open transaction."""
        groups = list(tournament.groups or [])

        # The tournament-level Challonge link now lives in challonge_source
        # (source_type='tournament'), not the deprecated tournament.challonge_id/slug.
        tournament_source_result = await session.execute(
            sa.select(models.ChallongeSource).where(
                models.ChallongeSource.tournament_id == tournament.id,
                models.ChallongeSource.source_type == "tournament",
            )
        )
        tournament_source = tournament_source_result.scalars().first()
        if tournament_source is not None:
            return [
                _ParticipantFetchPlan(
                    challonge_tournament_id=tournament_source.challonge_tournament_id,
                    source_id=tournament_source.id,
                    group_contexts=tuple(
                        _ParticipantGroupContext(
                            group_id=getattr(group, "id", None),
                            group_name=getattr(group, "name", None),
                            is_playoff=bool(group is not None and not group.is_groups),
                        )
                        for group in (groups or [None])
                    ),
                )
            ]

        plans: list[_ParticipantFetchPlan] = []
        for group in groups:
            # group.challonge_id (KEPT — see the group exception) stores this group's
            # own Challonge bracket id; it has no challonge_source equivalent and is
            # read directly to fetch that bracket's participants.
            if group.challonge_id is None:
                continue

            source_id = await _get_or_create_challonge_source_id(
                session,
                tournament,
                challonge_tournament_id=group.challonge_id,
                slug=group.challonge_slug,
                group=group,
                create=create_sources,
            )
            plans.append(
                _ParticipantFetchPlan(
                    challonge_tournament_id=group.challonge_id,
                    source_id=source_id,
                    group_contexts=(
                        _ParticipantGroupContext(
                            group_id=group.id,
                            group_name=group.name,
                            is_playoff=not group.is_groups,
                        ),
                    ),
                )
            )
        return plans

    async def _fetch_challonge_participant_rows(
        self,
        session: AsyncSession,
        tournament: models.Tournament,
        *,
        create_sources: bool = False,
    ) -> list[_ChallongeParticipantRow]:
        plans = await _build_participant_fetch_plans(session, tournament, create_sources=create_sources)
        if not plans:
            return []

        # Commit (and thereby release the pgBouncer-backed connection)
        # before the rate-limited Challonge round-trips: holding a transaction open
        # across third-party HTTP pins a scarce backend slot for the whole network
        # wait. expire_on_commit=False keeps the already-loaded tournament/teams
        # usable; callers resume their writes in a fresh, short transaction.
        await session.commit()

        semaphore = asyncio.Semaphore(_CHALLONGE_FETCH_CONCURRENCY)

        async def _fetch_participants(challonge_tournament_id: int) -> list[schemas.ChallongeParticipant]:
            async with semaphore:
                return await challonge_client.fetch_participants(challonge_tournament_id)

        # No return_exceptions: a failed source aborts the whole sync, exactly like
        # the old serial loop did.
        participants_per_plan = await asyncio.gather(
            *(_fetch_participants(plan.challonge_tournament_id) for plan in plans)
        )

        rows: list[_ChallongeParticipantRow] = []
        for plan, participants in zip(plans, participants_per_plan, strict=True):
            for context in plan.group_contexts:
                for participant in participants:
                    rows.append(
                        _ChallongeParticipantRow(
                            participant_id=participant.id,
                            challonge_id=_effective_challonge_id(
                                participant,
                                is_playoff=context.is_playoff,
                            ),
                            source_id=plan.source_id,
                            group_id=context.group_id,
                            group_name=context.group_name,
                            challonge_tournament_id=plan.challonge_tournament_id,
                            name=participant.name,
                            active=participant.active,
                        )
                    )

        return rows

    async def _get_existing_challonge_participant_mappings(
        self,
        session: AsyncSession,
        source_ids: set[int],
    ) -> dict[tuple[int, int], models.ChallongeParticipantMapping]:
        if not source_ids:
            return {}
        result = await session.execute(
            sa.select(models.ChallongeParticipantMapping).where(
                models.ChallongeParticipantMapping.source_id.in_(source_ids)
            )
        )
        mappings: dict[tuple[int, int], models.ChallongeParticipantMapping] = {}
        for mapping in result.scalars().all():
            mappings.setdefault((mapping.source_id, mapping.challonge_participant_id), mapping)
        return mappings

    async def preview_challonge_team_sync(
        self,
        session: AsyncSession,
        tournament_id: int,
    ) -> schemas.ChallongeTeamSyncPreview:
        tournament = await tournament_flows.get(session, tournament_id, ["groups"])
        teams = list(await service.get_by_tournament(session, tournament.id, []))
        participant_rows = await _fetch_challonge_participant_rows(session, tournament)
        # Existing mappings come from the normalized challonge_participant_mapping
        # (keyed by source_id + participant id), not the deprecated challonge_team.
        existing_source_mappings = await _get_existing_challonge_participant_mappings(
            session,
            {row.source_id for row in participant_rows if row.source_id is not None},
        )
        team_suggestion_index = _build_team_suggestion_index(teams)

        return schemas.ChallongeTeamSyncPreview(
            teams=[
                schemas.ChallongeTeamPreviewTeam(
                    id=team.id,
                    name=team.name,
                    balancer_name=team.balancer_name,
                )
                for team in teams
            ],
            participants=[
                schemas.ChallongeTeamPreviewParticipant(
                    participant_id=row.participant_id,
                    challonge_id=row.challonge_id,
                    group_id=row.group_id,
                    group_name=row.group_name,
                    challonge_tournament_id=row.challonge_tournament_id,
                    name=row.name,
                    active=row.active,
                    suggested_team_id=_suggest_team_id(row.name, team_suggestion_index),
                    mapped_team_id=(
                        getattr(
                            existing_source_mappings.get((row.source_id, row.challonge_id)),
                            "team_id",
                            None,
                        )
                        if row.source_id is not None
                        else None
                    ),
                )
                for row in participant_rows
            ],
        )

    async def sync_challonge_team_mappings(
        self,
        session: AsyncSession,
        tournament_id: int,
        payload: schemas.ChallongeTeamSyncRequest,
    ) -> schemas.ChallongeTeamSyncResult:
        tournament = await tournament_flows.get(session, tournament_id, ["groups"])
        logger.info(f"Syncing Challonge team mappings for tournament {tournament.name}")

        teams = list(await service.get_by_tournament(session, tournament.id, []))
        team_ids = {team.id for team in teams}
        participant_rows = await _fetch_challonge_participant_rows(
            session,
            tournament,
            create_sources=True,
        )
        rows_by_request_key = {(row.participant_id, row.group_id): row for row in participant_rows}

        validation_errors = _validate_challonge_team_mappings(
            payload.mappings,
            rows_by_request_key,
            team_ids,
        )
        if validation_errors:
            raise errors.ApiHTTPException(
                status_code=400,
                detail=[errors.ApiExc(code="invalid_challonge_mapping", msg=message) for message in validation_errors],
            )

        # challonge_participant_mapping (source_id + participant id -> team_id) is now
        # the SOLE persistence target; the legacy challonge_team table is no longer
        # written. Participants whose bracket has no challonge_source (source_id None)
        # cannot be persisted normalized and are skipped.
        existing_source_mappings = await _get_existing_challonge_participant_mappings(
            session,
            {row.source_id for row in participant_rows if row.source_id is not None},
        )
        created = 0
        updated = 0
        unchanged = 0

        for mapping in payload.mappings:
            participant_row = rows_by_request_key[(mapping.participant_id, mapping.group_id)]
            if participant_row.source_id is None:
                continue

            source_key = (participant_row.source_id, participant_row.challonge_id)
            source_mapping = existing_source_mappings.get(source_key)

            if source_mapping is None:
                source_mapping = models.ChallongeParticipantMapping(
                    source_id=participant_row.source_id,
                    challonge_participant_id=participant_row.challonge_id,
                    team_id=mapping.team_id,
                )
                await self.challonge_repo.participants.create(session, source_mapping)
                existing_source_mappings[source_key] = source_mapping
                created += 1
            elif source_mapping.team_id != mapping.team_id:
                source_mapping.team_id = mapping.team_id
                updated += 1
            else:
                unchanged += 1

        await session.commit()

        mapped_count = len({(mapping.participant_id, mapping.group_id) for mapping in payload.mappings})
        skipped = max(len(rows_by_request_key) - mapped_count, 0)
        return schemas.ChallongeTeamSyncResult(
            success=True,
            count=created + updated + unchanged,
            created=created,
            updated=updated,
            unchanged=unchanged,
            skipped=skipped,
        )


team_flows_service = TeamFlowsService()
to_pydantic = team_flows_service.to_pydantic
to_pydantic_player = team_flows_service.to_pydantic_player
bulk_create_from_balancer = team_flows_service.bulk_create_from_balancer
_get_or_create_challonge_source_id = team_flows_service._get_or_create_challonge_source_id
_build_participant_fetch_plans = team_flows_service._build_participant_fetch_plans
_fetch_challonge_participant_rows = team_flows_service._fetch_challonge_participant_rows
_get_existing_challonge_participant_mappings = team_flows_service._get_existing_challonge_participant_mappings
preview_challonge_team_sync = team_flows_service.preview_challonge_team_sync
sync_challonge_team_mappings = team_flows_service.sync_challonge_team_mappings
