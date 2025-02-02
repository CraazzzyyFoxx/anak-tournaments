from httpx import AsyncClient, BasicAuth, Proxy

from src import schemas
from src.core import config, errors


if config.app.proxy_ip:
    proxy_conf = Proxy(
        url=f"http://{config.app.proxy_username}:{config.app.proxy_password}@{config.app.proxy_ip}:{config.app.proxy_port}"
    )
else:
    proxy_conf = None


challonge_client = AsyncClient(
    base_url="https://api.challonge.com/v1/",
    auth=BasicAuth(username=config.app.challonge_username, password=config.app.challonge_api_key),
    proxy=proxy_conf,
    timeout=15
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
