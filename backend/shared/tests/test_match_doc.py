"""Structural contract of ``owt.match/1``: every case changes exactly one property of a valid document."""

from __future__ import annotations

import copy
import json
import math

import pytest
from pydantic import ValidationError

from shared.schemas.match_doc import MatchDoc, MatchDocError, parse_match_doc

DOC = {
    "protocol": "owt.match/1",
    "discipline": "overwatch",
    "source": {"kind": "external", "external_id": "p5-example-g1"},
    "played_at": "2026-10-15T12:00:00Z",
    "duration_s": 60,
    "map": "ilios",
    "teams": [{"key": "alpha", "placement": 1}, {"key": "beta", "placement": 2}],
    "participants": [
        {
            "key": "a",
            "team": "alpha",
            "identity": {"provider": "battlenet", "id": "Ana#1234"},
            "role": {"dimension": "player_role", "role": "support"},
        },
        {
            "key": "b",
            "team": "beta",
            "identity": {"provider": "battlenet", "id": "Mercy#5678"},
            "role": {"dimension": "player_role", "role": "support"},
        },
    ],
    "segments": [{"index": 1, "kind": "round", "attrs": {}}],
    "facts": [
        {"team": "alpha", "stat": "score", "value": 2},
        {"team": "beta", "stat": "score", "value": 1},
    ],
    "events": [
        {
            "t": 10,
            "type": "kill",
            "actor": "a",
            "target": "b",
            "entity": "ana",
            "segment": 1,
            "data": {"is_critical_hit": False, "is_environmental": False},
        }
    ],
}


def doc(**changes) -> dict:
    out = copy.deepcopy(DOC)
    out.update(copy.deepcopy(changes))
    return out


def issues_of(raw: dict | bytes) -> list[tuple[list, str]]:
    data = raw if isinstance(raw, bytes) else json.dumps(raw, allow_nan=True).encode()
    with pytest.raises(MatchDocError) as caught:
        parse_match_doc(data)
    return [(issue.path, issue.code) for issue in caught.value.issues]


def only(raw: dict | bytes, path: list, code: str | None = None) -> None:
    found = issues_of(raw)
    assert [p for p, _ in found] == [path], found
    if code is not None:
        assert found[0][1] == code


def py_only(raw: dict, path: list) -> None:
    """Python-object input (no JSON text): nonfinite floats can only arrive this way."""
    with pytest.raises(ValidationError) as caught:
        MatchDoc.model_validate(raw)
    assert [list(error["loc"]) for error in caught.value.errors()] == [path]


def test_segment_zero_has_no_row_and_target_is_real():
    parsed = MatchDoc.model_validate(DOC)
    assert parsed.facts[0].segment == 0
    assert {row.index for row in parsed.segments} == {1}
    assert parsed.events[0].target in {row.key for row in parsed.participants}


def test_valid_document_parses_from_bytes_and_derives_role_parent_nowhere():
    raw = doc()
    raw["participants"][0]["role"]["parent"] = "ignored-as-authority"
    parsed = parse_match_doc(json.dumps(raw).encode())
    assert parsed.participants[0].role.parent is None
    assert parsed.hint is None and parsed.segments[0].attrs == {}


def test_optional_sections_default_empty():
    raw = doc()
    for field in ("segments", "facts", "events"):
        del raw[field]
    parsed = parse_match_doc(json.dumps(raw).encode())
    assert (parsed.segments, parsed.facts, parsed.events) == ([], [], [])


def test_identical_events_keep_multiplicity():
    raw = doc()
    raw["events"] = raw["events"] * 3
    assert len(parse_match_doc(json.dumps(raw).encode()).events) == 3


def test_signed_fact_values_are_legal():
    raw = doc()
    raw["facts"][0]["value"] = -3.5
    assert parse_match_doc(json.dumps(raw).encode()).facts[0].value == -3.5


def test_hint_accepts_positive_ids_only():
    parsed = MatchDoc.model_validate(doc(hint={"encounter_game_id": 5, "encounter_id": 4, "tournament_id": 3}))
    assert parsed.hint.encounter_game_id == 5
    only(doc(hint={"encounter_id": 0}), ["hint", "encounter_id"])
    only(doc(hint={"tournament_id": True}), ["hint", "tournament_id"])
    only(doc(hint={"tournament_id": 1.0}), ["hint", "tournament_id"])
    only(doc(hint={"workspace_id": 1}), ["hint", "workspace_id"], "extra_forbidden")


