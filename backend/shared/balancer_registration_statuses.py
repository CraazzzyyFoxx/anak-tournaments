from __future__ import annotations

import logging
import re
from typing import Any, Literal, TypedDict

import sqlalchemy as sa
from cashews import cache
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models

logger = logging.getLogger(__name__)

# TTL for the cached status-metas map (see get_status_metas_map). ``shared`` is
# imported by every service and must not read any single service's settings
# (see subscription_wiring's docstring for the same rule), so this is a plain
# constant rather than a config knob -- invalidation is precise anyway (every
# write in status_catalog.py drops the exact workspace key), so the TTL is
# only a safety net for a missed invalidation path, not the primary staleness
# control.
STATUS_METAS_CACHE_TTL_SECONDS = 5 * 60

StatusScope = Literal["registration", "balancer"]
StatusKind = Literal["builtin", "custom"]


class StatusMeta(TypedDict):
    value: str
    scope: StatusScope
    is_builtin: bool
    kind: StatusKind
    is_override: bool
    can_edit: bool
    can_delete: bool
    can_reset: bool
    icon_slug: str | None
    icon_color: str | None
    name: str
    description: str | None
    # Whether a registration currently holding this status counts as part of
    # the balancer pool. Hardcoded for every builtin status (True only for
    # not_in_balancer/excluded) and workspace-configurable for custom
    # balancer-scope statuses (see BalancerRegistrationStatus.excludes_from_balancer).
    # Meaningless for registration-scope statuses -- always False there.
    excludes_from_balancer: bool
    # Whether a registration currently holding this status is blocked from
    # counting as "ready" (Ready lane/tab, run-balance eligibility),
    # independent of excludes_from_balancer. Always False for builtins;
    # workspace-configurable for custom balancer-scope statuses (see
    # BalancerRegistrationStatus.excludes_from_ready).
    excludes_from_ready: bool


BUILTIN_STATUS_META: dict[StatusScope, dict[str, StatusMeta]] = {
    "registration": {
        "pending": {
            "value": "pending",
            "scope": "registration",
            "is_builtin": True,
            "kind": "builtin",
            "is_override": False,
            "can_edit": True,
            "can_delete": False,
            "can_reset": False,
            "icon_slug": "Clock",
            "icon_color": "#f59e0b",
            "name": "Pending",
            "description": "Waiting for moderator review.",
            "excludes_from_balancer": False,
            "excludes_from_ready": False,
        },
        "approved": {
            "value": "approved",
            "scope": "registration",
            "is_builtin": True,
            "kind": "builtin",
            "is_override": False,
            "can_edit": True,
            "can_delete": False,
            "can_reset": False,
            "icon_slug": "CheckCircle2",
            "icon_color": "#10b981",
            "name": "Approved",
            "description": "Registration approved.",
            "excludes_from_balancer": False,
            "excludes_from_ready": False,
        },
        "rejected": {
            "value": "rejected",
            "scope": "registration",
            "is_builtin": True,
            "kind": "builtin",
            "is_override": False,
            "can_edit": True,
            "can_delete": False,
            "can_reset": False,
            "icon_slug": "XCircle",
            "icon_color": "#ef4444",
            "name": "Rejected",
            "description": "Registration rejected.",
            "excludes_from_balancer": False,
            "excludes_from_ready": False,
        },
        "withdrawn": {
            "value": "withdrawn",
            "scope": "registration",
            "is_builtin": True,
            "kind": "builtin",
            "is_override": False,
            "can_edit": True,
            "can_delete": False,
            "can_reset": False,
            "icon_slug": "Undo2",
            "icon_color": "#94a3b8",
            "name": "Withdrawn",
            "description": "Registration withdrawn by participant or admin.",
            "excludes_from_balancer": False,
            "excludes_from_ready": False,
        },
        "banned": {
            "value": "banned",
            "scope": "registration",
            "is_builtin": True,
            "kind": "builtin",
            "is_override": False,
            "can_edit": True,
            "can_delete": False,
            "can_reset": False,
            "icon_slug": "ShieldBan",
            "icon_color": "#ef4444",
            "name": "Banned",
            "description": "Registration blocked.",
            "excludes_from_balancer": False,
            "excludes_from_ready": False,
        },
        "insufficient_data": {
            "value": "insufficient_data",
            "scope": "registration",
            "is_builtin": True,
            "kind": "builtin",
            "is_override": False,
            "can_edit": True,
            "can_delete": False,
            "can_reset": False,
            "icon_slug": "AlertTriangle",
            "icon_color": "#f97316",
            "name": "Incomplete",
            "description": "Registration data is incomplete.",
            "excludes_from_balancer": False,
            "excludes_from_ready": False,
        },
    },
    "balancer": {
        "not_in_balancer": {
            "value": "not_in_balancer",
            "scope": "balancer",
            "is_builtin": True,
            "kind": "builtin",
            "is_override": False,
            "can_edit": True,
            "can_delete": False,
            "can_reset": False,
            "icon_slug": "MinusCircle",
            "icon_color": "#94a3b8",
            "name": "Not Added",
            "description": "Registration has not been added to the balancer pool yet.",
            "excludes_from_balancer": True,
            "excludes_from_ready": False,
        },
        "excluded": {
            "value": "excluded",
            "scope": "balancer",
            "is_builtin": True,
            "kind": "builtin",
            "is_override": False,
            "can_edit": True,
            "can_delete": False,
            "can_reset": False,
            "icon_slug": "ShieldOff",
            "icon_color": "#ef4444",
            "name": "Excluded",
            "description": "Manually removed from the balancer pool after being added.",
            "excludes_from_balancer": True,
            "excludes_from_ready": False,
        },
        "incomplete": {
            "value": "incomplete",
            "scope": "balancer",
            "is_builtin": True,
            "kind": "builtin",
            "is_override": False,
            "can_edit": True,
            "can_delete": False,
            "can_reset": False,
            "icon_slug": "AlertTriangle",
            "icon_color": "#f97316",
            "name": "Incomplete",
            "description": "Registration needs role or rank fixes before balancing.",
            "excludes_from_balancer": False,
            "excludes_from_ready": False,
        },
        "ready": {
            "value": "ready",
            "scope": "balancer",
            "is_builtin": True,
            "kind": "builtin",
            "is_override": False,
            "can_edit": True,
            "can_delete": False,
            "can_reset": False,
            "icon_slug": "CheckCircle2",
            "icon_color": "#10b981",
            "name": "Ready",
            "description": "Registration is ready for the balancer pool.",
            "excludes_from_balancer": False,
            "excludes_from_ready": False,
        },
    },
}

