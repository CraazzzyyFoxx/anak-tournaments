"""``derive_match``: the baseline/rank-dependent facts, DB-free (the baselines read is substituted).

Exact parity with the P4 backfill outputs is pinned in ``parser-service/tests/test_ow_decoder_parity.py``.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from shared.core.impact import IMPACT_WEIGHTS
from shared.disciplines.ingest import BoundMatch, BoundParticipant
from shared.disciplines.overwatch import baselines, impact, ingest
from shared.schemas.match_doc import MatchDoc

DERIVED = {"impact_points", "overperformance_score", "impact_rank"}


def baseline_set() -> impact.BaselineSet:
    return impact.BaselineSet(
        formula_version="impact_v1",
        bucket_bounds=(500.0, 1000.0),
        values={
            ("damage", -1, "Eliminations"): (10.0, 5.0),
            ("damage", -1, "FirstPicks"): (1.0, 1.0),
            ("damage", 1, "Eliminations"): (12.0, 5.0),
            ("damage", 1, "FirstPicks"): (1.5, 1.0),
        },
    )


def fact(participant: str, stat: str, value: float, segment: int = 1, entity: str | None = None) -> dict:
    return {"participant": participant, "stat": stat, "value": value, "segment": segment, "entity": entity}


def document(*extra: dict, kill: bool = True) -> MatchDoc:
    facts = [
        fact("a", "eliminations", 20.0),
        fact("a", "deaths", 5.0),
        fact("a", "hero_time_played", 600.0),
        fact("a", "first_picks", 3.0),
        fact("b", "eliminations", 5.0),
        fact("b", "deaths", 10.0),
        fact("b", "hero_time_played", 600.0),
        *extra,
    ]
    return MatchDoc.model_validate(
        {
            "protocol": "owt.match/1",
            "discipline": "overwatch",
            "source": {"kind": "upload"},
            "played_at": "2026-10-18T12:00:00Z",
            "duration_s": 700.0,
            "map": "ilios",
            "teams": [{"key": "home"}, {"key": "away"}],
            "participants": [
                {"key": key, "team": team, "identity": {"provider": "battlenet", "id": key.upper()}}
                for key, team in (("a", "home"), ("b", "away"))
            ],
            "segments": [{"index": 1, "kind": "round"}, {"index": 2, "kind": "round"}],
            "facts": facts,
            "events": [{"t": 5.0, "type": "kill", "actor": "a", "target": "b", "segment": 1}] if kill else [],
        }
    )


def binding(**overrides: BoundParticipant) -> BoundMatch:
    seat = {
        "a": BoundParticipant(member_id=1, user_id=101, encounter_team_id=10, rank=800, role="damage"),
        "b": BoundParticipant(member_id=2, user_id=102, encounter_team_id=20, rank=800, role="damage"),
    }
    return BoundMatch(workspace_id=1, encounter_id=2, encounter_game_id=3, participants={**seat, **overrides})


def derive(doc: MatchDoc, monkeypatch, *, baselines_value=None, bound: BoundMatch | None = None) -> MatchDoc:
    monkeypatch.setattr(baselines, "get_active", AsyncMock(return_value=baselines_value))
    return asyncio.run(ingest.derive_match(SimpleNamespace(), doc, bound or binding()))


def derived(doc: MatchDoc, stat: str, segment: int = 1) -> dict[str, float]:
    return {f.participant: f.value for f in doc.facts if f.stat == stat and f.segment == segment}


def test_scores_overperformance_and_rank_are_emitted_per_segment(monkeypatch):
    out = derive(document(), monkeypatch, baselines_value=baseline_set())

    # Eliminations rate 20/10min -> z=2.0 (w=1.3); first picks 3 -> z=2.0 (w=0.55); player b: -1.0 and -1.0.
    points = derived(out, "impact_points")
    assert points["a"] == pytest.approx(IMPACT_WEIGHTS["Eliminations"] * 2.0 + IMPACT_WEIGHTS["FirstPicks"] * 2.0)
    assert points["b"] == pytest.approx(IMPACT_WEIGHTS["Eliminations"] * -1.0 + IMPACT_WEIGHTS["FirstPicks"] * -1.0)
    # Rank bucket 1 (rank 800 sits between the bounds): a z=1.6 and 1.5, b z=-1.4 and -1.5.
    over = derived(out, "overperformance_score")
    assert over["a"] == pytest.approx(IMPACT_WEIGHTS["Eliminations"] * 1.6 + IMPACT_WEIGHTS["FirstPicks"] * 1.5)
    assert over["b"] == pytest.approx(IMPACT_WEIGHTS["Eliminations"] * -1.4 + IMPACT_WEIGHTS["FirstPicks"] * -1.5)
    assert derived(out, "impact_rank") == {"a": 1.0, "b": 2.0}
    assert derived(out, "impact_rank", segment=0) == {}  # no segment-0 stat rows in this document


def test_without_baselines_nothing_is_derived_and_the_rest_is_untouched(monkeypatch):
    doc = document()
    out = derive(doc, monkeypatch, baselines_value=None)
    assert out == doc


def test_deriving_twice_replaces_rather_than_appends(monkeypatch):
    once = derive(document(), monkeypatch, baselines_value=baseline_set())
    twice = derive(once, monkeypatch, baselines_value=baseline_set())
    assert sorted(twice.facts, key=repr) == sorted(once.facts, key=repr)
    assert sum(f.stat in DERIVED for f in twice.facts) == 6


def test_the_observed_role_beats_the_seat_and_the_seat_fills_in_when_nothing_was_observed(monkeypatch):
    # b observed as support: no baseline exists for it, so it scores nothing; a keeps the seat's damage role.
    doc = document()
    observed = doc.model_dump()
    observed["participants"][1]["role"] = {"dimension": "player_role", "role": "support"}
    out = derive(MatchDoc.model_validate(observed), monkeypatch, baselines_value=baseline_set())
    assert derived(out, "impact_points")["b"] == 0.0
    assert derived(out, "impact_points")["a"] != 0.0

    seatless = binding(a=BoundParticipant(member_id=1, user_id=101, encounter_team_id=10, rank=800, role=None))
    out = derive(document(), monkeypatch, baselines_value=baseline_set(), bound=seatless)
    assert derived(out, "impact_points")["a"] == 0.0


def test_event_counts_without_killfeed_are_ignored(monkeypatch):
    with_feed = derive(document(), monkeypatch, baselines_value=baseline_set())
    without = derive(document(kill=False), monkeypatch, baselines_value=baseline_set())
    assert derived(without, "impact_points")["a"] == pytest.approx(IMPACT_WEIGHTS["Eliminations"] * 2.0)
    assert derived(without, "impact_points")["a"] != derived(with_feed, "impact_points")["a"]


def test_event_count_facts_alone_never_open_a_player_row(monkeypatch):
    out = derive(document(fact("b", "first_deaths", 1.0, segment=2)), monkeypatch, baselines_value=baseline_set())
    assert derived(out, "impact_points", segment=2) == {}


def test_a_participant_the_core_did_not_bind_is_refused(monkeypatch):
    partial = BoundMatch(workspace_id=1, encounter_id=2, encounter_game_id=3, participants={})
    with pytest.raises(ValueError, match="not bound"):
        derive(document(), monkeypatch, baselines_value=baseline_set(), bound=partial)


def test_performance_ties_break_by_user_id_even_without_baselines(monkeypatch):
    # Keys b, a tie on points; the core bound b to the LOWER user id, so b ranks first (P4 ordered pivots by user id).
    tied = document(fact("a", "performance_points", 10.0), fact("b", "performance_points", 10.0))
    bound = binding(
        a=BoundParticipant(member_id=1, user_id=202, encounter_team_id=10, rank=800, role="damage"),
        b=BoundParticipant(member_id=2, user_id=201, encounter_team_id=20, rank=800, role="damage"),
    )
    out = derive(tied, monkeypatch, baselines_value=None, bound=bound)
    assert derived(out, "performance") == {"b": 1.0, "a": 2.0}
    swapped = derive(tied, monkeypatch, baselines_value=None)  # default binding: a=101 < b=102
    assert derived(swapped, "performance") == {"a": 1.0, "b": 2.0}


def test_performance_is_ranked_per_segment_by_points_first(monkeypatch):
    doc = document(fact("a", "performance_points", 5.0), fact("b", "performance_points", 9.0))
    assert derived(derive(doc, monkeypatch, baselines_value=None), "performance") == {"b": 1.0, "a": 2.0}
