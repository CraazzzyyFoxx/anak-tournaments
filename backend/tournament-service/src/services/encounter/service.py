import typing
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.repository import (
    EncounterRepository,
    EncounterSavedViewRepository,
    TeamRepository,
)
from shared.repository.stats_queries import player_facts
from shared.repository.stats_reads import MatchReadContext, duel_matches, get_match_reads
from shared.services.tournament.visibility import visible_tournament_ids_subquery
from src import models, schemas
from src.core import enums, utils
from src.core.query_page import execute_page_with_total
from src.core.workspace import workspace_filter
from src.services.tournament import service as tournament_service

hero_jsonb_object = sa.func.jsonb_build_object(
    "id",
    models.CatalogEntity.id,
    "created_at",
    models.CatalogEntity.created_at,
    "updated_at",
    models.CatalogEntity.updated_at,
    "name",
    models.CatalogEntity.name,
    "slug",
    models.CatalogEntity.slug,
    "image_path",
    sa.func.coalesce(models.CatalogEntity.image_path, ""),
    "color",
    sa.func.coalesce(models.CatalogEntity.attrs["color"].astext, "#ffffff"),
    "type",
    models.CatalogEntity.attrs["class"].astext,
)


def encounter_entities(in_entities: list[str], child: typing.Any | None = None) -> list[_AbstractLoad]:
    """
    Generates a list of SQLAlchemy loading options for related entities of an encounter.

    Parameters:
        in_entities (list[str]): A list of entity names to load (e.g., ["tournament", "teams"]).
        child (typing.Any | None): Optional child entity for nested loading.

    Returns:
        list[_AbstractLoad]: A list of SQLAlchemy loading options.
    """
    entities = []
    if "tournament" in in_entities:
        tournament_entity = utils.join_entity(child, models.Encounter.tournament)
        entities.append(tournament_entity)
        entities.extend(
            tournament_service.tournament_entities(utils.prepare_entities(in_entities, "tournament"), tournament_entity)
        )
    # The participations load with EVERY encounter read, not behind an entity
    # token: the seats carry what used to be columns on the row -- both teams,
    # the score, the places -- so ``to_pydantic`` touches them for an entity-less
    # read too, and an unloaded collection there is implicit IO
    # (``MissingGreenlet``) rather than a missing optional nesting. The bracket
    # position moved to ``tournament.bracket_encounter``, which the reader
    # fetches by id; ``stage``/``stage_item``/``home_team``/``away_team`` are no
    # longer relationships of an encounter at all (D22, D55).
    entities.append(utils.selectin_entity(child, models.Encounter.teams))
    if "matches" in in_entities:
        entities.append(utils.selectin_entity(child, models.Encounter.matches))
        # ``to_pydantic`` fills ``games`` off the SAME switch: a position and its
        # map exist before any parsed log does, and the read carries both.
        # selectin, never joined -- two to-many collections joined onto one
        # encounter multiply each other's rows.
        entities.append(utils.selectin_entity(child, models.Encounter.games).selectinload(models.EncounterGame.map))

    return entities


def _match_read_options(in_entities: list[str]) -> tuple[list[_AbstractLoad], list[_AbstractLoad]]:
    team_entities = list(
        dict.fromkeys(
            entity
            for prefix in ("teams", "home_team", "away_team")
            for entity in utils.prepare_entities(in_entities, prefix)
        )
    )
    nested_encounter = [
        entity
        for entity in utils.prepare_entities(in_entities, "encounter")
        if entity != "matches" and not entity.startswith("matches.")
    ]
    return TeamRepository.team_entities(team_entities), encounter_entities(nested_encounter)


def join_encounter_entities(query: sa.Select, in_entities: list[str]) -> sa.Select:
    """
    Joins related entities to an encounter query based on the provided entity list.

    Parameters:
        query (sa.Select): The SQLAlchemy select query.
        in_entities (list[str]): A list of entity names to join (e.g., ["tournament"]).

    Returns:
        sa.Select: The modified query with joins.
    """
    if "tournament" in in_entities:
        query = query.join(models.Tournament, models.Encounter.tournament_id == models.Tournament.id)
    return query


def _coerce_encounter_status(value: str) -> enums.EncounterStatus:
    try:
        return enums.EncounterStatus(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status. Must be one of: {', '.join(item.value for item in enums.EncounterStatus)}",
        ) from exc


