"""The ``deadlock_api`` match fetcher: one match's metadata bytes, exactly what ``ingest.decode`` reads.

deadlock-api serves a match once its replay is parsed (private lobbies included); until then it answers 404. 404, 429,
5xx and transport failures are "not yet" (stats core retries); any other 4xx, an id that is not a positive integer or
a 200 that is not match metadata never will.
"""

from __future__ import annotations

import json
import re

import httpx

from shared.disciplines.deadlock.client import deadlock_client
from shared.disciplines.ingest import MatchFetchFailed, MatchFetchNotReady

__all__ = ("fetch_match",)

_MATCH_ID = re.compile(r"[1-9][0-9]{0,18}")


async def fetch_match(external_id: str) -> bytes:
    if not _MATCH_ID.fullmatch(external_id):
        raise MatchFetchFailed(f"{external_id!r} is not a Deadlock match id")
    try:
        async with deadlock_client() as http:
            response = await http.get(f"/v1/matches/{external_id}/metadata")
    except httpx.HTTPError as exc:  # timeouts and connection failures, after the client's own retries
        raise MatchFetchNotReady(f"deadlock-api unreachable: {type(exc).__name__}") from exc
    status = response.status_code
    if status in (404, 429) or status >= 500:
        raise MatchFetchNotReady(f"deadlock-api answered {status} for match {external_id}")
    if status != 200:
        raise MatchFetchFailed(f"deadlock-api refused match {external_id} ({status})")
    try:
        json.loads(response.content)["match_info"]
    except (ValueError, TypeError, KeyError) as exc:
        raise MatchFetchFailed(f"deadlock-api answered match {external_id} with something other than metadata") from exc
    return response.content