def test_protocol_is_exact():
    only(doc(protocol="owt.match/2"), ["protocol"], "unsupported_protocol")
    only(doc(protocol=1), ["protocol"], "unsupported_protocol")


def test_unknown_top_level_and_nested_fields_are_rejected():
    only({**DOC, "extra": 1}, ["extra"], "extra_forbidden")
    raw = doc()
    raw["teams"][0]["home"] = True
    only(raw, ["teams", 0, "home"], "extra_forbidden")


def test_missing_required_fields():
    raw = doc()
    del raw["map"]
    only(raw, ["map"], "missing")


@pytest.mark.parametrize("bad", ["", " ", "\t", "x" * 33, "a\x00b", "\ud800"])
def test_discipline_and_source_kind_bounds(bad):
    only(doc(discipline=bad), ["discipline"])
    only(doc(source={"kind": bad}), ["source", "kind"])


@pytest.mark.parametrize("bad", ["", "   ", "x" * 129])
def test_external_id_blank_or_overlong(bad):
    only(doc(source={"kind": "external", "external_id": bad}), ["source", "external_id"])


def test_external_id_is_preserved_exactly():
    parsed = MatchDoc.model_validate(doc(source={"kind": "external", "external_id": " Mixed Case/ID "}))
    assert parsed.source.external_id == " Mixed Case/ID "


@pytest.mark.parametrize(
    ("field", "value"),
    [("played_at", "2026-10-15T12:00:00"), ("played_at", 1760529600), ("played_at", "yesterday"), ("played_at", None)],
)
def test_played_at_requires_timezone_aware_timestamp(field, value):
    only(doc(**{field: value}), [field])


@pytest.mark.parametrize("value", [-1, True, "60", None])
def test_duration_is_finite_nonnegative_number(value):
    only(doc(duration_s=value), ["duration_s"])


@pytest.mark.parametrize("value", [math.inf, -math.inf, math.nan])
def test_duration_rejects_python_nonfinite(value):
    py_only(doc(duration_s=value), ["duration_s"])


def test_zero_duration_is_legal_when_events_stay_at_zero():
    raw = doc(duration_s=0)
    raw["events"][0]["t"] = 0
    assert parse_match_doc(json.dumps(raw).encode()).duration_s == 0


@pytest.mark.parametrize("bad", ["", " ", "m" * 65])
def test_map_code_bounds(bad):
    only(doc(map=bad), ["map"])


def test_teams_need_one_unique_keys_and_placement_in_range():
    only(doc(teams=[]), ["teams"], "too_short")
    only(doc(teams=[{"key": "alpha"}, {"key": "beta"}, {"key": "beta"}]), ["teams", 2, "key"], "duplicate_team_key")
    raw = doc()
    raw["teams"][1]["placement"] = 3
    only(raw, ["teams", 1, "placement"], "placement_out_of_range")
    for bad in (0, -1, True, 1.5, "1"):
        raw = doc()
        raw["teams"][0]["placement"] = bad
        only(raw, ["teams", 0, "placement"])


def test_tied_placements_are_allowed():
    raw = doc()
    raw["teams"][1]["placement"] = 1
    assert [t.placement for t in parse_match_doc(json.dumps(raw).encode()).teams] == [1, 1]


def test_participant_references_and_duplicates():
    raw = doc()
    raw["participants"].append({"key": "b", "team": "beta", "identity": {"provider": "battlenet", "id": "Other#1"}})
    only(raw, ["participants", 2, "key"], "duplicate_participant_key")
    raw = doc()
    raw["participants"][1]["team"] = "gamma"
    only(raw, ["participants", 1, "team"], "unknown_team")


def test_identity_cannot_repeat_even_across_teams_after_normalization():
    raw = doc()
    raw["participants"][1]["identity"]["id"] = "ana # 1234"
    only(raw, ["participants", 1, "identity"], "duplicate_identity")


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("provider",), ""),
        (("provider",), " "),
        (("provider",), "p" * 33),
        (("id",), ""),
        (("id",), "  "),
        (("id",), "i" * 256),
        (("id",), "bad\x00id"),
    ],
)
def test_identity_blank_or_overlong(path, value):
    raw = doc()
    raw["participants"][0]["identity"][path[0]] = value
    only(raw, ["participants", 0, "identity", path[0]])


def test_role_keys_are_closed_even_though_the_shared_model_ignores_extras():
    raw = doc()
    raw["participants"][0]["role"]["rank"] = "gold"
    only(raw, ["participants", 0, "role", "rank"], "extra_forbidden")
    raw = doc()
    del raw["participants"][0]["role"]["role"]
    only(raw, ["participants", 0, "role", "role"], "missing")
    raw = doc()
    raw["participants"][0]["role"]["role"] = " "
    only(raw, ["participants", 0, "role"])


