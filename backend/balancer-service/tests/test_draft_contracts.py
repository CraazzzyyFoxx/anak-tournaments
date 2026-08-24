from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"

for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

from shared.core.enums import (  # noqa: E402
    DraftAutopickStrategy,
    DraftFormat,
    DraftPickStatus,
    DraftPlayerStatus,
    DraftPoolSource,
    DraftStatus,
    HeroClass,
)
from shared.domain.roster_shape import DEFAULT_ROSTER_SHAPE  # noqa: E402
from shared.models.balancer.draft import DraftPick, DraftPlayer, DraftSession  # noqa: E402
from src import (  # noqa: E402
    openapi_docs,
    openapi_schemas,
    schemas,  # noqa: E402
)
from src.domain.draft import rules  # noqa: E402
from src.rpc import draft as draft_rpc  # noqa: E402
from src.services.draft import board, lifecycle  # noqa: E402
from src.services.draft.feasibility import feasibility_service  # noqa: E402


class _FakeBroker:
    def __init__(self) -> None:
        self.subjects: set[str] = set()

    def subscriber(self, subject: str):
        self.subjects.add(subject)

        def decorator(function):
            return function

        return decorator


class _FakeLogger:
    def warning(self, *args, **kwargs) -> None:
        return None


def test_feasibility_and_pick_options_have_typed_public_contracts() -> None:
    feasibility = schemas.DraftFeasibilityResponse(
        is_feasible=False,
        total_open_slots=2,
        matched_slots=1,
        unmatched_slots=[{"team_id": 10, "slot_code": "support", "ordinal": 0}],
        slot_deficits=[{"slot_code": "support", "unmatched_slots": 1, "eligible_players": 0}],
        blocking_player_ids=[],
        reason_code="role_shortage",
    )
    options = schemas.DraftPickOptionsResponse(
        pick_id=30,
        pick_version=4,
        draft_team_id=10,
        options=[
            {
                "player_id": 20,
                "role": "support",
                "is_safe": False,
                "reason_code": "role_shortage",
                "unmatched_slots": feasibility.unmatched_slots,
                "blocking_player_ids": [],
                "suggestion_score": None,
            }
        ],
    )

    assert feasibility.unmatched_slots[0].slot_code == "support"
    assert options.pick_version == 4
    assert options.options[0].is_safe is False


def test_role_edit_contract_requires_reason_and_explicit_missing_rank_confirmation() -> None:
    with pytest.raises(ValidationError):
        schemas.DraftRoleEditRequest(
            role="support",
            rank_value=None,
            rank_absence_confirmed=False,
            reason="  ",
            expected_version=2,
        )

    request = schemas.DraftRoleEditRequest(
        role="support",
        rank_value=None,
        rank_absence_confirmed=True,
        reason="Role was missing from registration",
        expected_version=2,
        preview_only=True,
    )
    assert request.role == "support"
    assert request.preview_only is True


def test_seed_contract_supports_dry_run_and_optimistic_version() -> None:
    request = schemas.DraftSeedRequest(preview_only=True, expected_version=7)

    assert request.preview_only is True
    assert request.expected_version == 7

    diff = schemas.DraftSeedDiff(
        teams_before=3,
        teams_after=4,
        players_before=15,
        players_after=20,
        picks_before=12,
        picks_after=16,
        session_version_before=7,
        session_version_after=8,
    )
    assert diff.session_version_after == 8


def test_public_player_metadata_keeps_notes_strips_organizer_keys() -> None:
    public = board.public_additional_info(
        {
            "notes": "registration note shown to captains",
            "admin_notes": "organizer only",
            "audit_reason": "private reason",
            "pronouns": "they/them",
        }
    )

    assert public == {
        "notes": "registration note shown to captains",
        "pronouns": "they/them",
    }


