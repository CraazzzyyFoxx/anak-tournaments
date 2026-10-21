"""deadlock-api ``/v1/matches/{id}/metadata`` -> ``owt.match/1``. Pure: the bytes and the catalog context only.

Teams ``team0`` (Hidden King) and ``team1`` (Archmother), placed by ``winning_team``; the map is always ``midtown`` and
the document carries no mode (``MatchDoc`` has none). A participant is keyed ``p<player_slot>`` (1..12, what
``killer_player_slot`` names) and identified by its Steam account id. Per-player facts on the played hero: the
top-level counters plus the damage/healing totals of the last ``stats[]`` snapshot; one ``kill`` event per
``death_details`` entry, the dead player as target. A player with ``account_id == 0`` (anonymous) is dropped with its
facts and every kill it took part in. A ``hero_id`` no catalog hero carries as ``attrs.deadlock_id`` is handed on
verbatim so the semantic validator reports it.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError

from shared.core.social import SocialProvider
from shared.disciplines.ingest import DecodeContext, DecodeError
from shared.schemas.match_doc import PROTOCOL, IngestIssue, MatchDoc, MatchDocError

__all__ = ("decode",)

MAP = "midtown"
TEAMS = ("team0", "team1")
_TOP_LEVEL = ("kills", "deaths", "assists", "net_worth", "last_hits", "denies", "level")
_LAST_SNAPSHOT = ("player_damage", "boss_damage", "player_healing", "player_damage_taken")


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _document(info: dict[str, Any], ctx: DecodeContext) -> dict[str, Any]:
    heroes = {attrs["deadlock_id"]: code for code, attrs in ctx.attrs.items() if _number(attrs.get("deadlock_id"))}
    players = {f"p{int(player['player_slot'])}": player for player in info["players"] if int(player["account_id"]) > 0}
    team_of = {key: TEAMS[int(player["team"])] for key, player in players.items()}
    hero_of = {key: heroes.get(player["hero_id"], str(player["hero_id"])) for key, player in players.items()}
    facts: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    for key, player in players.items():
        last = (player.get("stats") or [{}])[-1]
        values = {code: player.get(code) for code in _TOP_LEVEL} | {code: last.get(code) for code in _LAST_SNAPSHOT}
        facts.extend(
            {"participant": key, "entity": hero_of[key], "stat": code, "value": float(value)}
            for code, value in values.items()
            if _number(value)
        )
        for death in player.get("death_details") or []:
            killer = f"p{death.get('killer_player_slot')}"
            if killer not in players:  # an anonymous or non-player killer
                continue
            events.append(
                {
                    "t": float(death["game_time_s"]),
                    "type": "kill",
                    "actor": killer,
                    "target": key,
                    "actor_team": team_of[killer],
                    "target_team": team_of[key],
                    "entity": hero_of[killer],
                    "related_entity": hero_of[key],
                }
            )
    winner = info.get("winning_team")
    return {
        "protocol": PROTOCOL,
        "discipline": ctx.discipline,
        "source": ctx.source,
        "hint": ctx.hint,
        "played_at": datetime.fromtimestamp(int(info["start_time"]), UTC),
        "duration_s": float(info["duration_s"]),
        "map": MAP,
        "teams": [
            {"key": team, "placement": None if winner not in (0, 1) else (1 if index == winner else 2)}
            for index, team in enumerate(TEAMS)
        ],
        "participants": [
            {
                "key": key,
                "team": team_of[key],
                "identity": {"provider": str(SocialProvider.STEAM), "id": str(int(player["account_id"]))},
            }
            for key, player in players.items()
        ],
        "facts": facts,
        "events": sorted(events, key=lambda event: event["t"]),
    }


def decode(raw: bytes, ctx: DecodeContext) -> MatchDoc:
    try:
        document = _document(json.loads(raw)["match_info"], ctx)
    except (ValueError, KeyError, TypeError, AttributeError, IndexError, OverflowError) as exc:
        raise DecodeError("invalid_metadata", "The bytes are not deadlock-api match metadata") from exc
    try:
        return MatchDoc.model_validate(document)
    except ValidationError as exc:
        raise MatchDocError(
            [IngestIssue(list(error["loc"]), error["type"], error["msg"]) for error in exc.errors()]
        ) from None
