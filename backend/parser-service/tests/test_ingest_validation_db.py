"""Semantic validation of ``owt.match/1`` against real catalog, ontology, tenancy and hint rows.

Every case runs inside one transaction that is rolled back: the validator is read-only by contract, so the checks also
assert it left no pending state and wrote no diagnostic. Misses are persisted by Task 2's failure transaction; here the
repository half is exercised directly against the migrated CHECK domain.
"""

from __future__ import annotations

import asyncio
import copy
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from shared import models
from shared.core import enums
from shared.disciplines import DISCIPLINES
from shared.repository.catalog import CatalogAliasMissRepository
from shared.schemas.match_doc import MatchDoc
from shared.services.ontology import project_disciplines
from shared.testing.db import real_db_sessionmaker
from src.services.ingest.validation import DocumentRejected, ValidatedDocument, load_document, validate_document

DOC = {
    "protocol": "owt.match/1",
    "discipline": "overwatch",
    "source": {"kind": "external", "external_id": "p5-validation-g1"},
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
            "role": {"dimension": "player_role", "role": "support.anchor"},
        },
    ],
    "segments": [{"index": 1, "kind": "round", "attrs": {}}],
    "facts": [
        {"team": "alpha", "stat": "score", "value": 2},
        {"team": "beta", "stat": "score", "value": 1},
        {"participant": "a", "stat": "eliminations", "value": 3, "entity": "ana"},
    ],
    "events": [
        {"t": 10, "type": "kill", "actor": "a", "target": "b", "entity": "ana", "segment": 1, "data": {"crit": False}},
        {"t": 10, "type": "kill", "actor": "a", "target": "b", "entity": "ana", "segment": 1, "data": {"crit": False}},
    ],
}


def doc(**changes) -> MatchDoc:
    raw = copy.deepcopy(DOC)
    raw.update(copy.deepcopy(changes))
    return MatchDoc.model_validate(raw)


async def _seed(session) -> SimpleNamespace:
    await project_disciplines(session)
    tag = uuid4().hex[:8]
    workspaces = [
        models.Workspace(slug=f"iv-a-{tag}", name="Ingest A", disciplines_enabled=["overwatch", "lol"]),
        models.Workspace(slug=f"iv-b-{tag}", name="Ingest B", disciplines_enabled=["overwatch"]),
        models.Workspace(slug=f"iv-c-{tag}", name="Ingest C", disciplines_enabled=["lol"]),
    ]
    session.add_all(workspaces)
    await session.flush()
    wa, wb, wc = (w.id for w in workspaces)
    tournaments = [
        models.Tournament(workspace_id=wa, discipline="overwatch", name="A cup", slug=f"iv-ta-{tag}"),
        models.Tournament(workspace_id=wa, discipline="overwatch", name="A cup 2", slug=f"iv-ta2-{tag}"),
        models.Tournament(workspace_id=wb, discipline="overwatch", name="B cup", slug=f"iv-tb-{tag}"),
        models.Tournament(workspace_id=wa, discipline="lol", name="A lol cup", slug=f"iv-tl-{tag}"),
    ]
    session.add_all(tournaments)
    rule = models.ScoringRule(
        workspace_id=wa, preset="wins", game_formula="win", end_formula="games >= best_of or max_wins * 2 > best_of"
    )
    rule_b = models.ScoringRule(
        workspace_id=wb, preset="wins", game_formula="win", end_formula="games >= best_of or max_wins * 2 > best_of"
    )
    entities = [
        models.CatalogEntity(discipline="overwatch", kind="map", slug="ilios", name=f"Ilios {tag}", attrs={}),
        models.CatalogEntity(
            discipline="overwatch", kind="map", slug="gone-map", name=f"Gone {tag}", attrs={}, active=False
        ),
        models.CatalogEntity(
            discipline="overwatch",
            kind="character",
            slug="ana",
            name=f"Ana {tag}",
            attrs={"class": "support"},
            aliases=["Ана"],
        ),
        models.CatalogEntity(discipline="overwatch", kind="mode", slug="ana-mode", name=f"Mode {tag}", attrs={}),
        models.CatalogEntity(discipline="lol", kind="character", slug="lol-only", name=f"Lol hero {tag}", attrs={}),
        models.CatalogEntity(discipline="lol", kind="map", slug="rift", name=f"Rift {tag}", attrs={}),
    ]
    session.add_all([rule, rule_b, *entities])
    await session.flush()
    ta, ta2, tb, _tl = tournaments
    ilios = entities[0]
    encounters = [
        models.Encounter(
            workspace_id=workspace,
            discipline="overwatch",
            tournament_id=t.id,
            scoring_rule_id=r.id,
            name="Series",
            slot_count=2,
            status=enums.EncounterStatus.OPEN,
        )
        for workspace, t, r in ((wa, ta, rule), (wb, tb, rule_b), (wa, ta2, rule))
    ]
    session.add_all(encounters)
    await session.flush()
    games = [
        models.EncounterGame(encounter_id=e.id, position=1, map_id=ilios.id, state=enums.EncounterGameState.PLANNED)
        for e in encounters
    ]
    session.add_all(games)
    await session.flush()
    dimension = await session.scalar(
        sa.select(models.RoleDimension).where(
            models.RoleDimension.discipline == "overwatch", models.RoleDimension.rated
        )
    )
    support = await session.scalar(
        sa.select(models.CatalogRole).where(
            models.CatalogRole.dimension_id == dimension.id,
            models.CatalogRole.code == "support",
            models.CatalogRole.workspace_id.is_(None),
        )
    )
    anchor = models.CatalogRole(
        dimension_id=dimension.id, code="support.anchor", name="Anchor", parent_role_id=support.id, workspace_id=wa
    )
    foreign = models.CatalogRole(
        dimension_id=dimension.id, code="support.foreign", name="Foreign", parent_role_id=support.id, workspace_id=wb
    )
    session.add_all([anchor, foreign])
    await session.flush()
    return SimpleNamespace(
        wa=wa,
        wb=wb,
        wc=wc,
        ta=ta.id,
        tb=tb.id,
        ta2=ta2.id,
        tl=_tl.id,
        ea=encounters[0].id,
        eb=encounters[1].id,
        ga=games[0].id,
        gb=games[1].id,
        ga2=games[2].id,
        ilios=ilios.id,
        ana=entities[2].id,
        support=support.id,
        anchor=anchor.id,
        support_code=support.code,
    )