def test_pick_event_payload_contains_resolved_role_rank_and_version() -> None:
    draft = DraftSession(id=1, tournament_id=2, workspace_id=3, current_pick_id=31)
    pick = DraftPick(
        id=30,
        session_id=1,
        overall_no=5,
        round_no=2,
        pick_in_round=1,
        draft_team_id=10,
        picked_player_id=20,
        target_role=HeroClass.support.slot_code,
        target_rank_value=2875,
        status=DraftPickStatus.COMPLETED.value,
        version=4,
    )

    payload = draft_rpc._pick_event_payload(draft, pick)

    assert payload["target_role"] == "support"
    assert payload["target_rank_value"] == 2875
    assert payload["pick_version"] == 4


def test_role_edit_result_serializes_before_and_after_feasibility() -> None:
    response = schemas.DraftRoleEditResponse(
        player_id=20,
        role="support",
        player_version=3,
        committed=False,
        before={
            "is_feasible": False,
            "total_open_slots": 1,
            "matched_slots": 0,
            "unmatched_slots": [{"team_id": 10, "slot_code": "support", "ordinal": 0}],
            "slot_deficits": [{"slot_code": "support", "unmatched_slots": 1, "eligible_players": 0}],
            "blocking_player_ids": [],
            "reason_code": "role_shortage",
        },
        after={
            "is_feasible": True,
            "total_open_slots": 1,
            "matched_slots": 1,
            "unmatched_slots": [],
            "slot_deficits": [],
            "blocking_player_ids": [],
            "reason_code": None,
        },
    )

    assert response.before.is_feasible is False
    assert response.after.is_feasible is True


def test_rpc_registers_feasibility_options_and_role_edit_subjects() -> None:
    broker = _FakeBroker()

    draft_rpc.register(broker, _FakeLogger())

    assert {
        "rpc.balancer.draft.feasibility",
        "rpc.balancer.draft.pick_options",
        "rpc.balancer.draft.player_role_edit",
        "rpc.balancer.draft.session_list",
        "rpc.balancer.draft.session_delete",
    } <= broker.subjects


def test_player_updated_event_does_not_expose_private_reason() -> None:
    payload = draft_rpc._player_updated_payload(
        session_id=1,
        player_id=20,
        role=HeroClass.support,
        player_version=3,
        is_feasible=True,
    )

    assert payload == {
        "session_id": 1,
        "player_id": 20,
        "role": "support",
        "player_version": 3,
        "is_feasible": True,
    }


def test_admin_override_builds_private_audit_event() -> None:
    event = draft_rpc._override_audit_event(
        session_id=7,
        pick_id=9,
        actor_auth_user_id=11,
        reason=" Captain disconnected ",
        before={"player_id": None, "role": None},
        after={"player_id": 22, "role": "support"},
    )

    assert event.session_id == 7
    assert event.entity_id == 9
    assert event.actor_auth_user_id == 11
    assert event.reason == "Captain disconnected"
    assert event.before_json == {"player_id": None, "role": None}
    assert event.after_json == {"player_id": 22, "role": "support"}


def test_openapi_maps_all_new_draft_contracts() -> None:
    expected = {
        "rpc.balancer.draft.feasibility": (None, schemas.DraftFeasibilityResponse),
        "rpc.balancer.draft.pick_options": (None, schemas.DraftPickOptionsResponse),
        "rpc.balancer.draft.player_role_edit": (schemas.DraftRoleEditRequest, schemas.DraftRoleEditResponse),
    }

    for subject, (request, response) in expected.items():
        operation = openapi_schemas.OPERATIONS[subject]
        assert operation.request is request
        assert operation.response is response
        assert subject in openapi_docs.DOCS

    assert openapi_schemas.OPERATIONS["rpc.balancer.draft.seed"].response is schemas.DraftSeedResponse
    # session_delete answers 204 with no body, so it is documented but carries no
    # response model (see openapi_schemas' module docstring).
    assert "rpc.balancer.draft.session_delete" in openapi_docs.DOCS
    assert "rpc.balancer.draft.session_delete" not in openapi_schemas.OPERATIONS
    session_list = openapi_schemas.OPERATIONS["rpc.balancer.draft.session_list"]
    assert session_list.response is schemas.DraftSessionRead
    assert session_list.response_array is True
    assert "rpc.balancer.draft.session_list" in openapi_docs.DOCS