def test_role_is_optional():
    raw = doc()
    del raw["participants"][0]["role"]
    assert parse_match_doc(json.dumps(raw).encode()).participants[0].role is None


def test_segments_bounds_kinds_and_attrs():
    only(doc(segments=[{"index": 0, "kind": "round"}]), ["segments", 0, "index"])
    only(doc(segments=[{"index": 32768, "kind": "round"}]), ["segments", 0, "index"])
    only(doc(segments=[{"index": True, "kind": "round"}]), ["segments", 0, "index"])
    only(doc(segments=[{"index": 1, "kind": "k" * 17}]), ["segments", 0, "kind"])
    only(
        doc(segments=[{"index": 1, "kind": "round"}, {"index": 1, "kind": "round"}]),
        ["segments", 1, "index"],
        "duplicate_segment_index",
    )
    only(doc(segments=[{"index": 1, "kind": "round", "attrs": [1]}]), ["segments", 0, "attrs"])
    py_only(doc(segments=[{"index": 1, "kind": "round", "attrs": {"x": math.inf}}]), ["segments", 0, "attrs"])
    only(doc(segments=[{"index": 1, "kind": "round", "attrs": {"x": ["a\x00"]}}]), ["segments", 0, "attrs"])


def test_json_attrs_depth_is_bounded_without_recursing():
    deep: dict = {}
    node = deep
    for _ in range(40):
        node["n"] = {}
        node = node["n"]
    only(doc(segments=[{"index": 1, "kind": "round", "attrs": deep}]), ["segments", 0, "attrs"])


def test_fact_owner_is_exactly_one():
    raw = doc()
    raw["facts"][0]["participant"] = "a"
    only(raw, ["facts", 0], "fact_owner")
    raw = doc()
    del raw["facts"][0]["team"]
    only(raw, ["facts", 0], "fact_owner")


@pytest.mark.parametrize("value", [True, False, "1", None])
def test_fact_value_is_finite_number(value):
    raw = doc()
    raw["facts"][0]["value"] = value
    only(raw, ["facts", 0, "value"])


@pytest.mark.parametrize("value", [math.inf, -math.inf, math.nan])
def test_fact_value_rejects_python_nonfinite(value):
    raw = doc()
    raw["facts"][0]["value"] = value
    py_only(raw, ["facts", 0, "value"])


def test_fact_references_and_segments_must_exist():
    raw = doc()
    raw["facts"][0]["team"] = "gamma"
    only(raw, ["facts", 0, "team"], "unknown_team")
    raw = doc()
    raw["facts"][0] = {"participant": "zz", "stat": "score", "value": 1}
    only(raw, ["facts", 0, "participant"], "unknown_participant")
    raw = doc()
    raw["facts"][0]["segment"] = 2
    only(raw, ["facts", 0, "segment"], "unknown_segment")
    raw = doc()
    raw["facts"][0]["segment"] = 1
    assert parse_match_doc(json.dumps(raw).encode()).facts[0].segment == 1


def test_duplicate_fact_key_includes_omitted_default_segment_and_resolved_team():
    raw = doc()
    raw["facts"][1] = {"team": "alpha", "stat": "score", "value": 5, "segment": 0}
    only(raw, ["facts", 1], "duplicate_fact")
    raw = doc()
    raw["facts"] = [
        {"participant": "a", "stat": "kills", "value": 1, "entity": "ana"},
        {"participant": "a", "stat": "kills", "value": 2, "entity": "ana", "segment": 0},
    ]
    only(raw, ["facts", 1], "duplicate_fact")


def test_same_stat_for_different_owner_entity_or_segment_is_not_a_duplicate():
    raw = doc()
    raw["facts"] = [
        {"team": "alpha", "stat": "score", "value": 1},
        {"participant": "a", "stat": "score", "value": 1},
        {"participant": "a", "stat": "score", "value": 1, "entity": "ana"},
        {"participant": "a", "stat": "score", "value": 1, "entity": "ana", "segment": 1},
    ]
    assert len(parse_match_doc(json.dumps(raw).encode()).facts) == 4