def _apply_encounter_filters(
    query: sa.Select,
    params: schemas.EncounterSearchParams,
    *,
    workspace_id: int | None = None,
    viewer_auth_user_id: int | None = None,
    joined_tournament: bool = False,
) -> sa.Select:
    # Every list, search and overview here renders a DUEL (two seats, a score).
    # A lobby has its own table read, so it is out unless the caller asks for a
    # wider card by slot count.
    query = query.where(models.Encounter.slot_count == (params.slot_count or 2))

    if params.query:
        query = params.apply_search(query, models.Encounter)

    if params.tournament_id:
        query = query.where(models.Encounter.tournament_id == params.tournament_id)
    else:
        # Cross-tournament browse: never surface hidden tournaments (issue #115).
        # A specific tournament_id is authorized upstream by ensure_tournament_viewable.
        query = query.where(models.Encounter.tournament_id.in_(visible_tournament_ids_subquery(None)))
    if params.stage_id is not None:
        query = query.where(
            sa.exists()
            .where(models.BracketEncounter.encounter_id == models.Encounter.id)
            .where(models.BracketEncounter.stage_id == params.stage_id)
        )
    if params.stage_item_id is not None:
        query = query.where(
            sa.exists()
            .where(models.BracketEncounter.encounter_id == models.Encounter.id)
            .where(models.BracketEncounter.stage_item_id == params.stage_item_id)
        )
    if params.best_of is not None:
        query = query.where(models.Encounter.best_of == params.best_of)
    if params.status:
        query = query.where(models.Encounter.status == _coerce_encounter_status(params.status))
    if params.has_logs is not None:
        query = query.where(models.Encounter.has_logs.is_(params.has_logs))
    if params.closeness_min is not None:
        query = query.where(models.Encounter.closeness.isnot(None), models.Encounter.closeness >= params.closeness_min)
    if params.closeness_max is not None:
        query = query.where(models.Encounter.closeness.isnot(None), models.Encounter.closeness <= params.closeness_max)

    if workspace_id is not None:
        if not joined_tournament:
            query = query.join(models.Tournament, models.Encounter.tournament_id == models.Tournament.id)
            joined_tournament = True
        query = query.where(*workspace_filter(workspace_id))

    if params.scope == "my_team":
        if viewer_auth_user_id is None:
            query = query.where(sa.false())
        else:
            linked_player_ids = sa.select(models.User.id).where(models.User.auth_user_id == viewer_auth_user_id)
            query = query.join(
                models.Player,
                sa.and_(
                    models.Player.tournament_id == models.Encounter.tournament_id,
                    models.Player.workspace_member.has(models.WorkspaceMember.player_id.in_(linked_player_ids)),
                    sa.exists()
                    .where(models.EncounterTeam.encounter_id == models.Encounter.id)
                    .where(models.EncounterTeam.active.is_(True))
                    .where(models.EncounterTeam.team_id == models.Player.team_id),
                ),
            )

    return query


def _encounter_ids_query(
    params: schemas.EncounterSearchParams,
    *,
    workspace_id: int | None = None,
    viewer_auth_user_id: int | None = None,
) -> sa.Select:
    query = sa.select(models.Encounter.id)
    query = _apply_encounter_filters(
        query,
        params,
        workspace_id=workspace_id,
        viewer_auth_user_id=viewer_auth_user_id,
    )
    return query.distinct()


def _live_condition(now: datetime) -> sa.ColumnElement[bool]:
    return sa.or_(
        sa.and_(
            models.Encounter.started_at.isnot(None),
            models.Encounter.ended_at.is_(None),
        ),
        sa.and_(
            models.Encounter.status == enums.EncounterStatus.PENDING,
            models.Encounter.current_game_position.isnot(None),
        ),
        sa.and_(
            models.Encounter.status == enums.EncounterStatus.PENDING,
            models.Encounter.scheduled_at <= now,
            models.Encounter.ended_at.is_(None),
        ),
    )


def _upcoming_condition(now: datetime) -> sa.ColumnElement[bool]:
    return sa.and_(
        models.Encounter.scheduled_at.isnot(None),
        models.Encounter.scheduled_at > now,
        models.Encounter.status.in_([enums.EncounterStatus.OPEN, enums.EncounterStatus.PENDING]),
    )