UNKNOWN_STATUS_META: dict[StatusScope, StatusMeta] = {
    "registration": {
        "value": "unknown",
        "scope": "registration",
        "is_builtin": False,
        "kind": "custom",
        "is_override": False,
        "can_edit": False,
        "can_delete": False,
        "can_reset": False,
        "icon_slug": "BadgeHelp",
        "icon_color": "#94a3b8",
        "name": "Unknown",
        "description": "Unknown registration status.",
        "excludes_from_balancer": False,
        "excludes_from_ready": False,
    },
    "balancer": {
        "value": "unknown",
        "scope": "balancer",
        "is_builtin": False,
        "kind": "custom",
        "is_override": False,
        "can_edit": False,
        "can_delete": False,
        "can_reset": False,
        "icon_slug": "BadgeHelp",
        "icon_color": "#94a3b8",
        "name": "Unknown",
        "description": "Unknown balancer status.",
        "excludes_from_balancer": False,
        "excludes_from_ready": False,
    },
}


def get_builtin_status_values(scope: StatusScope) -> set[str]:
    return set(BUILTIN_STATUS_META[scope].keys())


def get_builtin_status_meta(scope: StatusScope, value: str) -> StatusMeta | None:
    return BUILTIN_STATUS_META[scope].get(value)


def is_balancer_status_excluded(value: str) -> bool:
    """Pure Python check for a *builtin* balancer status slug (no DB access).

    Custom statuses aren't decidable this way -- callers with a resolved
    ``StatusMeta`` (already merged with workspace overrides) should read
    ``meta["excludes_from_balancer"]`` directly instead of calling this.
    """
    meta = BUILTIN_STATUS_META["balancer"].get(value)
    return meta["excludes_from_balancer"] if meta is not None else False