@pytest.mark.parametrize("status", [DraftStatus.LIVE, DraftStatus.PAUSED])
def test_delete_session_refuses_an_in_flight_draft(status: DraftStatus) -> None:
    # The guard fires before the session is ever touched, so no DB is needed —
    # passing None also proves nothing is written on the rejected path.
    draft = DraftSession(id=1, tournament_id=2, workspace_id=3, status=status.value)

    with pytest.raises(Exception) as exc_info:
        asyncio.run(lifecycle.lifecycle_service.delete_session(None, draft))  # type: ignore[arg-type]

    assert exc_info.value.detail[0]["code"] == "draft_in_flight"


@pytest.mark.parametrize(
    "status",
    [DraftStatus.SETUP, DraftStatus.READY, DraftStatus.COMPLETED, DraftStatus.CANCELLED],
)
def test_delete_session_accepts_every_status_that_is_not_in_flight(status: DraftStatus) -> None:
    assert status.value in rules.DELETABLE_STATUSES


def test_seed_version_guard_rejects_stale_preview_and_bumps_on_materialization() -> None:
    draft = DraftSession(id=1, tournament_id=2, workspace_id=3, version=7)

    rules.validate_seed_version(draft, expected_version=7)
    rules.bump_seed_version(draft)

    assert draft.version == 8
    with pytest.raises(Exception) as exc_info:
        rules.validate_seed_version(draft, expected_version=7)
    assert exc_info.value.detail[0]["code"] == "draft_session_stale"


def test_seed_diff_builder_reports_before_and_after_counts() -> None:
    diff = draft_rpc._seed_diff(
        before=(3, 15, 12),
        after=(4, 20, 16),
        version_before=7,
        version_after=8,
    )

    assert diff == schemas.DraftSeedDiff(
        teams_before=3,
        teams_after=4,
        players_before=15,
        players_after=20,
        picks_before=12,
        picks_after=16,
        session_version_before=7,
        session_version_after=8,
    )


class _FakeRegistration:
    """The two registration attributes draft seeding reads for its metadata bag."""

    def __init__(self, *, notes: str | None = None, custom_fields_json: dict | None = None) -> None:
        self.notes = notes
        self.custom_fields_json = custom_fields_json


class _FormSession:
    """Answers the single ``custom_fields_json`` scalar read the board makes."""

    def __init__(self, custom_fields_json: list | None) -> None:
        self._custom_fields_json = custom_fields_json

    async def scalar(self, _statement) -> list | None:
        return self._custom_fields_json


def test_seeded_metadata_keeps_registration_answers_out_of_the_public_snapshot() -> None:
    info = rules.registration_additional_info(
        _FakeRegistration(notes="plays support", custom_fields_json={"vk": "vk.com/p", "age": 21})
    )

    assert info == {
        "notes": "plays support",
        board.REGISTRATION_CUSTOM_FIELDS_KEY: {"vk": "vk.com/p", "age": 21},
    }
    # Spectators see the projection below, never the raw answer bag.
    assert board.public_additional_info(info) == {"notes": "plays support"}


def test_visible_custom_fields_takes_only_flagged_definitions_in_form_order() -> None:
    session = _FormSession(
        [
            {"key": "vk", "label": "VK profile", "type": "url", "show_in_draft": True},
            {"key": "age", "label": "Age", "type": "number"},
            {"key": "rules", "label": "", "show_in_draft": True},
            {"label": "keyless", "show_in_draft": True},
            "not a definition",
        ]
    )

    fields = asyncio.run(board.board_service.visible_custom_fields(session, 7))  # type: ignore[arg-type]

    assert fields == [
        board.VisibleCustomField(key="vk", label="VK profile", type="url"),
        # Missing label falls back to the key; missing type to the form default.
        board.VisibleCustomField(key="rules", label="rules", type="text"),
    ]