class EncounterService:
    """Encounter/match reads: the public browse, the overview board and the
    per-match statistics the match page is built from.

    Almost every read here is analytical — multi-join, filtered, paginated, or a
    grouped aggregate — so it is built from a repository ``select()`` inside this
    class rather than hidden behind a CRUD repository method
    (``backend/docs/repository-boundaries.md``).
    """

    def __init__(
        self,
        *,
        encounter_repo: EncounterRepository = EncounterRepository(),
        saved_view_repo: EncounterSavedViewRepository = EncounterSavedViewRepository(),
    ) -> None:
        self.encounter_repo = encounter_repo
        self.saved_view_repo = saved_view_repo

    async def get_match(
        self,
        session: AsyncSession,
        id: int,
        entities: list[str],
        workspace_id: int | None = None,
    ) -> MatchReadContext | None:
        query = sa.select(models.StatsMatch.id).where(
            models.StatsMatch.id == id,
            models.StatsMatch.discipline == "overwatch",
        )
        if workspace_id is not None:
            query = query.where(models.StatsMatch.workspace_id == workspace_id)
        if await session.scalar(query) is None:
            return None
        team_options, encounter_options = _match_read_options(entities)
        return (
            await get_match_reads(
                session,
                match_ids=[id],
                team_options=team_options,
                encounter_options=encounter_options,
            )
        ).get(id)

    async def get_encounter(self, session: AsyncSession, id: int, entities: list[str]) -> models.Encounter | None:
        """
        Retrieves an encounter by its ID.

        Parameters:
            session (AsyncSession): The SQLAlchemy async session.
            id (int): The ID of the encounter to retrieve.
            entities (list[str]): A list of related entities to load (e.g., ["tournament", "teams"]).

        Returns:
            models.Encounter | None: The Encounter object if found, otherwise None.
        """
        return await self.encounter_repo.get(session, id, options=encounter_entities(entities))

    async def get_all_encounters(
        self,
        session: AsyncSession,
        params: schemas.EncounterSearchParams,
        workspace_id: int | None = None,
        viewer_auth_user_id: int | None = None,
    ) -> tuple[typing.Sequence[models.Encounter], int]:
        """
        Retrieves a paginated list of encounters based on search parameters.

        Parameters:
            session (AsyncSession): The SQLAlchemy async session.
            params (schemas.EncounterSearchParams): Search, pagination, and sorting parameters.
            workspace_id (int | None): Optional workspace ID to filter encounters.

        Returns:
            tuple[typing.Sequence[models.Encounter], int]: A tuple containing:
                - A sequence of Encounter objects.
                - The total count of encounters.
        """
        # Analytical: entity-driven joins + the shared filter builder + a DISTINCT count,
        # paired so the page and its total always share one predicate set.
        query = self.encounter_repo.select().options(*encounter_entities(params.entities))
        total_query = sa.select(sa.func.count(sa.distinct(models.Encounter.id)))
        query = join_encounter_entities(query, params.entities)
        total_query = join_encounter_entities(total_query, params.entities)

        query = _apply_encounter_filters(
            query,
            params,
            workspace_id=workspace_id,
            viewer_auth_user_id=viewer_auth_user_id,
            joined_tournament="tournament" in params.entities,
        )
        total_query = _apply_encounter_filters(
            total_query,
            params,
            workspace_id=workspace_id,
            viewer_auth_user_id=viewer_auth_user_id,
            joined_tournament="tournament" in params.entities,
        )

        # Model-bound sort uses the native observation EXISTS, not a stored column.
        query = params.apply_pagination_sort(query, models.Encounter)

        return await execute_page_with_total(
            session,
            query,
            total_query,
            pk=models.Encounter.id,
            page=params.page,
            only_count=params.only_count,
        )

    async def get_saved_views(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        auth_user_id: int,
    ) -> typing.Sequence[models.EncounterSavedView]:
        return await self.saved_view_repo.list_for_user(session, workspace_id=workspace_id, auth_user_id=auth_user_id)

    async def upsert_saved_view(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        auth_user_id: int,
        name: str,
        filters: dict,
    ) -> models.EncounterSavedView:
        existing = await self.saved_view_repo.get_by(
            session,
            workspace_id=workspace_id,
            auth_user_id=auth_user_id,
            name=name,
        )
        if existing is not None:
            existing.filters_json = filters
            await session.commit()
            await session.refresh(existing)
            return existing

        # Analytical: MAX(sort_order) + 1 over the owner's views — an aggregate
        # projection, not a row read.
        sort_order = await session.scalar(
            sa.select(sa.func.coalesce(sa.func.max(models.EncounterSavedView.sort_order), -1) + 1).where(
                models.EncounterSavedView.workspace_id == workspace_id,
                models.EncounterSavedView.auth_user_id == auth_user_id,
            )
        )
        saved_view = models.EncounterSavedView(
            workspace_id=workspace_id,
            auth_user_id=auth_user_id,
            name=name,
            filters_json=filters,
            sort_order=int(sort_order or 0),
        )
        await self.saved_view_repo.create(session, saved_view)
        await session.commit()
        await session.refresh(saved_view)
        return saved_view

    async def delete_saved_view(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        auth_user_id: int,
        saved_view_id: int,
    ) -> None:
        saved_view = await self.saved_view_repo.get_owned(
            session,
            saved_view_id=saved_view_id,
            workspace_id=workspace_id,
            auth_user_id=auth_user_id,
        )
        if saved_view is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved view not found")
        await self.saved_view_repo.delete(session, saved_view)
        await session.commit()

    async def get_overview_data(
        self,
        session: AsyncSession,
        params: schemas.EncounterSearchParams,
        *,
        workspace_id: int | None = None,
        viewer_auth_user_id: int | None = None,
    ) -> dict[str, typing.Any]:
        now = datetime.now(UTC)
        recent_since = now - timedelta(days=7)
        base_ids = _encounter_ids_query(
            replace(params, page=1, per_page=-1),
            workspace_id=workspace_id,
            viewer_auth_user_id=viewer_auth_user_id,
        ).subquery()

        def encounter_base() -> sa.Select:
            return self.encounter_repo.select().join(base_ids, base_ids.c.id == models.Encounter.id)

        async def scalar_int(query: sa.Select) -> int:
            value = await session.scalar(query)
            return int(value or 0)

        # All same-shape scalar aggregates over `Encounter JOIN base_ids` are
        # consolidated into ONE statement via `count(*) FILTER (WHERE ...)` — the
        # base_ids subquery (which re-evaluates the full search filter) would
        # otherwise run once per aggregate (this endpoint used to issue 22
        # sequential round trips per cache miss).
        completed = models.Encounter.status == enums.EncounterStatus.COMPLETED
        duration_by_encounter = (
            sa.select(models.EncounterGame.encounter_id, sa.func.sum(models.StatsMatch.duration_s).label("seconds"))
            .select_from(models.StatsMatch)
            .join(models.EncounterGame, models.EncounterGame.id == models.StatsMatch.encounter_game_id)
            .join(
                models.Encounter,
                sa.and_(
                    models.Encounter.id == models.EncounterGame.encounter_id,
                    models.Encounter.workspace_id == models.StatsMatch.workspace_id,
                    models.Encounter.discipline == models.StatsMatch.discipline,
                ),
            )
            .join(base_ids, base_ids.c.id == models.EncounterGame.encounter_id)
            .group_by(models.EncounterGame.encounter_id)
            .subquery()
        )
        avg_series_seconds_sq = sa.select(sa.func.avg(duration_by_encounter.c.seconds)).scalar_subquery()
        # The two-seat metrics below read SEATS, not sides: slot 1 is the left
        # seat and slot 2 the right one, and anything wider than two seats is
        # excluded rather than given an invented "home" (D55).
        duel = models.Encounter.slot_count == 2
        seat_one = aliased(models.EncounterTeam)
        seat_two = aliased(models.EncounterTeam)
        enc_upset = aliased(models.Encounter)
        upset_seat_one = aliased(models.EncounterTeam)
        upset_seat_two = aliased(models.EncounterTeam)
        upset_bracket = aliased(models.BracketEncounter)
        first_standing = aliased(models.Standing)
        second_standing = aliased(models.Standing)
        upset_count_sq = (
            sa.select(sa.func.count(sa.distinct(enc_upset.id)))
            .select_from(enc_upset)
            .join(base_ids, base_ids.c.id == enc_upset.id)
            .join(upset_bracket, upset_bracket.encounter_id == enc_upset.id)
            .join(
                upset_seat_one,
                sa.and_(
                    upset_seat_one.encounter_id == enc_upset.id,
                    upset_seat_one.slot == 1,
                    upset_seat_one.active.is_(True),
                ),
            )
            .join(
                upset_seat_two,
                sa.and_(
                    upset_seat_two.encounter_id == enc_upset.id,
                    upset_seat_two.slot == 2,
                    upset_seat_two.active.is_(True),
                ),
            )
            .join(
                first_standing,
                sa.and_(
                    first_standing.tournament_id == enc_upset.tournament_id,
                    first_standing.team_id == upset_seat_one.team_id,
                    first_standing.stage_id == upset_bracket.stage_id,
                    first_standing.stage_item_id == upset_bracket.stage_item_id,
                ),
            )
            .join(
                second_standing,
                sa.and_(
                    second_standing.tournament_id == enc_upset.tournament_id,
                    second_standing.team_id == upset_seat_two.team_id,
                    second_standing.stage_id == upset_bracket.stage_id,
                    second_standing.stage_item_id == upset_bracket.stage_item_id,
                ),
            )
            .where(
                enc_upset.status == enums.EncounterStatus.COMPLETED,
                enc_upset.slot_count == 2,
                sa.or_(
                    sa.and_(
                        upset_seat_one.score > upset_seat_two.score,
                        first_standing.position > second_standing.position,
                    ),
                    sa.and_(
                        upset_seat_two.score > upset_seat_one.score,
                        second_standing.position > first_standing.position,
                    ),
                ),
            )
            .scalar_subquery()
        )
        agg = (
            await session.execute(
                sa.select(
                    sa.func.count().label("total"),
                    sa.func.count().filter(models.Encounter.has_logs.is_(True)).label("with_logs"),
                    sa.func.count().filter(models.Encounter.created_at >= recent_since).label("recent"),
                    sa.func.count().filter(_live_condition(now)).label("live_now"),
                    sa.func.count().filter(_upcoming_condition(now)).label("upcoming"),
                    # avg() ignores NULL closeness natively.
                    sa.func.avg(models.Encounter.closeness).label("avg_closeness"),
                    sa.func.count().filter(completed).label("completed_series"),
                    sa.func.count()
                    .filter(
                        completed,
                        duel,
                        sa.or_(seat_one.score == 0, seat_two.score == 0),
                        seat_one.score != seat_two.score,
                    )
                    .label("sweeps"),
                    sa.func.count()
                    .filter(completed, duel, seat_one.score + seat_two.score == models.Encounter.best_of)
                    .label("went_distance"),
                    # The two SEATS' win counts, slot 1 and slot 2 of the card.
                    sa.func.count().filter(completed, duel, seat_one.score > seat_two.score).label("slot_one_wins"),
                    sa.func.count().filter(completed, duel, seat_two.score > seat_one.score).label("slot_two_wins"),
                    sa.func.count()
                    .filter(models.Encounter.best_of >= 5, models.Encounter.closeness >= 0.6)
                    .label("close_bo5"),
                    sa.func.count()
                    .filter(sa.or_(models.Stage.name.ilike("%final%"), models.StageItem.name.ilike("%final%")))
                    .label("finals"),
                    avg_series_seconds_sq.label("avg_series_seconds"),
                    upset_count_sq.label("upsets"),
                )
                .select_from(models.Encounter)
                .join(base_ids, base_ids.c.id == models.Encounter.id)
                .outerjoin(models.BracketEncounter, models.BracketEncounter.encounter_id == models.Encounter.id)
                .outerjoin(models.Stage, models.BracketEncounter.stage_id == models.Stage.id)
                .outerjoin(models.StageItem, models.BracketEncounter.stage_item_id == models.StageItem.id)
                .outerjoin(
                    seat_one,
                    sa.and_(
                        seat_one.encounter_id == models.Encounter.id,
                        seat_one.slot == 1,
                        seat_one.active.is_(True),
                    ),
                )
                .outerjoin(
                    seat_two,
                    sa.and_(
                        seat_two.encounter_id == models.Encounter.id,
                        seat_two.slot == 2,
                        seat_two.active.is_(True),
                    ),
                )
            )
        ).one()

        total = int(agg.total or 0)
        with_logs_count = int(agg.with_logs or 0)
        recent_count = int(agg.recent or 0)
        live_now_count = int(agg.live_now or 0)
        upcoming_count = int(agg.upcoming or 0)
        avg_closeness = agg.avg_closeness
        completed_series_count = int(agg.completed_series or 0)
        sweep_count = int(agg.sweeps or 0)
        went_distance_count = int(agg.went_distance or 0)
        slot_one_wins = int(agg.slot_one_wins or 0)
        slot_two_wins = int(agg.slot_two_wins or 0)
        close_bo5_count = int(agg.close_bo5 or 0)
        finals_count = int(agg.finals or 0)
        avg_series_seconds = agg.avg_series_seconds
        upset_count = int(agg.upsets or 0)

        bucket_expr = sa.case(
            (models.Encounter.closeness >= 1, 9),
            else_=sa.func.floor(models.Encounter.closeness * 10),
        ).label("bucket")
        histogram_rows = await session.execute(
            sa.select(bucket_expr, sa.func.count(models.Encounter.id))
            .join(base_ids, base_ids.c.id == models.Encounter.id)
            .where(models.Encounter.closeness.isnot(None))
            .group_by(bucket_expr)
        )

        heat_one = aliased(models.EncounterTeam)
        heat_two = aliased(models.EncounterTeam)
        left_score = sa.cast(heat_one.score, sa.Integer).label("left_score")
        right_score = sa.cast(heat_two.score, sa.Integer).label("right_score")
        score_rows = await session.execute(
            sa.select(left_score, right_score, sa.func.count(models.Encounter.id))
            .select_from(models.Encounter)
            .join(base_ids, base_ids.c.id == models.Encounter.id)
            .join(
                heat_one,
                sa.and_(heat_one.encounter_id == models.Encounter.id, heat_one.slot == 1, heat_one.active.is_(True)),
            )
            .join(
                heat_two,
                sa.and_(heat_two.encounter_id == models.Encounter.id, heat_two.slot == 2, heat_two.active.is_(True)),
            )
            # A heatmap cell is a PAIR of scores, so it only means anything for
            # a two-seat encounter; a lobby's table is the FFA read's job.
            .where(models.Encounter.status == enums.EncounterStatus.COMPLETED, duel)
            .group_by(left_score, right_score)
        )

        stage_name = sa.func.coalesce(models.StageItem.name, models.Stage.name, "Unassigned").label("stage_name")
        stage_rows = await session.execute(
            sa.select(stage_name, sa.func.count(models.Encounter.id))
            .select_from(models.Encounter)
            .join(base_ids, base_ids.c.id == models.Encounter.id)
            .outerjoin(models.BracketEncounter, models.BracketEncounter.encounter_id == models.Encounter.id)
            .outerjoin(models.Stage, models.BracketEncounter.stage_id == models.Stage.id)
            .outerjoin(models.StageItem, models.BracketEncounter.stage_item_id == models.StageItem.id)
            .group_by(stage_name)
            .order_by(sa.func.count(models.Encounter.id).desc())
        )

        hot_map_rows = await session.execute(
            sa.select(models.CatalogEntity.name, sa.func.count(models.StatsMatch.id))
            .select_from(models.StatsMatch)
            .join(models.EncounterGame, models.EncounterGame.id == models.StatsMatch.encounter_game_id)
            .join(
                models.Encounter,
                sa.and_(
                    models.Encounter.id == models.EncounterGame.encounter_id,
                    models.Encounter.workspace_id == models.StatsMatch.workspace_id,
                    models.Encounter.discipline == models.StatsMatch.discipline,
                ),
            )
            .join(base_ids, base_ids.c.id == models.EncounterGame.encounter_id)
            .join(
                models.CatalogEntity,
                sa.and_(
                    models.StatsMatch.map_entity_id == models.CatalogEntity.id,
                    models.CatalogEntity.discipline == models.StatsMatch.discipline,
                    models.CatalogEntity.kind == "map",
                ),
            )
            .group_by(models.CatalogEntity.name)
            .order_by(sa.func.count(models.StatsMatch.id).desc())
            .limit(6)
        )

        closest_rows = await session.execute(
            encounter_base()
            .where(models.Encounter.closeness.isnot(None))
            .options(*encounter_entities(["tournament", "stage", "stage_item", "teams", "matches", "matches.map"]))
            .order_by(
                models.Encounter.closeness.desc(),
                models.Encounter.updated_at.desc().nullslast(),
                models.Encounter.id.desc(),
            )
            .limit(4)
        )
        upcoming_rows = await session.execute(
            encounter_base()
            .where(_upcoming_condition(now))
            .options(*encounter_entities(["tournament", "stage", "stage_item", "teams", "matches", "matches.map"]))
            .order_by(models.Encounter.scheduled_at.asc(), models.Encounter.id.desc())
            .limit(4)
        )
        live_rows = await session.execute(
            encounter_base()
            .where(_live_condition(now))
            .options(*encounter_entities(["tournament", "stage", "stage_item", "teams", "matches", "matches.map"]))
            .order_by(models.Encounter.started_at.desc().nullslast(), models.Encounter.id.desc())
            .limit(4)
        )

        my_team_count = 0
        if viewer_auth_user_id is not None:
            my_team_ids = _encounter_ids_query(
                replace(params, page=1, per_page=-1, scope="my_team"),
                workspace_id=workspace_id,
                viewer_auth_user_id=viewer_auth_user_id,
            ).subquery()
            my_team_count = await scalar_int(sa.select(sa.func.count()).select_from(my_team_ids))

        return {
            "total": total,
            "recent_count": recent_count,
            "with_logs_count": with_logs_count,
            "avg_closeness": float(avg_closeness) if avg_closeness is not None else None,
            "live_now_count": live_now_count,
            "upcoming_count": upcoming_count,
            "histogram_rows": list(histogram_rows.all()),
            "score_rows": list(score_rows.all()),
            "stage_rows": list(stage_rows.all()),
            "hot_map_rows": list(hot_map_rows.all()),
            "avg_series_seconds": float(avg_series_seconds) if avg_series_seconds is not None else None,
            "completed_series_count": completed_series_count,
            "sweep_count": sweep_count,
            "went_distance_count": went_distance_count,
            "slot_one_wins": slot_one_wins,
            "slot_two_wins": slot_two_wins,
            "closest": closest_rows.unique().scalars().all(),
            "upcoming": upcoming_rows.unique().scalars().all(),
            "live": live_rows.unique().scalars().all(),
            "preset_counts": {
                "all": total,
                "my_team": my_team_count,
                "finals": finals_count,
                "close_bo5": close_bo5_count,
                "upsets": upset_count,
                "with_logs": with_logs_count,
            },
        }

    async def get_match_stats_for_user(
        self,
        session: AsyncSession,
        match_id: int,
        user_id: int,
    ) -> tuple[dict[int, dict[enums.LogStatsName, int]], dict[int, list[dict]]]:
        return (await self.get_match_stats_for_users(session, match_id, [user_id]))[user_id]

    async def get_match_stats_for_users(
        self,
        session: AsyncSession,
        match_id: int,
        user_ids: list[int],
    ) -> dict[int, tuple[dict[int, dict[enums.LogStatsName, int]], dict[int, list[dict]]]]:
        out = {user_id: ({}, {}) for user_id in user_ids}
        if not user_ids:
            return out
        facts = player_facts(discipline="overwatch").c
        query = (
            sa.select(facts.player_id, facts.segment, facts.stat_code, sa.func.sum(facts.value).cast(sa.Numeric(10, 2)))
            .where(facts.match_id == match_id, facts.player_id.in_(user_ids), facts.entity_id.is_(None))
            .group_by(facts.player_id, facts.segment, facts.stat_code)
        )
        heroes = (
            sa.select(facts.player_id, facts.segment, sa.func.jsonb_agg(hero_jsonb_object))
            .join(
                models.CatalogEntity,
                sa.and_(
                    models.CatalogEntity.id == facts.entity_id,
                    models.CatalogEntity.kind == "character",
                    models.CatalogEntity.discipline == "overwatch",
                ),
            )
            .where(
                facts.match_id == match_id,
                facts.player_id.in_(user_ids),
                facts.stat_code == enums.LogStatsName.HeroTimePlayed.value,
                facts.value > 60,
            )
            .group_by(facts.player_id, facts.segment)
        )
        for user_id, segment, code, value in (await session.execute(query)).all():
            out[user_id][0].setdefault(segment, {})[enums.LogStatsName(code)] = value
        for user_id, segment, values in (await session.execute(heroes)).all():
            out[user_id][1][segment] = values
        return out

    async def get_match_kill_feed(
        self,
        session: AsyncSession,
        match_id: int,
    ) -> tuple[list[schemas.KillFeedEntry], list[schemas.MatchTimelineEvent]]:
        event, match, event_type = models.StatsEvent, models.StatsMatch, models.EventType
        actor, target = aliased(models.WorkspaceMember), aliased(models.WorkspaceMember)
        actor_team, target_team = aliased(models.EncounterTeam), aliased(models.EncounterTeam)
        hero, related_hero = aliased(models.CatalogEntity), aliased(models.CatalogEntity)
        timeline = (
            enums.MatchEvent.UltimateStart.value,
            enums.MatchEvent.UltimateEnd.value,
            enums.MatchEvent.MercyRez.value,
        )
        query = (
            sa.select(
                event,
                event_type.code,
                actor.player_id,
                target.player_id,
                actor_team.team_id,
                target_team.team_id,
                hero,
                related_hero,
            )
            .select_from(event)
            .join(match, match.id == event.match_id)
            .join(models.EncounterGame, models.EncounterGame.id == match.encounter_game_id)
            .join(
                models.Encounter,
                sa.and_(
                    models.Encounter.id == models.EncounterGame.encounter_id,
                    models.Encounter.workspace_id == match.workspace_id,
                    models.Encounter.discipline == match.discipline,
                ),
            )
            .join(event_type, sa.and_(event_type.id == event.type_id, event_type.discipline == match.discipline))
            .outerjoin(actor, sa.and_(actor.id == event.actor_member_id, actor.workspace_id == match.workspace_id))
            .outerjoin(target, sa.and_(target.id == event.target_member_id, target.workspace_id == match.workspace_id))
            .outerjoin(
                actor_team,
                sa.and_(actor_team.id == event.actor_team_id, actor_team.encounter_id == models.Encounter.id),
            )
            .outerjoin(
                target_team,
                sa.and_(target_team.id == event.target_team_id, target_team.encounter_id == models.Encounter.id),
            )
            .outerjoin(
                hero, sa.and_(hero.id == event.entity_id, hero.discipline == match.discipline, hero.kind == "character")
            )
            .outerjoin(
                related_hero,
                sa.and_(
                    related_hero.id == event.related_entity_id,
                    related_hero.discipline == match.discipline,
                    related_hero.kind == "character",
                ),
            )
            .where(match.id == match_id, match.discipline == "overwatch", event_type.code.in_(("kill", *timeline)))
            .order_by(event.segment, event.t, event.id)
        )
        kills, events = [], []
        for row, code, actor_id, target_id, actor_team_id, target_team_id, entity, related_entity in (
            await session.execute(query)
        ).all():
            if code == "kill":
                data = row.data or {}
                kills.append(
                    schemas.KillFeedEntry(
                        time=row.t,
                        round=row.segment,
                        fight=data.get("fight"),
                        ability=data.get("ability"),
                        damage=data.get("damage"),
                        is_critical_hit=data.get("is_critical_hit"),
                        is_environmental=data.get("is_environmental"),
                        killer_user_id=actor_id,
                        killer_team_id=actor_team_id,
                        killer_hero=schemas.HeroRead.from_entity(entity) if entity is not None else None,
                        victim_user_id=target_id,
                        victim_team_id=target_team_id,
                        victim_hero=schemas.HeroRead.from_entity(related_entity)
                        if related_entity is not None
                        else None,
                    )
                )
            else:
                events.append(
                    schemas.MatchTimelineEvent(
                        time=row.t,
                        round=row.segment,
                        name=code,
                        user_id=actor_id,
                        team_id=actor_team_id,
                        hero=schemas.HeroRead.from_entity(entity) if entity is not None else None,
                        related_user_id=target_id,
                        related_team_id=target_team_id,
                    )
                )
        return kills, events

    async def get_by_stage_id(
        self,
        session: AsyncSession,
        tournament_id: int,
        stage_id: int,
        entities: list[str],
    ) -> typing.Sequence[models.Encounter]:
        return await self.encounter_repo.list_by_stage(
            session,
            tournament_id=tournament_id,
            stage_id=stage_id,
            options=encounter_entities(entities),
        )

    async def get_all_matches(
        self,
        session: AsyncSession,
        params: schemas.MatchSearchParams,
        workspace_id: int | None = None,
    ) -> tuple[typing.Sequence[MatchReadContext], int]:
        d = duel_matches(discipline="overwatch")
        home, away = aliased(models.Team), aliased(models.Team)
        query = (
            sa.select(d.c.id)
            .select_from(d)
            .join(models.Encounter, models.Encounter.id == d.c.encounter_id)
            .join(
                models.Tournament,
                sa.and_(
                    models.Tournament.id == d.c.tournament_id,
                    models.Tournament.workspace_id == d.c.workspace_id,
                    models.Tournament.discipline == d.c.discipline,
                ),
            )
            .join(
                models.CatalogEntity,
                sa.and_(
                    models.CatalogEntity.id == d.c.map_entity_id,
                    models.CatalogEntity.discipline == d.c.discipline,
                    models.CatalogEntity.kind == "map",
                ),
            )
            .outerjoin(home, home.id == d.c.home_tournament_team_id)
            .outerjoin(away, away.id == d.c.away_tournament_team_id)
            .outerjoin(
                models.IngestJob,
                sa.and_(
                    models.IngestJob.id == d.c.ingest_job_id,
                    models.IngestJob.workspace_id == d.c.workspace_id,
                    models.IngestJob.discipline == d.c.discipline,
                ),
            )
        )
        if params.tournament_id:
            query = query.where(d.c.tournament_id == params.tournament_id)
        else:
            query = query.where(d.c.tournament_id.in_(visible_tournament_ids_subquery(None)))
        if workspace_id is not None:
            query = query.where(d.c.workspace_id == workspace_id)
        if params.home_team_id:
            query = query.where(d.c.home_tournament_team_id == params.home_team_id)
        if params.away_team_id:
            query = query.where(d.c.away_tournament_team_id == params.away_team_id)
        columns = {
            "id": d.c.id,
            "created_at": d.c.created_at,
            "updated_at": d.c.updated_at,
            "time": d.c.duration_s,
            "map_index": d.c.position,
            "map_id": d.c.map_entity_id,
            "encounter_id": d.c.encounter_id,
            "home_team_id": d.c.home_tournament_team_id,
            "away_team_id": d.c.away_tournament_team_id,
            "home_score": d.c.home_score,
            "away_score": d.c.away_score,
            "log_name": models.IngestJob.filename,
            "map.name": models.CatalogEntity.name,
            "encounter.name": models.Encounter.name,
            "home_team.name": home.name,
            "away_team.name": away.name,
            "map.id": d.c.map_entity_id,
            "map.slug": models.CatalogEntity.slug,
            "encounter.id": d.c.encounter_id,
            "encounter.tournament_id": d.c.tournament_id,
            "home_team.id": d.c.home_tournament_team_id,
            "away_team.id": d.c.away_tournament_team_id,
            "home_team.avg_sr": home.avg_sr,
            "away_team.avg_sr": away.avg_sr,
        }
        if params.query:
            criteria = []
            for field in params.fields:
                if field not in columns:
                    raise HTTPException(status_code=400, detail=f"Invalid match search field: {field}")
                column = columns[field]
                criteria.append(column.ilike(f"%{params.query}%"))
                if field == "log_name":
                    criteria.append(sa.func.split_part(column, ".", 1).ilike(f"%{params.query}%"))
            if criteria:
                query = query.where(sa.or_(*criteria))
        total = int(await session.scalar(sa.select(sa.func.count()).select_from(query.distinct().subquery())) or 0)
        if params.only_count:
            return [], total
        field = params.sort.removeprefix("similarity:")
        if field not in columns:
            raise HTTPException(status_code=400, detail=f"Invalid match sort field: {field}")
        order_column = columns[field]
        if params.sort.startswith("similarity:"):
            order_column = sa.func.word_similarity(order_column, params.query)
        descending = params.order == "desc" or getattr(params.order, "value", None) == "desc"
        query = params.apply_pagination(query.order_by(order_column.desc() if descending else order_column.asc()))
        ids = list((await session.scalars(query)).all())
        reads = await self.get_match_bulk(session, ids, params.entities)
        by_id = {read.match.id: read for read in reads}
        return [by_id[id] for id in ids], total

    async def get_match_bulk(
        self,
        session: AsyncSession,
        matches_id: list[int],
        entities: list[str],
    ) -> typing.Sequence[MatchReadContext]:
        team_options, encounter_options = _match_read_options(entities)
        return list(
            (
                await get_match_reads(
                    session,
                    match_ids=matches_id,
                    team_options=team_options,
                    encounter_options=encounter_options,
                )
            ).values()
        )


encounter_service = EncounterService()