def balancer_pool_excluded_clause(
    balancer_status_col: Any,
    workspace_id_col: Any,
) -> Any:
    """SQL predicate: true when the status a registration currently holds
    excludes it from the balancer pool -- a builtin exclusion status
    (``not_in_balancer`` / ``excluded``) or a workspace-configured excluding
    *custom* balancer status. Builtin overrides never carry their own
    exclusion semantics (see ``build_status_meta_from_model``), so only
    ``kind == "custom"`` rows are considered here.

    ``workspace_id_col`` must resolve to the tournament's workspace id in the
    enclosing query (custom statuses are workspace-scoped).
    """
    builtin_excluded_slugs = {
        slug for slug, meta in BUILTIN_STATUS_META["balancer"].items() if meta["excludes_from_balancer"]
    }
    custom_excluded_exists = (
        sa.select(sa.literal(1))
        .where(
            models.BalancerRegistrationStatus.scope == "balancer",
            models.BalancerRegistrationStatus.kind == "custom",
            models.BalancerRegistrationStatus.workspace_id == workspace_id_col,
            models.BalancerRegistrationStatus.slug == balancer_status_col,
            models.BalancerRegistrationStatus.excludes_from_balancer.is_(True),
        )
        .exists()
    )
    return sa.or_(balancer_status_col.in_(builtin_excluded_slugs), custom_excluded_exists)


def balancer_pool_included_clause(balancer_status_col: Any, workspace_id_col: Any) -> Any:
    """Negation of :func:`balancer_pool_excluded_clause` -- reads better at call sites."""
    return sa.not_(balancer_pool_excluded_clause(balancer_status_col, workspace_id_col))


def build_status_meta_from_model(
    status: models.BalancerRegistrationStatus,
) -> StatusMeta:
    is_builtin = status.kind == "builtin"
    is_override = is_builtin and status.workspace_id is not None
    is_custom = status.kind == "custom"
    builtin_meta = BUILTIN_STATUS_META.get(status.scope, {}).get(status.slug, {})
    return {
        "value": status.slug,
        "scope": status.scope,  # type: ignore[typeddict-item]
        "is_builtin": is_builtin,
        "kind": status.kind,  # type: ignore[typeddict-item]
        "is_override": is_override,
        "can_edit": True,
        "can_delete": status.kind == "custom",
        "can_reset": is_override,
        "icon_slug": status.icon_slug,
        "icon_color": status.icon_color,
        "name": status.name,
        "description": status.description,
        # Builtin rows never carry their own exclusion semantics on the raw
        # column -- both are fixed in BUILTIN_STATUS_META and not editable via
        # override (upsert_builtin_override never touches either column).
        # Only a true custom status (`kind == "custom"`) configures them.
        "excludes_from_balancer": bool(getattr(status, "excludes_from_balancer", False))
        if is_custom
        else builtin_meta.get("excludes_from_balancer", False),
        "excludes_from_ready": bool(getattr(status, "excludes_from_ready", False))
        if is_custom
        else builtin_meta.get("excludes_from_ready", False),
    }


def build_unknown_status_meta(scope: StatusScope, value: str) -> StatusMeta:
    return {
        **UNKNOWN_STATUS_META[scope],
        "value": value,
        "name": value.replace("_", " ").strip().title() or UNKNOWN_STATUS_META[scope]["name"],
    }


async def list_workspace_status_rows(
    session: AsyncSession,
    workspace_id: int,
    scope: StatusScope | None = None,
) -> list[models.BalancerRegistrationStatus]:
    query = sa.select(models.BalancerRegistrationStatus).where(
        sa.or_(
            models.BalancerRegistrationStatus.workspace_id == workspace_id,
            models.BalancerRegistrationStatus.workspace_id.is_(None),
        )
    )
    if scope is not None:
        query = query.where(models.BalancerRegistrationStatus.scope == scope)
    query = query.order_by(
        models.BalancerRegistrationStatus.scope.asc(),
        sa.case((models.BalancerRegistrationStatus.workspace_id.is_(None), 0), else_=1).asc(),
        models.BalancerRegistrationStatus.kind.asc(),
        models.BalancerRegistrationStatus.name.asc(),
        models.BalancerRegistrationStatus.id.asc(),
    )
    result = await session.execute(query)
    return list(result.scalars().all())


async def list_custom_statuses(
    session: AsyncSession,
    workspace_id: int,
    scope: StatusScope | None = None,
) -> list[models.BalancerRegistrationStatus]:
    query = sa.select(models.BalancerRegistrationStatus).where(
        models.BalancerRegistrationStatus.workspace_id == workspace_id,
        models.BalancerRegistrationStatus.kind == "custom",
    )
    if scope is not None:
        query = query.where(models.BalancerRegistrationStatus.scope == scope)
    query = query.order_by(
        models.BalancerRegistrationStatus.scope.asc(),
        models.BalancerRegistrationStatus.name.asc(),
        models.BalancerRegistrationStatus.id.asc(),
    )
    result = await session.execute(query)
    return list(result.scalars().all())


