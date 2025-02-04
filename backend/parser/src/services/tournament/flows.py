import sqlalchemy as sa
import pandas as pd
import numpy as np

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from src import models, schemas
from src.core import errors
from src.services.challonge import service as challonge_service

from . import service


COEF_NOVICE_FIRST = 1 / 0.15
COEF_NOVICE_SECOND = 1 / 0.11
COEF_REGULAR = 1 / 0.065


async def to_pydantic(
    session: AsyncSession, tournament: models.Tournament, entities: list[str]
) -> schemas.TournamentRead:
    groups: list[schemas.TournamentGroupRead] = []
    if "groups" in entities:
        groups = [
            schemas.TournamentGroupRead.model_validate(group, from_attributes=True)
            for group in tournament.groups
        ]
    return schemas.TournamentRead(
        id=tournament.id,
        start_date=tournament.start_date,
        end_date=tournament.end_date,
        number=tournament.number,
        is_league=tournament.is_league,
        is_finished=tournament.is_finished,
        name=tournament.name,
        description=tournament.description,
        challonge_id=tournament.challonge_id,
        challonge_slug=tournament.challonge_slug,
        groups=groups,
    )


async def to_pydantic_group(
    session: AsyncSession, group: models.TournamentGroup, entities: list[str]
) -> schemas.TournamentGroupRead:
    return schemas.TournamentGroupRead(
        id=group.id,
        name=group.name,
        is_groups=group.is_groups,
        challonge_id=group.challonge_id,
        challonge_slug=group.challonge_slug,
        description=group.description,
    )


async def get(session: AsyncSession, id: int, entities: list[str]) -> models.Tournament:
    tournament = await service.get(session, id, entities)
    if tournament is None:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="tournament_not_found",
                    msg="Tournament with this id not found",
                )
            ],
        )
    return tournament


def get_sync(session: Session, id: int, entities: list[str]) -> models.Tournament:
    tournament = service.get_sync(session, id, entities)
    if tournament is None:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="tournament_not_found",
                    msg="Tournament with this id not found",
                )
            ],
        )
    return tournament


async def get_read(
    session: AsyncSession, id: int, entities: list[str]
) -> schemas.TournamentRead:
    tournament = await get(session, id, entities)
    return await to_pydantic(session, tournament, entities)


async def get_by_number(
    session: AsyncSession, number: int, entities: list[str]
) -> models.Tournament:
    tournament = await service.get_by_number(session, number, entities)
    if tournament is None:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="tournament_not_found",
                    msg="Tournament with this number not found",
                )
            ],
        )
    return tournament


async def get_by_number_and_league(
    session: AsyncSession, number: int, is_league: bool, entities: list[str]
) -> models.Tournament:
    tournament = await service.get_by_number_and_league(
        session, number, is_league, entities
    )
    if tournament is None:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="tournament_not_found",
                    msg="Tournament with this number not found",
                )
            ],
        )
    return tournament


async def get_by_name(
    session: AsyncSession, name: str, entities: list[str]
) -> models.Tournament:
    tournament = await service.get_by_name(session, name, entities)
    if tournament is None:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="tournament_not_found",
                    msg="Tournament with this name not found",
                )
            ],
        )
    return tournament


def get_groups_from_matches(
    matches: list[schemas.ChallongeMatch],
) -> list[tuple[int, str]]:
    groups_ids: list[int] = []
    for match in matches:
        if match.group_id is None:
            continue
        if match.group_id not in groups_ids:
            groups_ids.append(match.group_id)

    groups: list[tuple[int, str]] = []
    for sym_index, group_id in enumerate(sorted(groups_ids), start=65):
        groups.append((group_id, chr(sym_index)))

    return groups


async def create_groups(
    session: AsyncSession,
    tournament: models.Tournament,
    challonge_tournament: schemas.ChallongeTournament,
) -> models.Tournament:
    matches = await challonge_service.fetch_matches(challonge_tournament.id)
    groups = get_groups_from_matches(matches)
    for group_id, name in groups:
        await service.create_group(
            session,
            tournament,
            name=name,
            is_groups=True,
            challonge_id=group_id,
            challonge_slug=challonge_tournament.url,
        )
    await service.create_group(
        session,
        tournament,
        name="Playoffs",
        is_groups=False,
        challonge_slug=challonge_tournament.url,
    )

    return tournament


