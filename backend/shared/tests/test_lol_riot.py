"""Riot API access: Riot ID -> PUUID on the cluster, region once, entries on the platform host, stale PUUIDs, 429."""

import asyncio

import httpx
import pytest

from shared.disciplines.lol import riot

SOLO = {"queueType": "RANKED_SOLO_5x5", "tier": "DIAMOND", "rank": "I", "leaguePoints": 75, "wins": 120, "losses": 98}


class _Http:
    def __init__(self, routes: dict[str, tuple[int, object, dict | None]]) -> None:
        self.routes, self.calls = routes, []

    async def get(self, url: str) -> httpx.Response:
        self.calls.append(url)
        status, body, headers = self.routes.get(url, (404, {}, None))
        return httpx.Response(status, json=body, headers=headers or {}, request=httpx.Request("GET", f"https://h{url}"))


def _account(puuid: str, name: str = "Hide on bush", tag: str = "KR1") -> dict:
    return {"puuid": puuid, "gameName": name, "tagLine": tag}


def test_a_riot_id_is_resolved_on_the_cluster_and_ranked_on_its_platform() -> None:
    http = _Http(
        {
            "/riot/account/v1/accounts/by-riot-id/Hide%20on%20bush/KR1": (200, _account("p1"), None),
            "/riot/account/v1/region/by-game/lol/by-puuid/p1": (
                200,
                {"puuid": "p1", "game": "lol", "region": "KR"},
                None,
            ),
            "/riot/account/v1/accounts/by-puuid/p1": (200, _account("p1", tag="KR2"), None),
            "https://kr.api.riotgames.com/lol/league/v4/entries/by-puuid/p1": (200, [SOLO], None),
        }
    )
    account = asyncio.run(riot.fetch_account(http, riot_id="Hide on bush#KR1", puuid=None, region=None))
    assert (account.puuid, account.region, account.riot_id, account.entries) == ("p1", "kr", "Hide on bush#KR2", [SOLO])


def test_a_known_region_is_not_asked_again() -> None:
    http = _Http(
        {
            "/riot/account/v1/accounts/by-puuid/p1": (200, _account("p1"), None),
            "https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/p1": (200, [], None),
        }
    )
    asyncio.run(riot.fetch_account(http, riot_id="Hide on bush#KR1", puuid="p1", region="euw1"))
    assert not any("/region/" in call for call in http.calls)


def test_a_stale_puuid_is_re_resolved_once_by_riot_id() -> None:
    http = _Http(
        {
            "/riot/account/v1/accounts/by-puuid/old": (400, {"status": {"message": "Exception decrypting"}}, None),
            "/riot/account/v1/accounts/by-riot-id/Hide%20on%20bush/KR1": (200, _account("new"), None),
            "/riot/account/v1/region/by-game/lol/by-puuid/new": (200, {"region": "euw1"}, None),
            "/riot/account/v1/accounts/by-puuid/new": (200, _account("new"), None),
            "https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/new": (200, [SOLO], None),
        }
    )
    account = asyncio.run(riot.fetch_account(http, riot_id="Hide on bush#KR1", puuid="old", region="euw1"))
    assert (account.puuid, account.region) == ("new", "euw1")


def test_every_request_is_charged_to_the_callers_budget_first_re_resolve_included() -> None:
    http = _Http(
        {
            "/riot/account/v1/accounts/by-puuid/old": (400, {}, None),
            "/riot/account/v1/accounts/by-riot-id/Hide%20on%20bush/KR1": (200, _account("new"), None),
            "/riot/account/v1/region/by-game/lol/by-puuid/new": (200, {"region": "euw1"}, None),
            "/riot/account/v1/accounts/by-puuid/new": (200, _account("new"), None),
            "https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/new": (200, [SOLO], None),
        }
    )
    charged: list[int] = []

    async def acquire() -> None:
        charged.append(len(http.calls))  # the requests already sent when this one is charged

    asyncio.run(riot.fetch_account(http, riot_id="Hide on bush#KR1", puuid="old", region="euw1", acquire=acquire))
    assert (charged, len(http.calls)) == ([0, 1, 2, 3, 4], 5)


def test_a_429_carries_its_retry_after() -> None:
    http = _Http({"/riot/account/v1/accounts/by-puuid/p1": (429, {}, {"Retry-After": "7"})})
    with pytest.raises(riot.RiotRateLimited) as caught:
        asyncio.run(riot.fetch_account(http, riot_id="a#b12", puuid="p1", region="euw1"))
    assert caught.value.retry_after == 7.0


def test_an_unknown_riot_id_is_not_found() -> None:
    with pytest.raises(riot.RiotNotFound):
        asyncio.run(riot.fetch_account(_Http({}), riot_id="Nobody#EUW", puuid=None, region=None))


def test_a_malformed_riot_id_is_refused_before_any_call() -> None:
    http = _Http({})
    with pytest.raises(riot.InvalidRiotId):
        asyncio.run(riot.fetch_account(http, riot_id="NoTagHere", puuid=None, region=None))
    assert http.calls == []


def test_the_key_travels_as_a_header_on_the_configured_cluster(monkeypatch) -> None:
    monkeypatch.setattr(
        riot, "settings", lambda: riot.RiotSettings(riot_api_key="RGAPI-x", riot_account_cluster="Americas")
    )
    client = riot.api_client()
    assert (client.base_url, client.default_headers) == (
        "https://americas.api.riotgames.com",
        {"X-Riot-Token": "RGAPI-x"},
    )
