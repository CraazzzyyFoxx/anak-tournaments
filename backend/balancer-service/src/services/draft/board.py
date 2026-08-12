"""Read-side helpers: active-session lookup and the board snapshot."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, NamedTuple

import sqlalchemy as sa
from cashews import cache
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.enums import DraftStatus
from shared.models.balancer.draft import DraftPick, DraftPlayer, DraftSession, DraftTeam
from shared.models.platform.realtime import WorkspaceEvent
from shared.models.registration.registration import BalancerRegistrationForm
from shared.services import realtime_topics
from src.schemas.draft import (
    DraftBoardSnapshot,
    DraftPickRead,
    DraftPlayerCustomFieldRead,
    DraftPlayerRead,
    DraftSessionRead,
    DraftTeamRead,
)
from src.services.draft import feasibility, loaders

# Where seeding parks the registration's custom-field ANSWERS (lifecycle.
# _registration_additional_info). Private: the answers a spectator may read are
# chosen per field by the organizer and projected into ``custom_fields`` below,
# so the raw bag is stripped from every public snapshot.
REGISTRATION_CUSTOM_FIELDS_KEY = "registration_custom_fields"

# Registration `notes` stay public: captains read them in the Player Inspector
# while drafting. Only organizer-side metadata is stripped from the snapshot.
_PRIVATE_ADDITIONAL_INFO_KEYS = frozenset({"admin_notes", "audit_reason", REGISTRATION_CUSTOM_FIELDS_KEY})
_ACTIVE = (
    DraftStatus.SETUP.value,
    DraftStatus.READY.value,
    DraftStatus.LIVE.value,
    DraftStatus.PAUSED.value,
)

# Safety-net TTL for the public board cache: the event-id in the key already
# invalidates on every persisted draft event, so the TTL only bounds staleness
# for hypothetical writes that bypass the event log and expires dead keys.
_BOARD_CACHE_TTL = "5s"


def _board_cache_key(session_id: int, last_event_id: int | None) -> str:
    # The "backend:" prefix routes the key to the backend configured by
    # cache.setup() (cashews routes strictly by key prefix).
    return f"backend:balancer:draft_board:{session_id}:{last_event_id or 0}"


async def get_active_session(session: AsyncSession, tournament_id: int) -> DraftSession | None:
    active = await session.scalar(
        sa.select(DraftSession)
        .where(DraftSession.tournament_id == tournament_id, DraftSession.status.in_(_ACTIVE))
        .order_by(DraftSession.id.desc())
        .limit(1)
    )
    if active is not None:
        return active
    # Fall back to the most recent (e.g. COMPLETED) session for read-only views.
    return await session.scalar(
        sa.select(DraftSession)
        .where(DraftSession.tournament_id == tournament_id)
        .order_by(DraftSession.id.desc())
        .limit(1)
    )


def public_additional_info(additional_info: dict | None) -> dict:
    """Remove organizer-only metadata from the public draft snapshot."""

    return {key: value for key, value in (additional_info or {}).items() if key not in _PRIVATE_ADDITIONAL_INFO_KEYS}


class VisibleCustomField(NamedTuple):
    """One registration custom field the organizer opted into the draft."""

    key: str
    label: str
    type: str


async def visible_custom_fields(session: AsyncSession, tournament_id: int) -> list[VisibleCustomField]:
    """The tournament's ``show_in_draft`` custom-field definitions, in form order.

    Resolved on every board build rather than frozen at seed time, so flipping a
    field's visibility (or renaming its label) shows up in a running draft. The
    definitions are read as raw JSON — balancer-service owns no copy of
    tournament-service's ``CustomFieldDefinition`` — so anything malformed is
    skipped instead of breaking the snapshot.
    """
    raw = await session.scalar(
        sa.select(BalancerRegistrationForm.custom_fields_json).where(
            BalancerRegistrationForm.tournament_id == tournament_id
        )
    )
    fields: list[VisibleCustomField] = []
    for definition in raw or []:
        if not isinstance(definition, dict) or definition.get("show_in_draft") is not True:
            continue
        key = definition.get("key")
        if not isinstance(key, str) or not key:
            continue
        label = definition.get("label")
        field_type = definition.get("type")
        fields.append(
            VisibleCustomField(
                key=key,
                label=label if isinstance(label, str) and label else key,
                type=field_type if isinstance(field_type, str) and field_type else "text",
            )
        )
    return fields


def player_custom_fields(
    additional_info: dict[str, Any] | None,
    fields: list[VisibleCustomField],
) -> list[DraftPlayerCustomFieldRead]:
    """Answer + current label for each visible field this player actually filled.

    Unanswered fields are dropped rather than rendered empty: the inspector is a
    pick aid, and a column of dashes is noise there (unlike the admin table).
    """
    answers = (additional_info or {}).get(REGISTRATION_CUSTOM_FIELDS_KEY)
    if not isinstance(answers, dict):
        return []
    return [
        DraftPlayerCustomFieldRead(key=field.key, label=field.label, type=field.type, value=answers[field.key])
        for field in fields
        if answers.get(field.key) not in (None, "")
    ]


async def session_read(session: AsyncSession, draft_session: DraftSession) -> DraftSessionRead:
    """The only way a draft session leaves the service.

    The roster shape is no longer a column on the row, so every reader resolves
    it through the one helper that knows which ids a draft resolves from. Both
    levels are cached, so this is free on the hot board path.
    """
    shape = await feasibility.resolve_shape(session, draft_session)
    return DraftSessionRead.from_session(draft_session, shape=shape)


async def build_board(session: AsyncSession, draft_session: DraftSession) -> DraftBoardSnapshot:
    # The cheap max-event-id read runs on every request and doubles as the
    # cache key: every draft mutation persists a WorkspaceEvent in the same
    # transaction (services.draft.realtime), so new event -> new key -> fresh
    # board, and an unchanged id can safely serve the cached snapshot.
    topic = realtime_topics.draft(draft_session.tournament_id)
    last_event_id = await session.scalar(sa.select(sa.func.max(WorkspaceEvent.id)).where(WorkspaceEvent.topic == topic))
    cache_key = _board_cache_key(draft_session.id, last_event_id)
    if cache.is_setup():
        try:
            cached = await cache.get(cache_key)
        except Exception:  # noqa: BLE001 — cache is best-effort
            cached = None
        if cached is not None:
            # server_time drives client clock sync; never serve a stale one.
            return cached.model_copy(update={"server_time": datetime.now(UTC)})

    # DraftTeamRead reads captain_user_id, DraftPickRead reads picked_by_user_id,
    # DraftPlayerRead reads user_id/secondary_roles_json/role_ranks/role_top_heroes
    # — eager-load the relationships those compat properties resolve through.
    teams = (
        await session.scalars(
            sa.select(DraftTeam)
            .where(DraftTeam.session_id == draft_session.id)
            .order_by(DraftTeam.draft_position.asc())
            .options(*loaders.team_options())
        )
    ).all()
    picks = (
        await session.scalars(
            sa.select(DraftPick)
            .where(DraftPick.session_id == draft_session.id)
            .order_by(DraftPick.overall_no.asc())
            .options(*loaders.pick_options())
        )
    ).all()
    players = (
        await session.scalars(
            sa.select(DraftPlayer)
            .where(DraftPlayer.session_id == draft_session.id)
            .order_by(DraftPlayer.id.asc())
            .options(*loaders.player_options())
        )
    ).all()

    # Skipped entirely for pools that carry no registration answers (manual or
    # balance-sourced seeds), so those drafts pay nothing for the feature.
    custom_field_defs = (
        await visible_custom_fields(session, draft_session.tournament_id)
        if any(REGISTRATION_CUSTOM_FIELDS_KEY in (p.additional_info or {}) for p in players)
        else []
    )

    # The current pick always belongs to this session, so it is among `picks`
    # (loaded with pick_options above) — no extra fetch needed.
    current = (
        next((p for p in picks if p.id == draft_session.current_pick_id), None)
        if draft_session.current_pick_id
        else None
    )
    snapshot = DraftBoardSnapshot(
        session=await session_read(session, draft_session),
        teams=[DraftTeamRead.model_validate(t) for t in teams],
        picks=[DraftPickRead.model_validate(p) for p in picks],
        players=[
            DraftPlayerRead.model_validate(p).model_copy(
                update={
                    "additional_info": public_additional_info(p.additional_info),
                    "custom_fields": player_custom_fields(p.additional_info, custom_field_defs),
                }
            )
            for p in players
        ],
        current_pick=DraftPickRead.model_validate(current) if current else None,
        server_time=datetime.now(UTC),
        last_event_id=last_event_id,
    )
    if cache.is_setup():
        try:
            await cache.set(cache_key, snapshot, expire=_BOARD_CACHE_TTL)
        except Exception:  # noqa: BLE001 — cache is best-effort
            pass
    return snapshot
