from httpx import AsyncClient, BasicAuth

from src import schemas
from src.core import config, errors

challonge_client = AsyncClient(
    base_url="https://api.challonge.com/v1/",
    auth=BasicAuth(username=config.app.challonge_username, password=config.app.challonge_api_key),
)


async def fetch_tournament(tournament_id: str) -> schemas.ChallongeTournament:
    resp = await challonge_client.get(f"tournaments/{tournament_id}.json")
    data = resp.json()
    if resp.status_code != 200:
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[errors.ApiExc(code="not_found", msg=f"Tournament with id {tournament_id} not found.")],
        )
    return schemas.ChallongeTournament.model_validate(data["tournament"])


async def fetch_participants(tournament_id: int) -> list[schemas.ChallongeParticipant]:
    resp = await challonge_client.get(f"tournaments/{tournament_id}/participants.json")
    data = resp.json()
    if resp.status_code != 200:
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[errors.ApiExc(code="not_found", msg=f"Tournament with id {tournament_id} not found.")],
        )
    return [schemas.ChallongeParticipant.model_validate(participant["participant"]) for participant in data]


async def fetch_matches(tournament_id: int) -> list[schemas.ChallongeMatch]:
    resp = await challonge_client.get(f"tournaments/{tournament_id}/matches.json")
    data = resp.json()
    if resp.status_code != 200:
        raise errors.ApiHTTPException(
            status_code=400,
            detail=[errors.ApiExc(code="not_found", msg=f"Tournament with id {tournament_id} not found.")],
        )
    return [schemas.ChallongeMatch.model_validate(match["match"]) for match in data]