@asynccontextmanager
async def seeded():
    async with real_db_sessionmaker() as sessionmaker, sessionmaker() as session:
        try:
            yield await _seed(session), session
        finally:
            await session.rollback()


def run(case):
    async def main():
        async with seeded() as (env, session):
            await case(env, session)

    asyncio.run(main())


async def rejected(session, workspace_id, document) -> DocumentRejected:
    with pytest.raises(DocumentRejected) as caught:
        await validate_document(session, workspace_id=workspace_id, doc=document)
    return caught.value


def paths(error: DocumentRejected):
    return [(issue.path, issue.code) for issue in error.issues]


def test_valid_document_resolves_native_ids_and_keeps_every_event_without_writing():
    async def case(env, session):
        misses = await session.scalar(sa.select(sa.func.count()).select_from(models.CatalogAliasMiss))
        validated = await validate_document(session, workspace_id=env.wa, doc=doc())
        assert isinstance(validated, ValidatedDocument)
        assert validated.map_id == env.ilios
        assert validated.entity_ids == {"ana": env.ana}
        assert set(validated.stat_ids) == {"score", "eliminations"} and set(validated.event_type_ids) == {"kill"}
        assert validated.role_ids == {
            ("player_role", "support"): env.support,
            ("player_role", "support.anchor"): env.anchor,
        }
        assert len(validated.doc.events) == 2
        assert not session.new and not session.dirty and not session.deleted
        assert misses == await session.scalar(sa.select(sa.func.count()).select_from(models.CatalogAliasMiss))

    run(case)


def test_load_document_turns_bad_bytes_into_a_structured_rejection():
    with pytest.raises(DocumentRejected) as caught:
        load_document(json.dumps({**DOC, "map": ""}).encode())
    assert caught.value.code == "invalid_document" and caught.value.issues[0].path == ["map"]
    assert load_document(json.dumps(DOC).encode()).map == "ilios"


