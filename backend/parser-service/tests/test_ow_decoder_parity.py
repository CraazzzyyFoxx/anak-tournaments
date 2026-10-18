"""The module decoder (+ ``derive_match``) reproduces what the P4 parser wrote, bit for bit.

``fixtures/ow_decoder_reference`` holds raw Workshop bytes and the observations the unchanged P4 path
(``flows.process_match_log``) persisted for them, keyed by handle and team ``source_position`` and stored as IEEE-754
hex (signed zero and the last ulp are compared). The decoder's document is projected into the same shape and compared
exactly: no tolerance. Events are a multiset; an empty ``data`` object is the same observation as no data.

Case inputs the P4 path read from the database are rebuilt here: the catalog names, the roster rank/role of each seat
(``manifest.cases.items.*.ranks``) and the seeded baselines (``baselines.json``).
"""

from __future__ import annotations

import asyncio
import json
import struct
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from shared.core.enums import LogStatsName
from shared.disciplines.ingest import BoundMatch, BoundParticipant, DecodeContext
from shared.disciplines.overwatch import baselines, impact, ingest
from shared.schemas.match_doc import MatchDoc, MatchSource

DIRECTORY = Path(__file__).parent / "fixtures" / "ow_decoder_reference"
MANIFEST = json.loads((DIRECTORY / "manifest.json").read_bytes())
CASES = MANIFEST["cases"]["items"]
#: What ``_seed`` + the second capture hero put in the catalog, in catalog id order.
CTX = DecodeContext(
    discipline="overwatch",
    source=MatchSource(kind="upload"),
    hint=None,
    received_at=datetime(2026, 10, 18, tzinfo=UTC),
    characters={"Ingest Ana": "ingest-ana", "Ана-инжест": "ingest-ana", "Ingest Reaper": "ingest-reaper"},
    maps={("Ingest Control", "Ingest Ilios"): "ingest-ilios", ("Ingest Control", "Илиос-инжест"): "ingest-ilios"},
    attrs={"ingest-ana": {"class": "support"}, "ingest-reaper": {"class": "damage"}},
)
#: Users in creation order (P4 broke rank ties by user id): the seed, then each case's added users.
SEEDED_USERS = ["IngestH0", "IngestH1", "IngestH2", "IngestA0", "IngestA1", "IngestA2", "IngestEventOnly"]
ROSTER_RANK = 800


def bits(value: float) -> dict:
    return {"value": value, "bits": struct.pack(">d", value).hex()}


def observation(doc: MatchDoc) -> dict:
    position = {team.key: index for index, team in enumerate(doc.teams, 1)}
    team_of = {person.key: person.team for person in doc.participants}

    def who(key: str | None) -> dict:
        return {"team_position": None if key is None else position[team_of[key]], "handle": key}

    facts = sorted(
        (
            {
                "segment": f.segment,
                "team_position": position[f.team if f.participant is None else team_of[f.participant]],
                "handle": f.participant,
                "hero": f.entity,
                "stat": f.stat,
                **bits(f.value),
            }
            for f in doc.facts
        ),
        key=lambda r: (r["segment"], r["team_position"], r["handle"] or "", r["hero"] or "", r["stat"]),
    )
    events = sorted(
        (
            {
                "segment": e.segment,
                "t": bits(e.t),
                "type": e.type,
                "actor": who(e.actor),
                "target": who(e.target),
                "hero": e.entity,
                "related_hero": e.related_entity,
                "data": e.data or None,
            }
            for e in doc.events
        ),
        key=lambda r: json.dumps(r, sort_keys=True),
    )
    return {
        "map": doc.map,
        "duration_s": bits(doc.duration_s),
        "segments": [{"segment": s.index, "kind": s.kind} for s in sorted(doc.segments, key=lambda s: s.index)],
        "team_scores": {
            str(r["team_position"]): {"value": r["value"], "bits": r["bits"]}
            for r in facts
            if r["stat"] == "score" and r["segment"] == 0 and r["handle"] is None
        },
        "players": {
            person.key: {
                "team_position": position[person.team],
                "observed_role": None if person.role is None else person.role.role,
            }
            for person in sorted(doc.participants, key=lambda p: p.key)
        },
        "facts": facts,
        "events": events,
    }