async def get_status_meta(
    session: AsyncSession,
    *,
    workspace_id: int,
    scope: StatusScope,
    value: str,
) -> StatusMeta:
    workspace_result = await session.execute(
        sa.select(models.BalancerRegistrationStatus).where(
            models.BalancerRegistrationStatus.workspace_id == workspace_id,
            models.BalancerRegistrationStatus.scope == scope,
            models.BalancerRegistrationStatus.slug == value,
        )
    )
    workspace_status = workspace_result.scalar_one_or_none()
    if workspace_status is not None:
        return build_status_meta_from_model(workspace_status)

    builtin_result = await session.execute(
        sa.select(models.BalancerRegistrationStatus).where(
            models.BalancerRegistrationStatus.workspace_id.is_(None),
            models.BalancerRegistrationStatus.kind == "builtin",
            models.BalancerRegistrationStatus.scope == scope,
            models.BalancerRegistrationStatus.slug == value,
        )
    )
    builtin_status = builtin_result.scalar_one_or_none()
    if builtin_status is not None:
        return build_status_meta_from_model(builtin_status)

    builtin_fallback = get_builtin_status_meta(scope, value)
    if builtin_fallback is not None:
        return builtin_fallback
    return build_unknown_status_meta(scope, value)


def _status_metas_cache_key(workspace_id: int) -> str:
    return f"backend:registration_status_metas:{workspace_id}"


async def get_status_metas_map(
    session: AsyncSession,
    *,
    workspace_id: int,
) -> dict[StatusScope, dict[str, StatusMeta]]:
    """Registration/balancer status metadata for a workspace, merged with builtins.

    Called on every registration mutation and every participants-list rebuild
    (14+ call sites across tournament-service) to attach ``status_meta`` /
    ``balancer_status_meta`` to a serialized registration -- but the underlying
    rows are organizer config that changes on the order of "a few times a
    workspace's whole lifetime", not per registration. Cached per workspace;
    every write in ``status_catalog.py`` calls ``invalidate_status_metas_cache``
    right after its commit, so this is a safety-net TTL, not the primary
    staleness control.

    Deliberately NOT a ``@cache(...)``-decorated function: cashews composes a
    decorator's ``key`` and ``prefix`` as ``f"{prefix}:{key}"`` -- with
    ``prefix="backend:"`` (as every other ``@cache`` call site in this codebase
    uses) that yields a key with a DOUBLE colon (``backend::registration_status_metas:5``),
    which no hand-built ``cache.delete``/``delete_match`` pattern in this
    codebase actually accounts for (confirmed by reproducing it against
    ``user_cache.py``'s patterns -- they silently never match). Plain
    ``cache.get``/``cache.set``/``cache.delete`` sidesteps that footgun
    entirely: the key this function reads is exactly the key
    ``invalidate_status_metas_cache`` deletes, with no hidden composition step
    in between.
    """
    cache_key = _status_metas_cache_key(workspace_id)
    if cache.is_setup():
        try:
            cached = await cache.get(cache_key)
        except Exception as exc:
            logger.debug("Status metas cache get failed for workspace %s: %s", workspace_id, exc)
            cached = None
        if cached is not None:
            return cached

    merged: dict[StatusScope, dict[str, StatusMeta]] = {
        "registration": {},
        "balancer": {},
    }

    rows = await list_workspace_status_rows(session, workspace_id)
    for row in rows:
        if row.workspace_id is None and row.kind != "builtin":
            continue
        merged[row.scope][row.slug] = build_status_meta_from_model(row)  # type: ignore[index]

    for scope, items in BUILTIN_STATUS_META.items():
        for slug, item in items.items():
            merged[scope].setdefault(slug, item)

    if cache.is_setup():
        try:
            await cache.set(cache_key, merged, expire=STATUS_METAS_CACHE_TTL_SECONDS)
        except Exception as exc:
            logger.debug("Status metas cache set failed for workspace %s: %s", workspace_id, exc)

    return merged


async def invalidate_status_metas_cache(workspace_id: int) -> None:
    """Drop the cached status-metas map after a status catalog write.

    Exact key, not a pattern -- the whole map is one entry per workspace.
    """
    if not cache.is_setup():
        return
    try:
        await cache.delete(_status_metas_cache_key(workspace_id))
    except Exception as exc:
        logger.debug("Status metas cache invalidation failed for workspace %s: %s", workspace_id, exc)


def normalize_status_slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return slug[:32]
