"""Riot API access for the LoL rank collector: account-v1 on the regional cluster, league-v4 on the platform host.

Every call sends ``X-Riot-Token``; the key never reaches a log line (``ResilientHttpClient`` logs method, host and path,
not headers). PUUIDs are encrypted per Riot project: a 400 on a PUUID path means the PUUID was minted under another key,
so ``fetch_account`` re-resolves it once by Riot ID within the same fetch. The caller meters requests with ``acquire``,
awaited before every outbound request (re-resolves included); it raises to stop the fetch. No Redis here.
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import cache
from typing import Any
from urllib.parse import quote

import httpx
from pydantic_settings import BaseSettings, SettingsConfigDict

from shared.clients.http_client import ResilientHttpClient

__all__ = (
    "InvalidRiotId",
    "RiotAccount",
    "RiotError",
    "RiotNotFound",
    "RiotProgress",
    "RiotRateLimited",
    "RiotSettings",
    "RiotStalePuuid",
    "api_client",
    "fetch_account",
    "settings",
    "split_riot_id",
)


class RiotSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", ".env.prod"), env_file_encoding="utf-8", extra="ignore")

    riot_api_key: str | None = None
    riot_account_cluster: str = "europe"
    riot_timeout: float = 10.0
    riot_max_retries: int = 3
    #: FastStream prefetch of the LoL fetch consumers (low: the key's limits are per region).
    lol_rank_fetch_worker_prefetch: int = 3


@cache
def settings() -> RiotSettings:
    return RiotSettings()


def api_client() -> ResilientHttpClient:
    config = settings()
    cluster = config.riot_account_cluster.strip().lower() or "europe"
    return ResilientHttpClient(
        f"https://{cluster}.api.riotgames.com",
        timeout=config.riot_timeout,
        max_retries=config.riot_max_retries,
        headers={"X-Riot-Token": config.riot_api_key} if config.riot_api_key else None,
    )


class RiotRateLimited(Exception):
    def __init__(self, retry_after: float | None) -> None:
        super().__init__("Riot API rate limited (429)")
        self.retry_after = retry_after


class RiotNotFound(Exception):
    """404: no such Riot ID or PUUID."""


class RiotStalePuuid(Exception):
    """400 on a PUUID path: the PUUID belongs to another Riot project's key."""


class RiotError(Exception):
    """5xx, 401/403 (a missing or expired key) or any other unexpected answer: transient."""


class InvalidRiotId(ValueError):
    """The stored handle is not ``gameName#tagLine``: it never resolves without an operator."""


_PLATFORM = re.compile(r"[a-z0-9]{2,8}")


def split_riot_id(riot_id: str) -> tuple[str, str]:
    name, _, tag = riot_id.rpartition("#")
    name, tag = name.strip(), tag.strip()
    if not name or not tag:
        raise InvalidRiotId(riot_id)
    return name, tag


def _retry_after(response: httpx.Response) -> float | None:
    raw = response.headers.get("Retry-After", "")
    return float(raw) if raw.isdigit() else None


#: Awaited before each outbound request: one unit of the caller's request budget; raising stops the fetch.
_Acquire = Callable[[], Awaitable[None]] | None


async def _json(http: Any, url: str, acquire: _Acquire, *, puuid_path: bool = False) -> Any:
    if acquire is not None:
        await acquire()
    response = await http.get(url)
    status = response.status_code
    if status == 200:
        return response.json()
    if status == 429:
        raise RiotRateLimited(_retry_after(response))
    if status == 404:
        raise RiotNotFound()
    if status == 400 and puuid_path:
        raise RiotStalePuuid()
    raise RiotError(f"Riot API answered {status}")


def _platform_host(region: str) -> str:
    if not _PLATFORM.fullmatch(region):
        raise RiotError(f"unknown Riot platform {region!r}")
    return f"https://{region}.api.riotgames.com"


@dataclass(frozen=True, slots=True)
class RiotAccount:
    puuid: str
    region: str
    riot_id: str
    entries: list[dict[str, Any]]


@dataclass(slots=True)
class RiotProgress:
    """What a fetch confirmed before it stopped: a PUUID valid under this key and its platform.

    ``fetch_account`` fills it as calls succeed and empties it when a PUUID is rejected, so a caller whose fetch is cut
    short (a spent request budget) keeps what it learned and the next fetch resumes from there.
    """

    puuid: str | None = None
    region: str | None = None

    def confirm(self, puuid: str, region: str | None = None) -> None:
        if puuid != self.puuid:
            self.region = None
        self.puuid = puuid
        if region is not None:
            self.region = region

    def forget(self) -> None:
        self.puuid = self.region = None


async def _by_riot_id(http: Any, riot_id: str, acquire: _Acquire, progress: RiotProgress) -> str:
    name, tag = split_riot_id(riot_id)
    path = f"/riot/account/v1/accounts/by-riot-id/{quote(name, safe='')}/{quote(tag, safe='')}"
    puuid = str((await _json(http, path, acquire))["puuid"])
    progress.confirm(puuid)
    return puuid


async def _by_puuid(
    http: Any, puuid: str, region: str | None, riot_id: str, acquire: _Acquire, progress: RiotProgress
) -> RiotAccount:
    path = quote(puuid, safe="")
    try:
        if region is None:
            data = await _json(http, f"/riot/account/v1/region/by-game/lol/by-puuid/{path}", acquire, puuid_path=True)
            region = str(data["region"]).lower()
            _platform_host(region)  # a malformed platform is refused before it is kept
            progress.confirm(puuid, region)
        account = await _json(http, f"/riot/account/v1/accounts/by-puuid/{path}", acquire, puuid_path=True)
        progress.confirm(puuid)
        name, tag = account.get("gameName"), account.get("tagLine")
        entries = await _json(
            http, f"{_platform_host(region)}/lol/league/v4/entries/by-puuid/{path}", acquire, puuid_path=True
        )
    except RiotStalePuuid:
        progress.forget()
        raise
    return RiotAccount(
        puuid=puuid, region=region, riot_id=f"{name}#{tag}" if name and tag else riot_id, entries=entries
    )


async def fetch_account(
    http: Any,
    *,
    riot_id: str,
    puuid: str | None,
    region: str | None,
    acquire: _Acquire = None,
    progress: RiotProgress | None = None,
) -> RiotAccount:
    """One account's PUUID, platform, current Riot ID and league entries (spec §5 steps 1-4).

    A cached ``puuid`` answered 400 is re-resolved once by Riot ID; if that re-resolve fails too, the failure is raised
    as ``RiotStalePuuid`` caused by it (``__cause__``: a 404, a 429, a transient error, another 400, the budget's own
    refusal), so the caller forgets the cached PUUID and platform whatever came next. ``progress`` receives the PUUID
    and platform confirmed along the way (a PUUID re-resolved by Riot ID included, a rejected one never).
    """
    split_riot_id(riot_id)  # refuse a malformed handle before any call
    progress = RiotProgress() if progress is None else progress
    if puuid is None:
        return await _by_puuid(
            http, await _by_riot_id(http, riot_id, acquire, progress), None, riot_id, acquire, progress
        )
    try:
        return await _by_puuid(http, puuid, region, riot_id, acquire, progress)
    except RiotStalePuuid:
        pass
    try:
        return await _by_puuid(
            http, await _by_riot_id(http, riot_id, acquire, progress), None, riot_id, acquire, progress
        )
    except Exception as exc:
        raise RiotStalePuuid() from exc