def assert_matches(doc: MatchDoc, expected: dict) -> None:
    actual = observation(doc)
    match = expected["match"]  # map and duration; its revision is a writer's counter, not an observation
    assert actual.pop("map") == match["map"]
    assert actual.pop("duration_s") == match["duration_s"]
    for section in ("segments", "team_scores", "players", "events"):
        assert actual[section] == expected[section], section
    assert len(actual["facts"]) == len(expected["facts"])
    for got, want in zip(actual["facts"], expected["facts"], strict=True):
        assert got == want, (got, want)


def baseline_set() -> impact.BaselineSet:
    spec = json.loads((DIRECTORY / "baselines.json").read_bytes())
    return impact.BaselineSet(
        spec["formula_version"],
        tuple(spec["bucket_bounds"]),
        {
            (row["role"].lower(), row["rank_bucket"], LogStatsName(row["stat"]).name): (row["mean"], row["std"])
            for row in spec["rows"]
        },
    )


def bind(doc: MatchDoc, item: dict) -> BoundMatch:
    """The P4 roster view of each seat: who played, which rank/role the roster row had, and creation-order user ids."""
    users = SEEDED_USERS + [user["name"] for user in item["users"]]
    rosters = {user["name"]: user.get("rank", ROSTER_RANK) for user in item["users"] if user["team"] is not None}
    ranks = {**dict.fromkeys(SEEDED_USERS[:-1], ROSTER_RANK), **rosters, **item["ranks"]}
    seats = {}
    for person in doc.participants:
        handle = person.key
        rostered = handle in ranks
        if handle == "IngestSub":  # seated as a substitute for IngestH3: the replaced starter's role and rank
            rostered, rank = True, ranks["IngestH3"]
        else:
            rank = ranks.get(handle, 0)
        seats[handle] = BoundParticipant(
            member_id=users.index(handle) + 1000,
            user_id=users.index(handle) + 1,
            encounter_team_id=100 if person.team == "home" else 200,
            rank=rank,
            role="support" if rostered else None,
        )
    return BoundMatch(workspace_id=1, encounter_id=2, encounter_game_id=3, participants=seats)


def test_base_case_decodes_to_the_frozen_p4_observations():
    doc = ingest.decode((DIRECTORY / "workshop.csv").read_bytes(), CTX)
    assert_matches(doc, json.loads((DIRECTORY / "expected.json").read_bytes()))


@pytest.mark.parametrize("name", sorted(CASES))
def test_extra_cases_decode_and_derive_to_the_frozen_p4_observations(name, monkeypatch):
    item = CASES[name]
    decoded = ingest.decode((DIRECTORY / item["raw"]["file"]).read_bytes(), CTX)
    monkeypatch.setattr(baselines, "get_active", AsyncMock(return_value=baseline_set()))
    doc = asyncio.run(ingest.derive_match(SimpleNamespace(), decoded, bind(decoded, item)))

    expected = json.loads((DIRECTORY / item["expected"]["file"]).read_bytes())
    assert_matches(doc, expected)
    # The decoder alone never carries the three baseline-dependent facts; derivation adds exactly them.
    derived = {"impact_points", "impact_rank", "overperformance_score"}
    assert not [f for f in decoded.facts if f.stat in derived]
    assert {f.stat for f in doc.facts} - {f.stat for f in decoded.facts} == derived


def test_the_comparison_distinguishes_signed_zero_and_the_last_ulp():
    doc = ingest.decode((DIRECTORY / "workshop.csv").read_bytes(), CTX)
    expected = json.loads((DIRECTORY / "expected.json").read_bytes())
    expected["facts"][0]["bits"] = "8000000000000000"  # -0.0 where 0.0/3.0 was captured
    with pytest.raises(AssertionError):
        assert_matches(doc, expected)