def test_misses_are_collected_per_actual_kind_with_paths_and_deduplicated():
    async def case(env, session):
        raw = copy.deepcopy(DOC)
        raw["map"] = "nowhere"
        raw["facts"][0]["stat"] = "no_such_stat"
        raw["facts"][2]["entity"] = "ghost"
        raw["events"][0]["type"] = "no_such_event"
        raw["events"][1]["type"] = "no_such_event"
        raw["events"][1]["related_entity"] = "ghost"
        raw["participants"][0]["role"] = {"dimension": "player_role", "role": "ghost"}
        error = await rejected(session, env.wa, MatchDoc.model_validate(raw))
        assert error.code == "unresolved_references"
        assert error.misses() == {
            "character": ("ghost",),
            "event": ("no_such_event",),
            "map": ("nowhere",),
            "role": ("player_role:ghost",),
            "stat": ("no_such_stat",),
        }
        assert paths(error) == [
            (["map"], "unknown_map"),
            (["facts", 0, "stat"], "unknown_stat"),
            (["facts", 2, "entity"], "unknown_character"),
            (["events", 0, "type"], "unknown_event"),
            (["participants", 0, "role"], "unknown_role"),
        ]
        assert not session.new and not session.dirty

    run(case)


def test_codes_resolve_only_inside_their_discipline_kind_and_active_state():
    async def case(env, session):
        # Another discipline's character/map, a mode with a character's slug, and deactivated vocabulary.
        for field, value, kind in (
            ("map", "rift", "map"),
            ("map", "gone-map", "map"),
            ("map", "ana", "map"),
        ):
            error = await rejected(session, env.wa, doc(**{field: value}))
            assert error.misses() == {kind: (value,)}
        raw = copy.deepcopy(DOC)
        raw["facts"][2]["entity"] = "lol-only"
        raw["events"][0]["entity"] = "ana-mode"
        assert (await rejected(session, env.wa, MatchDoc.model_validate(raw))).misses() == {
            "character": ("ana-mode", "lol-only")
        }
        await session.execute(sa.update(models.StatDef).where(models.StatDef.code == "score").values(active=False))
        await session.execute(sa.update(models.EventType).where(models.EventType.code == "kill").values(active=False))
        error = await rejected(session, env.wa, doc())
        assert error.misses() == {"event": ("kill",), "stat": ("score",)}

    run(case)


def test_canonical_codes_are_not_synonym_normalised_through_aliases():
    async def case(env, session):
        raw = copy.deepcopy(DOC)
        raw["facts"][2]["entity"] = "Ана"  # alias of ana, not its code
        assert (await rejected(session, env.wa, MatchDoc.model_validate(raw))).misses() == {"character": ("Ана",)}

    run(case)


def test_roles_need_the_rated_dimension_this_workspace_and_a_module_root():
    async def case(env, session):
        for role, expected in (
            ({"dimension": "player_role", "role": "support.foreign"}, "player_role:support.foreign"),
            ({"dimension": "position", "role": "support"}, "position:support"),
            ({"dimension": "player_role", "role": "flex"}, "player_role:flex"),
        ):
            raw = copy.deepcopy(DOC)
            raw["participants"][0]["role"] = role
            assert (await rejected(session, env.wa, MatchDoc.model_validate(raw))).misses() == {"role": (expected,)}
        # The same leaf is valid in its own workspace and invalid in the other one.
        raw = copy.deepcopy(DOC)
        raw["participants"][0]["role"] = {"dimension": "player_role", "role": "support.foreign"}
        raw["participants"][1]["role"] = {"dimension": "player_role", "role": "support"}
        validated = await validate_document(session, workspace_id=env.wb, doc=MatchDoc.model_validate(raw))
        assert validated.role_ids[("player_role", "support.foreign")] is not None
        # A deactivated leaf stops resolving.
        await session.execute(
            sa.update(models.CatalogRole).where(models.CatalogRole.id == env.anchor).values(active=False)
        )
        assert (await rejected(session, env.wa, doc())).misses() == {"role": ("player_role:support.anchor",)}
        # An active leaf under a deactivated ancestor does not descend from a module role any more.
        await session.execute(
            sa.update(models.CatalogRole).where(models.CatalogRole.id == env.anchor).values(active=True)
        )
        await session.execute(
            sa.update(models.CatalogRole).where(models.CatalogRole.id == env.support).values(active=False)
        )
        error = await rejected(session, env.wa, doc())
        assert [(i.code, i.raw_name) for i in error.issues] == [
            ("unknown_role", "player_role:support"),
            ("invalid_role", "player_role:support.anchor"),
        ]

    run(case)