def test_event_time_and_references():
    for t in (-1, True, "1"):
        raw = doc()
        raw["events"][0]["t"] = t
        only(raw, ["events", 0, "t"])
    raw = doc()
    raw["events"][0]["t"] = math.inf
    py_only(raw, ["events", 0, "t"])
    raw = doc()
    raw["events"][0]["t"] = 60.5
    only(raw, ["events", 0, "t"], "event_after_end")
    raw = doc()
    raw["events"][0]["t"] = 60
    assert parse_match_doc(json.dumps(raw).encode()).events[0].t == 60
    raw = doc()
    raw["events"][0]["target"] = "p7"
    only(raw, ["events", 0, "target"], "unknown_participant")
    raw = doc()
    raw["events"][0]["actor_team"] = "gamma"
    only(raw, ["events", 0, "actor_team"], "unknown_team")
    raw = doc()
    raw["events"][0]["segment"] = 9
    only(raw, ["events", 0, "segment"], "unknown_segment")


def test_event_explicit_team_must_agree_with_participant():
    raw = doc()
    raw["events"][0]["actor_team"] = "beta"
    only(raw, ["events", 0, "actor_team"], "event_team_mismatch")
    raw = doc()
    raw["events"][0]["target_team"] = "alpha"
    only(raw, ["events", 0, "target_team"], "event_team_mismatch")
    raw = doc()
    raw["events"][0].update(actor_team="alpha", target_team="beta")
    assert parse_match_doc(json.dumps(raw).encode()).events[0].actor_team == "alpha"


def test_team_only_event_is_legal():
    raw = doc()
    raw["events"] = [{"t": 1, "type": "objective_capture", "actor_team": "alpha"}]
    assert parse_match_doc(json.dumps(raw).encode()).events[0].actor is None


def test_event_data_is_a_json_object():
    raw = doc()
    raw["events"][0]["data"] = "x"
    only(raw, ["events", 0, "data"])
    raw = doc()
    raw["events"][0]["type"] = "t" * 65
    only(raw, ["events", 0, "type"])


def test_python_nonfinite_input_is_rejected_recursively():
    raw = doc()
    raw["events"][0]["data"] = {"nested": [{"v": math.nan}]}
    with pytest.raises(ValidationError) as caught:
        MatchDoc.model_validate(raw)
    assert [error["loc"] for error in caught.value.errors()] == [("events", 0, "data")]


# ── raw JSON forms ────────────────────────────────────────────────────────────


def test_raw_nonfinite_literals_are_invalid_json():
    base = json.dumps(DOC)
    for literal in ("NaN", "Infinity", "-Infinity", "1e999"):
        only(base.replace('"duration_s": 60', f'"duration_s": {literal}').encode(), [], "invalid_json")
    nested = base.replace('"is_critical_hit": false', '"is_critical_hit": NaN')
    only(nested.encode(), [], "invalid_json")


def test_duplicate_object_keys_are_rejected_at_any_depth():
    base = json.dumps(DOC)
    only(base.replace('"map": "ilios"', '"map": "ilios", "map": "other"').encode(), [], "duplicate_key")
    only(base.replace('"index": 1,', '"index": 1, "index": 1,', 1).encode(), [], "duplicate_key")


def test_trailing_documents_and_garbage_are_rejected():
    only((json.dumps(DOC) + " {}").encode(), [], "invalid_json")
    only((json.dumps(DOC) + " x").encode(), [], "invalid_json")
    only(b"", [], "invalid_json")
    only(b"[]", [], "invalid_document")
    only(b"nul", [], "invalid_json")


def test_invalid_utf8_and_bom_are_rejected():
    only(json.dumps(DOC).encode()[:-1] + b"\xff}", [], "invalid_utf8")
    only(b"\xef\xbb\xbf" + json.dumps(DOC).encode(), [], "invalid_json")


def test_escaped_nul_and_lone_surrogate_in_text_are_rejected():
    raw = json.dumps(DOC).replace('"ilios"', '"il\\u0000ios"').encode()
    only(raw, ["map"])
    raw = json.dumps(DOC).replace('"ilios"', '"il\\ud800ios"').encode()
    only(raw, ["map"])


def test_oversized_document_is_rejected_by_the_body_cap_before_parsing():
    with pytest.raises(MatchDocError) as caught:
        parse_match_doc(b" " * 11, max_bytes=10)
    assert caught.value.issues[0].code == "document_too_large"


def test_deep_json_nesting_is_an_error_not_a_crash():
    raw = b'{"a":' * 200_000 + b"1" + b"}" * 200_000
    with pytest.raises(MatchDocError):
        parse_match_doc(raw)


def test_issue_count_is_bounded():
    raw = doc(facts=[{"stat": "s", "value": 1}] * 1000)
    with pytest.raises(MatchDocError) as caught:
        parse_match_doc(json.dumps(raw).encode())
    assert len(caught.value.issues) == 200
