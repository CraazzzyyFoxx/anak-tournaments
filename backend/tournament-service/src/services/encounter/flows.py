import typing

from cashews import cache
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.enums import EncounterGameState
from shared.repository import (
    BracketEncounterRepository,
    EncounterGameTeamRepository,
    StageItemRepository,
    StageRepository,
    TeamRepository,
)
from shared.repository.stats_reads import MatchReadContext
from shared.schemas.match import MatchEventsRead
from shared.services.challonge_refs import (
    ChallongeRef,
    resolve_encounter_challonge,
    resolve_tournament_challonge,
)
from shared.services.match_reads import match_events_read, match_header_fields, match_statistics_read
from src import models, schemas
from src.core import config, errors, pagination, utils
from src.services.bracket.advancement import SlotSource, resolve_slot_sources
from src.services.encounter.service import EncounterService, encounter_service
from src.services.map.flows import MapFlowsService, map_to_read
from src.services.map.flows import flows_service as map_flows_service
from src.services.team.flows import TeamFlowsService
from src.services.team.flows import flows_service as team_flows_service
from src.services.tournament.flows import TournamentFlowsService
from src.services.tournament.flows import flows_service as tournament_flows_service

# Both families embed ``MatchRead`` (and ``EncounterGameRead.map``). Their values are pickled in a persistent Redis
# that outlives a deploy and cashews returns an unpickled value as it is, without re-validating its nested models,
# so a wire change to those models needs a new namespace (``native_``), not a TTL wait. ``cache_resources._encounters``
# evicts both through ``*encounters*:{tournament_id}:*``; ``tests/test_encounter_cache_namespaces.py`` pins that
# against the keys cashews renders from these templates.
_ENCOUNTER_QUERY_KEY = (
    "{workspace_id}:{params.tournament_id}:{params.page}:{params.per_page}:{params.sort}:{params.order}:"
    "{params.entities}:{params.only_count}:{params.query}:{params.fields}:{params.stage_id}:{params.stage_item_id}:"
    "{params.best_of}:{params.status}:{params.has_logs}:{params.closeness_min}:{params.closeness_max}:"
    "{params.scope}:{viewer_auth_user_id}"
)
ENCOUNTERS_CACHE_KEY = f"native_encounters:{_ENCOUNTER_QUERY_KEY}"
ENCOUNTERS_OVERVIEW_CACHE_KEY = f"native_encounters_overview:{_ENCOUNTER_QUERY_KEY}"


def _seats(encounter: models.Encounter) -> list[models.EncounterTeam]:
    """The live seats in slot order. Eager-loaded by ``encounter_entities``."""
    return sorted((seat for seat in encounter.teams if seat.active), key=lambda seat: seat.slot)


def seat_to_read(seat: models.EncounterTeam, team: schemas.TeamRead | None = None) -> schemas.EncounterTeamRead:
    """One participation as the wire names it."""
    return schemas.EncounterTeamRead(
        id=seat.id,
        slot=seat.slot,
        team_id=seat.team_id,
        name=seat.name,
        seed=seat.seed,
        score=seat.score,
        placement=seat.placement,
        active=seat.active,
        team=team,
    )


def _position_fields(position: models.BracketEncounter | None) -> dict[str, typing.Any]:
    """The bracket coordinate from ``tournament.bracket_encounter``: an
    encounter with no position reads as round 0 and no stage."""
    return {
        "round": 0 if position is None else position.round,
        "stage_id": None if position is None else position.stage_id,
        "stage_item_id": None if position is None else position.stage_item_id,
    }


def to_summary(
    encounter: models.Encounter, position: models.BracketEncounter | None = None
) -> schemas.EncounterSummaryRead:
    return schemas.EncounterSummaryRead(
        **encounter.to_dict(),
        scoring_preset=encounter.scoring_preset,
        **_position_fields(position),
        teams=[seat_to_read(seat) for seat in _seats(encounter)],
    )


def _saved_view_to_read(saved_view: models.EncounterSavedView) -> schemas.EncounterSavedViewRead:
    return schemas.EncounterSavedViewRead(
        id=saved_view.id,
        workspace_id=saved_view.workspace_id,
        name=saved_view.name,
        filters=schemas.EncounterFiltersRead.model_validate(saved_view.filters_json or {}),
        sort_order=saved_view.sort_order,
    )