def test_role_parent_input_is_never_authority():
    async def case(env, session):
        raw = copy.deepcopy(DOC)
        raw["participants"][0]["role"]["parent"] = "tank"
        validated = await validate_document(session, workspace_id=env.wa, doc=MatchDoc.model_validate(raw))
        assert validated.role_ids[("player_role", "support")] == env.support
        assert validated.doc.participants[0].role.parent is None

    run(case)


def test_unknown_identity_provider_is_a_request_error_not_a_battlenet_fallback():
    async def case(env, session):
        raw = copy.deepcopy(DOC)
        raw["participants"][1]["identity"]["provider"] = "riot"
        error = await rejected(session, env.wa, MatchDoc.model_validate(raw))
        assert error.code == "unknown_identity_provider"
        assert paths(error) == [(["participants", 1, "identity", "provider"], "unknown_identity_provider")]
        assert error.misses() == {}

    run(case)


def test_unknown_or_disabled_discipline_is_structured_and_records_no_miss():
    async def case(env, session):
        unknown = await rejected(session, env.wa, doc(discipline="no-such-game", map="x"))
        assert (unknown.code, paths(unknown), unknown.misses()) == (
            "unknown_discipline",
            [(["discipline"], "unknown_discipline")],
            {},
        )
        disabled = await rejected(session, env.wb, doc(discipline="lol"))
        assert (disabled.code, disabled.misses()) == ("discipline_not_enabled", {})
        assert (await rejected(session, 999_999_999, doc())).code == "discipline_not_enabled"
        assert DISCIPLINES["overwatch"].identity_provider == "battlenet"

    run(case)


def test_same_codes_in_another_discipline_do_not_resolve_and_a_lol_document_uses_lol_vocabulary():
    async def case(env, session):
        raw = copy.deepcopy(DOC)
        raw["discipline"] = "lol"
        error = await rejected(session, env.wa, MatchDoc.model_validate(raw))
        assert error.code == "unknown_identity_provider"
        assert {"map", "character", "role"} <= set(error.misses())
        assert error.misses()["map"] == ("ilios",)
        assert error.misses()["character"] == ("ana",)

    run(case)


def test_hints_must_resolve_in_this_workspace_without_disclosing_foreign_ids():
    async def case(env, session):
        good = await validate_document(
            session,
            workspace_id=env.wa,
            doc=doc(hint={"tournament_id": env.ta, "encounter_id": env.ea, "encounter_game_id": env.ga}),
        )
        assert good.doc.hint.encounter_game_id == env.ga
        for hint, field in (
            ({"tournament_id": env.tb}, "tournament_id"),
            ({"encounter_id": env.eb}, "encounter_id"),
            ({"encounter_game_id": env.gb}, "encounter_game_id"),
            ({"tournament_id": env.tl}, "tournament_id"),  # same workspace, other discipline
            ({"tournament_id": 2_000_000_000}, "tournament_id"),
        ):
            error = await rejected(session, env.wa, doc(hint=hint))
            assert paths(error) == [(["hint", field], "hint_unresolved")]
            assert error.misses() == {}
            text = json.dumps([issue.to_dict() for issue in error.issues])
            assert "B cup" not in text and str(list(hint.values())[0]) not in text

    run(case)


def test_hints_that_name_different_series_are_unresolvable():
    async def case(env, session):
        other_tournament = await rejected(session, env.wa, doc(hint={"tournament_id": env.ta2, "encounter_id": env.ea}))
        assert paths(other_tournament) == [(["hint", "encounter_id"], "hint_unresolved")]
        game_elsewhere = await rejected(
            session, env.wa, doc(hint={"encounter_id": env.ea, "encounter_game_id": env.ga2})
        )
        assert paths(game_elsewhere) == [(["hint", "encounter_game_id"], "hint_unresolved")]
        game_tournament = await rejected(
            session, env.wa, doc(hint={"tournament_id": env.ta2, "encounter_game_id": env.ga})
        )
        assert paths(game_tournament) == [(["hint", "encounter_game_id"], "hint_unresolved")]

    run(case)