def test_player_custom_fields_renders_answers_and_drops_the_unanswered() -> None:
    fields = [
        board.VisibleCustomField(key="vk", label="VK profile", type="url"),
        board.VisibleCustomField(key="rules", label="Rules read", type="checkbox"),
        board.VisibleCustomField(key="bio", label="Bio", type="text"),
    ]

    projected = board.player_custom_fields(
        {board.REGISTRATION_CUSTOM_FIELDS_KEY: {"vk": "vk.com/p", "rules": False, "bio": ""}},
        fields,
    )

    # "rules": False is an ANSWER (a rendered "No"), unlike the blank bio.
    assert [(f.key, f.label, f.type, f.value) for f in projected] == [
        ("vk", "VK profile", "url", "vk.com/p"),
        ("rules", "Rules read", "checkbox", False),
    ]
    # A manually seeded player carries no registration bag at all.
    assert board.player_custom_fields({"notes": "manual entry"}, fields) == []


class _ScalarsResult:
    def __init__(self, rows: list) -> None:
        self._rows = rows

    def all(self) -> list:
        return self._rows


class _ExecuteResult:
    def __init__(self, rows: list) -> None:
        self._rows = rows

    def unique(self) -> _ExecuteResult:
        return self

    def scalars(self) -> _ScalarsResult:
        return _ScalarsResult(self._rows)


class _BoardSession:
    """Answers ``build_board``'s reads in call order, with no DB behind them.

    ``scalar``: max(WorkspaceEvent.id), then the form's ``custom_fields_json``.
    ``execute``: teams, picks, players (repository ``list_by_session`` reads).
    """

    def __init__(self, *, custom_fields_json: list, players: list) -> None:
        self._scalar = [None, custom_fields_json]
        self._results = [[], [], players]

    async def scalar(self, _statement):
        return self._scalar.pop(0)

    async def execute(self, _statement) -> _ExecuteResult:
        return _ExecuteResult(self._results.pop(0))


def test_board_projects_flagged_answers_and_never_ships_the_rest(monkeypatch) -> None:
    async def _shape(*_args, **_kwargs):
        return DEFAULT_ROSTER_SHAPE

    monkeypatch.setattr(feasibility_service, "resolve_shape", _shape)
    draft = DraftSession(
        id=1,
        tournament_id=2,
        workspace_id=3,
        status=DraftStatus.LIVE.value,
        blocked_reason=None,
        format=DraftFormat.SNAKE.value,
        rounds=4,
        pick_time_seconds=45,
        current_pick_id=None,
        pool_source=DraftPoolSource.MANUAL.value,
        source_balance_id=None,
        autopick_strategy=DraftAutopickStrategy.BEST_FIT.value,
        allow_admin_override=True,
        exported_at=None,
        export_status=None,
        settings_json={},
        version=1,
    )
    player = DraftPlayer(
        id=20,
        session_id=1,
        battle_tag="Ana#1",
        primary_role=HeroClass.support.slot_code,
        sub_role=None,
        is_flex=False,
        division_number=None,
        rank_value=3000,
        status=DraftPlayerStatus.AVAILABLE.value,
        is_captain=False,
        drafted_by_team_id=None,
        additional_info={
            "notes": "prefers Ana",
            board.REGISTRATION_CUSTOM_FIELDS_KEY: {"vk": "vk.com/ana", "phone": "+70000000000"},
        },
        version=1,
    )
    session = _BoardSession(
        custom_fields_json=[
            {"key": "vk", "label": "VK profile", "type": "url", "show_in_draft": True},
            {"key": "phone", "label": "Phone", "type": "text"},
        ],
        players=[player],
    )

    snapshot = asyncio.run(board.board_service.build_board(session, draft))  # type: ignore[arg-type]

    read = snapshot.players[0]
    assert [(f.key, f.label, f.type, f.value) for f in read.custom_fields] == [
        ("vk", "VK profile", "url", "vk.com/ana")
    ]
    assert read.additional_info == {"notes": "prefers Ana"}
    # The un-flagged answer leaves the service in NO shape — the whole point of
    # the opt-in is that the public board carries only what the organizer chose.
    assert "phone" not in snapshot.model_dump_json()
