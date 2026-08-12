"""Platform-audit rows for the registration admin surface.

Registrations sit outside the shared CRUD dispatcher -- ``rpc/registration_admin.py``
drives bespoke lifecycle services instead of ``EntityConfig`` hooks -- so nothing
was appending to ``audit_log`` for them. However many times an admin edited a
registration, the feed and any per-entity trail came back empty. This module is
the one place those handlers stage a row from, so ``entity_type``/``action`` stay
spelled the same way across every call site.

Call order follows ``shared.rpc.crud``'s service-backed branches: the lifecycle
services own their ``commit()``, so a row is staged BEFORE the service runs and
rides that same transaction -- a rejected edit rolls back and leaves no trail of
having happened. The price is that ``after`` carries the *requested* values, not
the stored ones, wherever the service normalises input.

``profile_changes`` narrows the edit row to fields whose requested value actually
differs from the stored one: the admin editor round-trips its whole form, so
recording everything it submitted would make a no-op save indistinguishable from
a real change.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared.services.audit import record_audit
from src import models
from src.services.registration.utils import normalize_battle_tag

__all__ = ("ENTITY", "label", "profile_changes", "role_snapshot", "stage")

ENTITY = "registration"

# Request field -> model attribute for everything the admin profile editor can
# change. ``roles`` is not here: it is a list of rows, handled below.
_PROFILE_FIELDS: dict[str, str] = {
    "display_name": "display_name",
    "battle_tag": "battle_tag",
    "smurf_tags_json": "smurf_tags_json",
    "discord_nick": "discord_nick",
    "twitch_nick": "twitch_nick",
    "boosty_nick": "boosty_nick",
    "stream_pov": "stream_pov",
    "notes": "notes",
    "admin_notes": "admin_notes",
    "custom_fields_json": "custom_fields_json",
    "status": "status",
    "balancer_status": "balancer_status",
    "exclude_reason": "exclude_reason",
}

# Fields the service persists as NULL when handed an empty container, so an
# empty request value and a stored NULL are the same state -- not a change.
_EMPTY_IS_NULL = frozenset({"smurf_tags_json", "custom_fields_json"})


def label(registration: models.BalancerRegistration) -> str | None:
    """Snapshot name for the row, so the feed stays readable after a delete."""
    return registration.display_name or registration.battle_tag


def _role_key(value: Any) -> str:
    """``BalancerRole`` on the request side, a plain string on the model side."""
    return str(getattr(value, "value", value))


def role_snapshot(registration: models.BalancerRegistration) -> list[dict[str, Any]]:
    """The role fields the balancer actually reads, ordered so two images compare."""
    return sorted(
        (
            {
                "role": _role_key(role.role),
                "subrole": role.subrole,
                "rank_value": role.rank_value,
                "is_primary": role.is_primary,
                "is_active": role.is_active,
            }
            for role in registration.roles
        ),
        key=lambda entry: entry["role"],
    )


def _requested_roles(roles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        (
            {
                "role": _role_key(role.get("role")),
                "subrole": role.get("subrole"),
                "rank_value": role.get("rank_value"),
                "is_primary": bool(role.get("is_primary", False)),
                "is_active": bool(role.get("is_active", True)),
            }
            for role in roles
        ),
        key=lambda entry: entry["role"],
    )


def _requested_value(field: str, value: Any) -> Any:
    if field == "battle_tag":
        # Compared against the stored, already-normalised tag: without this a
        # resave of the same tag in different casing reads as an edit.
        return normalize_battle_tag(value)
    if field in _EMPTY_IS_NULL and not value:
        return None
    return value


def profile_changes(
    registration: models.BalancerRegistration,
    requested: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Before/after images narrowed to the fields this request really changes.

    ``requested`` is the update request dumped to a dict; ``None`` means "left
    alone" on every field of it (see ``BalancerRegistrationUpdateRequest``), so
    those are skipped rather than recorded as clears.
    """
    before: dict[str, Any] = {}
    after: dict[str, Any] = {}

    for field, attr in _PROFILE_FIELDS.items():
        new = requested.get(field)
        if new is None:
            continue
        new = _requested_value(field, new)
        old = getattr(registration, attr)
        if new == old:
            continue
        before[field] = old
        after[field] = new

    roles = requested.get("roles")
    if roles is not None:
        old_roles = role_snapshot(registration)
        new_roles = _requested_roles(roles)
        if old_roles != new_roles:
            before["roles"] = old_roles
            after["roles"] = new_roles

    return before, after


async def stage(
    session: AsyncSession,
    *,
    action: str,
    actor: models.AuthUser,
    workspace_id: int,
    data: dict[str, Any],
    entity_id: int | None,
    entity_type: str = ENTITY,
    entity_label: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> None:
    """Stage one audit row for a registration write.

    ``workspace_id`` is the value ``ensure_workspace_permission`` was checked
    against, passed down rather than resolved again, so the journal's scope is
    the authorisation scope by construction.

    Bulk operations pass ``entity_type="tournament"`` with the tournament id:
    they name one request over many rows, and fanning a row out per registration
    would bury every single-row edit in the same feed.
    """
    await record_audit(
        session,
        action=action,
        source="admin",
        actor=actor,
        # Snapshotted for the same reason as in the CRUD engine: nothing points
        # at auth.user, so a reader's join resolves nothing once it is deleted.
        actor_label=actor.username,
        workspace_id=workspace_id,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_label=entity_label,
        before=before,
        after=after,
        ip_address=data.get("ip_address"),
        user_agent=data.get("user_agent"),
    )