async def create_with_groups(
    session: AsyncSession,
    number: int,
    challonge_slug: str,
) -> models.Tournament:
    if await service.get_by_number(session, number, []) is not None:
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[
                errors.ApiExc(
                    code="tournament_exists",
                    msg="Tournament with this number already exists",
                )
            ],
        )

    challonge_tournament = await challonge_service.fetch_tournament(challonge_slug)
    if challonge_tournament.grand_finals_modifier is None:
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[
                errors.ApiExc(
                    code="invalid_tournament",
                    msg="Tournament does not have group stage",
                )
            ],
        )
    tournament = await service.create(
        session,
        number=number,
        is_league=False,
        name=challonge_tournament.name,
        description=challonge_tournament.description,
        challonge_id=challonge_tournament.id,
        challonge_slug=challonge_tournament.url,
    )
    return await create_groups(session, tournament, challonge_tournament)


async def create(
    session: AsyncSession,
    number: int,
    is_league: bool,
    groups_challonge_slugs: list[str],
    playoffs_challonge_slug: str,
) -> models.Tournament:
    if (
        await service.get_by_number_and_league(session, number, is_league, [])
        is not None
    ):
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[
                errors.ApiExc(
                    code="tournament_exists",
                    msg="Tournament with this number already exists",
                )
            ],
        )

    tournament = await service.create(
        session,
        number=number,
        name=f"Турнир Сабов Anakq #{number}",
        is_league=is_league,
    )

    for sym_index, slug in enumerate(groups_challonge_slugs, start=65):
        challonge_tournament = await challonge_service.fetch_tournament(slug)
        await service.create_group(
            session,
            tournament,
            name=chr(sym_index),
            is_groups=True,
            challonge_slug=challonge_tournament.url,
            challonge_id=challonge_tournament.id,
        )

    challonge_tournament = await challonge_service.fetch_tournament(
        playoffs_challonge_slug
    )
    await service.create_group(
        session,
        tournament,
        name="Playoffs",
        is_groups=False,
        challonge_slug=challonge_tournament.url,
        challonge_id=challonge_tournament.id,
    )
    return tournament


async def get_analytics(session: AsyncSession, tournament_id: int):
    data = await service.get_analytics(session)

    df = pd.DataFrame(
        [
            {
                "tournament_id": row[2],
                "team_id": row[0],
                "player_name": row[1].name,
                "player_id": row[1].id,
                "user_id": row[1].user_id,
                "id_role": f"{row[1].user_id}-{row[1].role}",
                "cost": row[1].rank,
                "wins": row[3],
                "losses": row[4],
                "previous_cost": row[5],
                "pre-previous_cost": row[6],
                "shift": 0,
            }
            for row in data
        ]
    )

    # df['previous_cost'] = df.groupby('id_role')['cost'].shift(1)
    # df['pre-previous_cost'] = df.groupby('id_role')['cost'].shift(2)
    df["is_changed"] = df["previous_cost"] != df["cost"]

    for id_role in df["id_role"].unique():
        rows = df[df["id_role"] == id_role]
        is_novice = True
        for index, row in rows.iterrows():
            if is_novice:
                if row["is_changed"]:
                    df.at[index, "shift"] = (
                        row["wins"] - row["losses"]
                    ) / COEF_NOVICE_FIRST
                    is_novice = False
                else:
                    df.at[index, "shift"] = (
                        row["wins"] - row["losses"]
                    ) / COEF_NOVICE_SECOND
            else:
                df.at[index, "shift"] = (row["wins"] - row["losses"]) / COEF_REGULAR
                if row["is_changed"]:
                    df.at[index, "shift"] += (
                        row["wins"] - row["losses"]
                    ) / COEF_REGULAR
                else:
                    df.at[index, "shift"] += df.at[
                        rows.index[rows.index.get_loc(index) - 1], "shift"
                    ]

    final_df = df[df["tournament_id"] == tournament_id]
    final_df = final_df.replace({np.nan: None})

    await session.execute(
        sa.delete(models.TournamentAnalytics).where(
            models.TournamentAnalytics.tournament_id == tournament_id
        )
    )
    await session.commit()

    for index, row in final_df.iterrows():
        analytics_item = models.TournamentAnalytics(
            tournament_id=row["tournament_id"],
            team_id=row["team_id"],
            player_id=row["player_id"],
            wins=row["wins"],
            losses=row["losses"],
            shift_one=row["cost"] - row["previous_cost"]
            if row["previous_cost"]
            else None,
            shift_two=row["previous_cost"] - row["pre-previous_cost"]
            if row["pre-previous_cost"]
            else None,
            shift=0,
            calculated_shift=round(row["shift"], 2),
        )
        session.add(analytics_item)
    await session.commit()