def test_all_six_kinds_persist_reopen_and_count_while_other_values_are_refused():
    async def case(env, session):
        misses = CatalogAliasMissRepository()
        for kind, name in (
            ("character", "ghost"),
            ("map", "nowhere"),
            ("mode", "no-mode"),
            ("stat", "no_stat"),
            ("event", "no_event"),
            ("role", "player_role:ghost"),
        ):
            await misses.record_miss(session, "overwatch", kind, [name])
        await session.execute(sa.update(models.CatalogAliasMiss).values(resolved_at=sa.func.now()))
        await misses.record_miss(session, "overwatch", "role", ["player_role:ghost"])
        await session.flush()
        rows = {
            (row.kind, row.raw_name): row
            for row in (
                await session.scalars(
                    sa.select(models.CatalogAliasMiss).where(
                        models.CatalogAliasMiss.raw_name.in_(
                            ["ghost", "nowhere", "no-mode", "no_stat", "no_event", "player_role:ghost"]
                        )
                    )
                )
            ).all()
        }
        assert {kind for kind, _ in rows} == {"character", "map", "mode", "stat", "event", "role"}
        await session.refresh(rows[("role", "player_role:ghost")])
        assert (rows[("role", "player_role:ghost")].occurrences, rows[("role", "player_role:ghost")].resolved_at) == (
            2,
            None,
        )
        with pytest.raises(ValueError):
            await misses.record_miss(session, "overwatch", "bogus", ["x"])
        with pytest.raises(IntegrityError):
            async with session.begin_nested():
                await session.execute(
                    sa.text(
                        "INSERT INTO catalog.alias_miss(discipline, kind, raw_name) VALUES ('overwatch','bogus','x')"
                    )
                )

    run(case)


def test_validation_never_flushes_the_callers_pending_state():
    async def case(env, session):
        pending = models.CatalogEntity(
            discipline="overwatch", kind="character", slug="pending-hero", name="Pending hero", attrs={}
        )
        session.add(pending)
        raw = copy.deepcopy(DOC)
        raw["events"][0]["entity"] = "pending-hero"
        error = await rejected(session, env.wa, MatchDoc.model_validate(raw))
        # Had the read autoflushed, the pending hero would exist and resolve.
        assert error.misses() == {"character": ("pending-hero",)}
        assert sa.inspect(pending).pending and pending in session.new
        await validate_document(session, workspace_id=env.wa, doc=doc())
        assert sa.inspect(pending).pending

    run(case)


def test_a_huge_number_of_distinct_codes_is_a_rejection_not_a_driver_error():
    async def case(env, session):
        raw = copy.deepcopy(DOC)
        raw["facts"] = [{"participant": "a", "stat": f"s{i}", "value": 1, "entity": f"e{i}"} for i in range(40_000)]
        error = await rejected(session, env.wa, MatchDoc.model_validate(raw))
        assert error.code == "unresolved_references"
        assert len(error.issues) <= 200 and set(error.misses()) == {"stat", "character"}

    run(case)


def test_handle_grammar_is_enforced_for_canonical_producers_only():
    async def case(env, session):
        raw = copy.deepcopy(DOC)
        raw["participants"][1]["identity"]["id"] = "Player"
        bare = MatchDoc.model_validate(raw)
        for kwargs in ({}, {"producer": "canonical"}):
            error = await rejected_with(session, env.wa, bare, **kwargs)
            assert error.code == "invalid_identity"
            assert paths(error) == [(["participants", 1, "identity", "id"], "invalid_identity")]
            assert error.misses() == {}
        validated = await validate_document(session, workspace_id=env.wa, doc=bare, producer="decoded")
        assert validated.doc.participants[1].identity.id == "Player"
        # other checks still apply to decoded documents
        raw["map"] = "nowhere"
        with pytest.raises(DocumentRejected) as caught:
            await validate_document(session, workspace_id=env.wa, doc=MatchDoc.model_validate(raw), producer="decoded")
        assert caught.value.misses() == {"map": ("nowhere",)}

    run(case)


async def rejected_with(session, workspace_id, document, **kwargs) -> DocumentRejected:
    with pytest.raises(DocumentRejected) as caught:
        await validate_document(session, workspace_id=workspace_id, doc=document, **kwargs)
    return caught.value
