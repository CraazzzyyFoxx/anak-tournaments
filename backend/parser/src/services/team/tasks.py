from pathlib import Path

import orjson

from sqlalchemy.ext.asyncio import AsyncSession

from src import schemas

from . import flows


async def create_from_folder(session: AsyncSession) -> None:
    paths: list[tuple[int, str]] = []

    for path in Path("teams").glob("*.json"):
        number = str(path).split("_")[-1].replace(".json", "")
        tournament_id = int(number)
        paths.append((tournament_id, str(path)))

    paths = sorted(paths, key=lambda x: x[0])

    for tournament_id, path in paths:
        with open(path, "r", encoding="utf-8") as file:
            payload = orjson.loads(file.read())
            teams = [schemas.BalancerTeam.model_validate(team) for team in payload["data"]["teams"]]
            await flows.bulk_create_from_balancer(session, tournament_id, teams)


async def bulk_create_from_challonge(session: AsyncSession):
    for tournament_id in range(36, 38 + 1):
        await flows.bulk_create_for_tournament_from_challonge(session, tournament_id, {})