class EncounterFlowsService:
    """Read orchestration for the encounter/match public surface: ORM rows in,
    ``schemas.*Read`` out, with the batched prefetches the list and overview
    pages need so ``to_pydantic`` never fires a query per row.

    Pure serialization helpers stay module-level: they take no session.
    """

    def __init__(
        self,
        *,
        encounters: EncounterService = encounter_service,
        maps: MapFlowsService = map_flows_service,
        teams: TeamFlowsService = team_flows_service,
        tournaments: TournamentFlowsService = tournament_flows_service,
        game_teams: EncounterGameTeamRepository = EncounterGameTeamRepository(),
        bracket_encounter_repo: BracketEncounterRepository = BracketEncounterRepository(),
        stage_repo: StageRepository = StageRepository(),
        stage_item_repo: StageItemRepository = StageItemRepository(),
        team_repo: TeamRepository = TeamRepository(),
    ) -> None:
        self.encounters = encounters
        self.maps = maps
        self.teams = teams
        self.tournaments = tournaments
        self.game_team_repo = game_teams
        self.bracket_encounter_repo = bracket_encounter_repo
        self.stage_repo = stage_repo
        self.stage_item_repo = stage_item_repo
        self.team_repo = team_repo

    async def to_pydantic(
        self,
        session: AsyncSession,
        encounter: models.Encounter,
        entities: list[str],
        *,
        challonge_match_ids: typing.Mapping[int, int] | None = None,
        tournament_challonge_refs: typing.Mapping[int, ChallongeRef] | None = None,
        slot_sources: typing.Mapping[int, list[SlotSource]] | None = None,
        tournament_cache: dict[int, schemas.TournamentRead] | None = None,
        team_cache: dict[int, schemas.TeamRead] | None = None,
    ) -> schemas.EncounterRead:
        """Serialize one encounter to ``EncounterRead`` with the requested ``entities``.

        Parameters:
            challonge_match_ids: Optional prefetched ``encounter_id -> challonge_match_id``
                map derived from ``challonge_match_mapping`` (see
                ``shared.services.challonge_refs``); it fills the ``challonge_id``
                response field (a bracket key for the frontend); omitted → ``None``.
            tournament_challonge_refs: Optional prefetched ``tournament_id -> (challonge_id,
                slug)`` map used the same way for the nested ``tournament``.
            slot_sources: Optional prefetched ``target encounter_id -> incoming
                advancement edges`` map (see ``resolve_slot_sources``). Populates the
                ``sources`` field a reader labels an unresolved bracket slot from;
                omitted → empty, which reads as "the bracket's shape is unknown".
        """
        stage: schemas.StageSummaryRead | None = None
        stage_item: schemas.StageItemSummaryRead | None = None
        tournament: schemas.TournamentRead | None = None
        teams_read: list[schemas.EncounterTeamRead] = []
        matches_read: list[schemas.MatchRead] = []
        games_read: list[schemas.EncounterGameRead] = []

        # The bracket position and the seated teams: one encounter read, one
        # extra statement.
        position = await self.bracket_encounter_repo.get_position(session, encounter.id)
        seats = _seats(encounter)
        if "stage" in entities and position is not None and position.stage_id is not None:
            row = await self.stage_repo.get(session, position.stage_id)
            if row is not None:
                # A nested stage's challonge ref is derived at the top-level
                # tournament read, not here.
                stage = schemas.StageSummaryRead.model_validate(row, from_attributes=True).model_copy(
                    update={"challonge_id": None, "challonge_slug": None}
                )
        if "stage_item" in entities and position is not None and position.stage_item_id is not None:
            row = await self.stage_item_repo.get(session, position.stage_item_id)
            if row is not None:
                stage_item = schemas.StageItemSummaryRead.model_validate(row, from_attributes=True)
        if "tournament" in entities:
            nested_tournament = utils.prepare_entities(entities, "tournament")
            cached_tournament = tournament_cache.get(encounter.tournament_id) if tournament_cache is not None else None
            if cached_tournament is not None:
                tournament = cached_tournament
            else:
                tournament = await self.tournaments.to_pydantic(
                    session,
                    encounter.tournament,
                    nested_tournament,
                    challonge_ref=(
                        tournament_challonge_refs.get(encounter.tournament_id)
                        if tournament_challonge_refs is not None
                        else None
                    ),
                )
                if tournament_cache is not None:
                    tournament_cache[encounter.tournament_id] = tournament
        # Every live seat is on the wire; the source team is expanded only when
        # the caller asks for the ``teams`` entity.
        nested_team = utils.prepare_entities(entities, "teams") if "teams" in entities else None
        for seat in seats:
            team_read: schemas.TeamRead | None = None
            if nested_team is not None and seat.team_id is not None:
                if team_cache is not None and seat.team_id in team_cache:
                    team_read = team_cache[seat.team_id]
                else:
                    # The team's nested entities (``tournament``, ``players``,
                    # ``captain``) are eager-loaded here, or ``to_pydantic`` touches
                    # unloaded relationships (``MissingGreenlet``). ``populate_existing``
                    # makes the options apply: ``session.get`` otherwise returns the
                    # identity-mapped row as it was FIRST loaded (e.g. bare, via a
                    # native match read) and ignores them.
                    source = await self.team_repo.get(
                        session,
                        seat.team_id,
                        options=TeamRepository.team_entities(nested_team),
                        populate_existing=True,
                    )
                    if source is not None:
                        team_read = await self._cached_team_read(session, source, nested_team, team_cache)
            teams_read.append(seat_to_read(seat, team_read))
        if "matches" in entities:
            native_matches = await self.encounters.get_match_bulk(
                session,
                [match.id for match in encounter.matches],
                utils.prepare_entities(entities, "matches"),
            )
            matches_read = [
                await self.to_pydantic_match(
                    session,
                    match,
                    utils.prepare_entities(entities, "matches"),
                    team_cache=team_cache,
                    tournament_cache=tournament_cache,
                )
                for match in native_matches
            ]
            # Same entity switch as `matches`: the encounter read carries both
            # what the tournament DECIDED per position (games) and what a parsed
            # log OBSERVED (matches), so a position can be named before any log
            # exists. Cancelled positions are history, not the live series.
            games = [
                game
                for game in sorted(encounter.games, key=lambda game: (game.position, game.id or 0))
                if game.state != EncounterGameState.CANCELLED
            ]
            lines = await self.game_team_repo.list_for_games(session, [game.id for game in games])
            lines_by_game: dict[int, list[schemas.EncounterGameTeamRead]] = {}
            for line in lines:
                lines_by_game.setdefault(line.game_id, []).append(
                    schemas.EncounterGameTeamRead(
                        encounter_team_id=line.encounter_team_id,
                        score=line.score,
                        placement=line.placement,
                        column_values=dict(line.column_values or {}),
                        starting_side=line.starting_side,
                        replay_code=line.replay_code,
                    )
                )
            games_read = [
                schemas.EncounterGameRead(
                    id=game.id,
                    position=game.position,
                    map_id=game.map_id,
                    map=map_to_read(game.map, []) if game.map is not None else None,
                    state=game.state.value,
                    result_source=game.result_source.value if game.result_source is not None else None,
                    result_version=game.result_version,
                    confirmed_at=game.confirmed_at,
                    teams=lines_by_game.get(game.id, []),
                )
                for game in games
            ]

        encounter_dict = encounter.to_dict()
        # ``challonge_id`` (a bracket key) is derived from challonge_match_mapping;
        # ``None`` when not prefetched.
        encounter_dict["challonge_id"] = (
            challonge_match_ids.get(encounter.id) if challonge_match_ids is not None else None
        )
        # Computed properties are not part of the persisted column dictionary.
        encounter_dict["has_logs"] = encounter.has_logs
        encounter_dict["scoring_preset"] = encounter.scoring_preset

        return schemas.EncounterRead(
            **encounter_dict,
            **_position_fields(position),
            games=games_read,
            stage=stage,
            stage_item=stage_item,
            tournament=tournament,
            teams=teams_read,
            matches=matches_read,
            sources=[
                schemas.EncounterSlotSourceRead(
                    encounter_id=source.encounter_id,
                    source_position=source.source_position,
                    slot=source.slot,
                )
                for source in (slot_sources or {}).get(encounter.id, ())
            ],
        )

    async def _cached_team_read(
        self,
        session: AsyncSession,
        team: models.Team,
        entities: list[str],
        team_cache: dict[int, schemas.TeamRead] | None,
    ) -> schemas.TeamRead:
        if team_cache is not None and team.id in team_cache:
            return team_cache[team.id]
        read = await self.teams.to_pydantic(session, team, entities)
        if team_cache is not None:
            team_cache[team.id] = read
        return read

    async def _match_fields(
        self,
        session: AsyncSession,
        match: MatchReadContext,
        entities: list[str],
        *,
        team_cache: dict[int, schemas.TeamRead] | None = None,
        tournament_cache: dict[int, schemas.TournamentRead] | None = None,
    ) -> dict[str, typing.Any]:
        """The ``MatchRead`` fields of one context: the shared header, and the encounter when asked for."""
        encounter: schemas.EncounterRead | None = None
        if "encounter" in entities:
            encounter = await self.to_pydantic(
                session,
                match.encounter,
                [
                    entity
                    for entity in utils.prepare_entities(entities, "encounter")
                    if entity != "matches" and not entity.startswith("matches.")
                ],
                tournament_cache=tournament_cache,
                team_cache=team_cache,
            )
        return {
            **match_header_fields(
                match,
                with_map="map" in entities,
                with_parent="parent" in utils.prepare_entities(entities, "map"),
            ),
            "encounter": encounter,
        }

    async def to_pydantic_match(
        self,
        session: AsyncSession,
        match: MatchReadContext,
        entities: list[str],
        *,
        team_cache: dict[int, schemas.TeamRead] | None = None,
        tournament_cache: dict[int, schemas.TournamentRead] | None = None,
    ) -> schemas.MatchRead:
        """Serialize one native match: its participants, official result lines and observed team facts."""
        return schemas.MatchRead(
            **await self._match_fields(
                session, match, entities, team_cache=team_cache, tournament_cache=tournament_cache
            )
        )

    async def get_encounter(
        self, session: AsyncSession, encounter_id: int, entities: list[str]
    ) -> schemas.EncounterRead:
        """One encounter as ``EncounterRead`` with ``entities``; 404 when it does not exist."""
        encounter = await self.encounters.get_encounter(session, encounter_id, entities)
        if not encounter:
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[errors.ApiExc(code="not_found", msg=f"Encounter with id {encounter_id} not found")],
            )
        challonge_match_ids = await resolve_encounter_challonge(session, [encounter.id])
        tournament_challonge_refs = await resolve_tournament_challonge(session, [encounter.tournament_id])
        return await self.to_pydantic(
            session,
            encounter,
            entities,
            challonge_match_ids=challonge_match_ids,
            tournament_challonge_refs=tournament_challonge_refs,
            slot_sources=await resolve_slot_sources(session, [encounter.id]),
        )

    @cache(
        ttl=config.settings.encounters_cache_ttl,
        key=ENCOUNTERS_CACHE_KEY,
        prefix="fastapi:",
    )
    async def get_all_encounters(
        self,
        session: AsyncSession,
        params: schemas.EncounterSearchParams,
        workspace_id: int | None = None,
        viewer_auth_user_id: int | None = None,
    ) -> pagination.Paginated[schemas.EncounterRead]:
        """One page of encounters matching ``params``, serialized."""
        encounters, total = await self.encounters.get_all_encounters(
            session,
            params,
            workspace_id=workspace_id,
            viewer_auth_user_id=viewer_auth_user_id,
        )
        challonge_match_ids = await resolve_encounter_challonge(session, [encounter.id for encounter in encounters])
        tournament_challonge_refs = await resolve_tournament_challonge(
            session, [encounter.tournament_id for encounter in encounters]
        )
        slot_sources = await resolve_slot_sources(session, [encounter.id for encounter in encounters])
        tournament_cache: dict[int, schemas.TournamentRead] = {}
        team_cache: dict[int, schemas.TeamRead] = {}
        return pagination.Paginated(
            total=total,
            per_page=params.per_page,
            page=params.page,
            results=[
                await self.to_pydantic(
                    session,
                    encounter,
                    params.entities,
                    challonge_match_ids=challonge_match_ids,
                    tournament_challonge_refs=tournament_challonge_refs,
                    slot_sources=slot_sources,
                    tournament_cache=tournament_cache,
                    team_cache=team_cache,
                )
                for encounter in encounters
            ],
        )

    async def get_saved_views(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        auth_user_id: int,
    ) -> list[schemas.EncounterSavedViewRead]:
        views = await self.encounters.get_saved_views(session, workspace_id=workspace_id, auth_user_id=auth_user_id)
        return [_saved_view_to_read(view) for view in views]

    async def save_view(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        auth_user_id: int,
        data: schemas.EncounterSavedViewCreate,
    ) -> schemas.EncounterSavedViewRead:
        saved_view = await self.encounters.upsert_saved_view(
            session,
            workspace_id=workspace_id,
            auth_user_id=auth_user_id,
            name=data.name,
            filters=data.filters.model_dump(exclude_none=True),
        )
        return _saved_view_to_read(saved_view)

    async def delete_saved_view(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        auth_user_id: int,
        saved_view_id: int,
    ) -> None:
        await self.encounters.delete_saved_view(
            session,
            workspace_id=workspace_id,
            auth_user_id=auth_user_id,
            saved_view_id=saved_view_id,
        )

    @cache(
        ttl=config.settings.encounters_cache_ttl,
        key=ENCOUNTERS_OVERVIEW_CACHE_KEY,
        prefix="fastapi:",
        # NB: no ``lock=True`` — cashews builds the herd-lock key WITHOUT the
        # ``prefix``, and this codebase routes backends purely by key prefix (no
        # default backend), so the lock raises NotConfiguredError. TTL rollover
        # herds are mitigated by the FILTER-consolidated aggregate query instead.
    )
    async def get_encounters_overview(
        self,
        session: AsyncSession,
        params: schemas.EncounterSearchParams,
        workspace_id: int | None = None,
        viewer_auth_user_id: int | None = None,
    ) -> schemas.EncounterOverviewRead:
        data = await self.encounters.get_overview_data(
            session,
            params,
            workspace_id=workspace_id,
            viewer_auth_user_id=viewer_auth_user_id,
        )
        total = data["total"]
        with_logs_count = data["with_logs_count"]
        completed_series_count = data["completed_series_count"]
        sweep_count = data["sweep_count"]
        slot_one_wins = data["slot_one_wins"]
        slot_two_wins = data["slot_two_wins"]
        decided_count = slot_one_wins + slot_two_wins

        histogram_by_bucket = {
            int(bucket): int(count) for bucket, count in data["histogram_rows"] if bucket is not None
        }
        histogram = [
            schemas.EncounterHistogramBucketRead(
                label=f"{index * 10}-{(index + 1) * 10}%",
                start=index / 10,
                end=(index + 1) / 10,
                count=histogram_by_bucket.get(index, 0),
            )
            for index in range(10)
        ]

        featured_encounters = [*data["closest"], *data["upcoming"], *data["live"]]
        featured_challonge_match_ids = await resolve_encounter_challonge(
            session, [encounter.id for encounter in featured_encounters]
        )
        featured_tournament_challonge_refs = await resolve_tournament_challonge(
            session, [encounter.tournament_id for encounter in featured_encounters]
        )
        featured_entities = ["tournament", "stage", "stage_item", "teams", "matches", "matches.map"]
        featured_tournament_cache: dict[int, schemas.TournamentRead] = {}
        featured_team_cache: dict[int, schemas.TeamRead] = {}

        return schemas.EncounterOverviewRead(
            kpis=schemas.EncounterKpiRead(
                total_encounters=total,
                recent_count=data["recent_count"],
                with_logs_count=with_logs_count,
                with_logs_pct=round((with_logs_count / total) * 100, 1) if total else 0,
                avg_closeness=round(data["avg_closeness"] * 100, 1) if data["avg_closeness"] is not None else None,
                live_now_count=data["live_now_count"],
                upcoming_count=data["upcoming_count"],
            ),
            preset_counts=data["preset_counts"],
            closeness_histogram=histogram,
            score_heatmap=[
                schemas.EncounterScoreHeatmapCellRead(slot_one=int(first), slot_two=int(second), count=int(count))
                for first, second, count in data["score_rows"]
            ],
            stage_split=[
                schemas.EncounterStageSplitRead(
                    name=str(name),
                    count=int(count),
                    pct=round((int(count) / total) * 100, 1) if total else 0,
                )
                for name, count in data["stage_rows"]
            ],
            featured=schemas.EncounterFeaturedRead(
                closest=[
                    await self.to_pydantic(
                        session,
                        encounter,
                        featured_entities,
                        challonge_match_ids=featured_challonge_match_ids,
                        tournament_challonge_refs=featured_tournament_challonge_refs,
                        tournament_cache=featured_tournament_cache,
                        team_cache=featured_team_cache,
                    )
                    for encounter in data["closest"]
                ],
                upcoming=[
                    await self.to_pydantic(
                        session,
                        encounter,
                        featured_entities,
                        challonge_match_ids=featured_challonge_match_ids,
                        tournament_challonge_refs=featured_tournament_challonge_refs,
                        tournament_cache=featured_tournament_cache,
                        team_cache=featured_team_cache,
                    )
                    for encounter in data["upcoming"]
                ],
                live=[
                    await self.to_pydantic(
                        session,
                        encounter,
                        featured_entities,
                        challonge_match_ids=featured_challonge_match_ids,
                        tournament_challonge_refs=featured_tournament_challonge_refs,
                        tournament_cache=featured_tournament_cache,
                        team_cache=featured_team_cache,
                    )
                    for encounter in data["live"]
                ],
            ),
            hot_maps=[
                schemas.EncounterMapMetricRead(name=str(name), count=int(count)) for name, count in data["hot_map_rows"]
            ],
            pulse=schemas.EncounterPulseRead(
                avg_series_seconds=data["avg_series_seconds"],
                completed_series_count=completed_series_count,
                sweep_rate=round((sweep_count / completed_series_count) * 100, 1) if completed_series_count else 0,
                sweep_count=sweep_count,
                went_distance_count=data["went_distance_count"],
                reverse_sweep_rate=0,
                most_decisive_map=str(data["hot_map_rows"][0][0]) if data["hot_map_rows"] else None,
            ),
            slot_balance=schemas.EncounterSlotBalanceRead(
                slot_one_wins=slot_one_wins,
                slot_two_wins=slot_two_wins,
                slot_one_win_pct=round((slot_one_wins / decided_count) * 100, 1) if decided_count else 0,
                slot_two_win_pct=round((slot_two_wins / decided_count) * 100, 1) if decided_count else 0,
            ),
        )

    async def get_all_matches(
        self, session: AsyncSession, params: schemas.MatchSearchParams, workspace_id: int | None = None
    ) -> pagination.Paginated[schemas.MatchRead]:
        """One page of matches matching ``params``, serialized."""
        matches, total = await self.encounters.get_all_matches(session, params, workspace_id=workspace_id)
        team_cache: dict[int, schemas.TeamRead] = {}
        tournament_cache: dict[int, schemas.TournamentRead] = {}
        return pagination.Paginated(
            total=total,
            per_page=params.per_page,
            page=params.page,
            results=[
                await self.to_pydantic_match(
                    session,
                    match,
                    params.entities,
                    team_cache=team_cache,
                    tournament_cache=tournament_cache,
                )
                for match in matches
            ],
        )

    async def get_match(
        self,
        session: AsyncSession,
        match_id: int,
        entities: list[str],
        workspace_id: int | None = None,
    ) -> schemas.MatchRead:
        """One match as ``MatchRead`` with ``entities``; 404 when it is not readable."""
        match = await self._get_context(session, match_id, entities, workspace_id)
        return await self.to_pydantic_match(session, match, entities)

    @cache(
        ttl=config.settings.match_cache_ttl,
        # No tournament_id in the args, so this key can't participate in the
        # targeted invalidation patterns — staleness is bounded by the short TTL.
        # ``native_`` namespaces the participant/fact document shape: a cached value of another shape is never read.
        key="native_match_stats:{match_id}:{entities}:{workspace_id}",
        prefix="fastapi:",
    )
    async def get_match_with_stats(
        self,
        session: AsyncSession,
        match_id: int,
        entities: list[str],
        workspace_id: int | None = None,
    ) -> schemas.MatchReadWithStats:
        """One match with its native statistics document (participants, members, segments, facts); 404 when absent."""
        match = await self._get_context(session, match_id, entities, workspace_id)
        return schemas.MatchReadWithStats(
            **await self._match_fields(session, match, entities),
            statistics=await match_statistics_read(session, match_id),
        )

    @cache(
        ttl=config.settings.match_cache_ttl,
        key="native_match_events:{match_id}:{workspace_id}",
        prefix="fastapi:",
    )
    async def get_match_kill_feed(
        self,
        session: AsyncSession,
        match_id: int,
        workspace_id: int | None = None,
    ) -> MatchEventsRead:
        """A match's whole event timeline, chronological, with the characters its events name.

        Validates the match exists within the (optional) workspace scope -- mirrors
        ``get_match_with_stats`` so event data can't cross workspace boundaries. Immutable
        once parsed, so it reuses the short match cache TTL.
        """
        # 404s if missing / out of workspace scope
        match = await self._get_context(session, match_id, [], workspace_id)
        return await match_events_read(session, match)

    async def _get_context(
        self, session: AsyncSession, match_id: int, entities: list[str], workspace_id: int | None
    ) -> MatchReadContext:
        match = await self.encounters.get_match(session, match_id, entities, workspace_id=workspace_id)
        if not match:
            raise errors.ApiHTTPException(
                status_code=404,
                detail=[errors.ApiExc(code="not_found", msg=f"Match with id {match_id} not found")],
            )
        return match


flows_service = EncounterFlowsService()
