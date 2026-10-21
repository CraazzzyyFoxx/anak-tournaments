"""Shared helpers for the registration admin subsystems.

Cross-cutting building blocks used by more than one of the admin modules
(``sheet_parsing`` / ``sheet_sync`` / ``rank_autofill`` / ``lifecycle`` /
``export``): tournament/form lookups, division-grid resolution, role
replacement and the balancer-status verdict.

A role's rank and playability come from :mod:`shared.services.roster`, and the
``ready``/``incomplete`` verdict is a straight read of
:attr:`~shared.domain.roster.PlayerRoster.is_ranked_complete`. Only the WRITE
side (``apply_all_roles`` / ``replace_registration_roles``) lives here; the
engine never touches it.
"""

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.balancer_registration_statuses import get_builtin_status_values, is_balancer_status_excluded
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.division_grid import DivisionGrid, load_runtime_grid
from shared.domain.roster import FlexRoleMode, PlayerRoster
from shared.hero_catalog import DEFAULT_MAX_TOP_HEROES, HeroCatalog, build_hero_entries
from shared.repository import RegistrationFormRepository, TournamentRepository
from shared.schemas.role import RoleRef
from shared.services.division_grid.access import (
    get_effective_division_grid_version,
    runtime_fallback_grid,
)
from shared.services.ontology import resolve_form_role
from shared.services.realtime import Resource, Scope, emit
from shared.services.roster import roster_engine
from src.domain.registration.utils import DEFAULT_SORT_PRIORITY_SENTINEL
from src.services.registration.form_service import form_service
from src.services.registration.roles_rules import role_value

VALID_REGISTRATION_STATUSES = get_builtin_status_values("registration")
VALID_BALANCER_STATUSES = get_builtin_status_values("balancer")

# The only two balancer statuses the system derives from role/rank
# completeness -- every other status (not_in_balancer, excluded, any custom
# slug) is exclusively admin-managed and must never be touched by
# `sync_included_balancer_status`.
AUTO_MANAGED_BALANCER_STATUSES = frozenset({"incomplete", "ready"})
NOT_ADDED_BALANCER_STATUS = "not_in_balancer"
EXCLUDED_BALANCER_STATUS = "excluded"


def _role_row(
    catalog_roles: Mapping[str, models.CatalogRole], role: str | RoleRef | dict, subrole: str | None
) -> models.BalancerRegistrationRole | None:
    """Form pairs use the shared resolver; API refs identify a scoped leaf, never trust parent."""
    if isinstance(role, (RoleRef, dict)):
        ref = role if isinstance(role, RoleRef) else RoleRef.model_validate(role)
        leaf = catalog_roles.get(ref.role)
        dimension = next(iter(catalog_roles.values())).dimension.code if catalog_roles else None
        if ref.dimension != dimension:
            raise HTTPException(status_code=422, detail=f"role_dimension_mismatch: expected {dimension!r}")
        if leaf is None:
            raise HTTPException(status_code=422, detail=f"unknown_role: {ref.role!r}")
    else:
        try:
            leaf = resolve_form_role(catalog_roles, role, subrole)
        except HTTPException:
            # The form validator reports bad suffixes. Import/build paths preserve the valid top-level role.
            try:
                leaf = resolve_form_role(catalog_roles, role, None)
            except HTTPException:
                return None
    if leaf is None:
        return None
    return models.BalancerRegistrationRole(catalog_role=leaf, dimension_id=leaf.dimension_id)


def apply_all_roles(
    entries: list[models.BalancerRegistrationRole],
    *,
    catalog_roles: Mapping[str, models.CatalogRole],
    role_codes: Sequence[str],
    force_primary: bool,
) -> list[models.BalancerRegistrationRole]:
    """Backfill the discipline's role set, optionally forcing every role primary.

    Both non-optional modes need the SET normalized, whichever path produced the
    entries — public form, admin panel, API key or Google Sheets sync.
    Normalizing here rather than rejecting an incomplete payload is what makes
    that hold for a stale client and for the sheet sync, neither of which knows
    about the mode.

    ``force_primary`` separates the two modes: ``forced`` marks every role
    primary (yielding ``PlayerRoster.is_full_flex``), ``all_roles`` leaves the registrant's
    own choice alone and backfills the missing roles as non-primary. It cannot
    invent that choice, so a payload naming no priority stays invalid — see
    ``roles_rules.validate_roles``.

    Only the role SET and (under ``force_primary``) ``is_primary`` are touched.
    ``is_active`` and ``rank_value`` stay exactly as the calling path set them:
    the max-rank policy is derived at read time, because the public form submits
    no ranks at all and ``rank_autofill`` would overwrite anything flattened
    into the rows.
    """
    present = {entry.role for entry in entries}
    result = list(entries)
    result.extend(
        models.BalancerRegistrationRole(
            catalog_role=catalog_roles[role_code], dimension_id=catalog_roles[role_code].dimension_id
        )
        for role_code in role_codes
        if role_code not in present
    )
    for priority, entry in enumerate(result):
        if force_primary:
            entry.is_primary = True
        entry.priority = priority
    return result


def build_registration_roles(
    roles: list[Any] | None,
    *,
    catalog_roles: Mapping[str, models.CatalogRole],
    role_codes: Sequence[str],
    hero_catalog: HeroCatalog | None = None,
    max_heroes: int | None = None,
    mode: FlexRoleMode = "optional",
) -> list[models.BalancerRegistrationRole]:
    """Build normalized role entries from a submitted ``roles`` answer.

    Filters to the discipline's top-level roles, de-duplicates, resolves form
    sub-role slugs, and assigns sequential priority. Detached rows:
    the caller decides whether they are new or merged over existing ones
    (:meth:`RegistrationAnswerService.apply` does the latter, so an organizer's
    ``rank_value`` survives a player editing their roles).

    When ``hero_catalog`` is provided (the top-characters ask is enabled), the ordered
    ``top_heroes`` slugs of each answer row -- the persisted form-answer spelling -- are attached
    as ``registration_role_entity`` rows.
    """
    resolved_max = max_heroes if max_heroes and max_heroes > 0 else DEFAULT_MAX_TOP_HEROES
    entries: list[models.BalancerRegistrationRole] = []
    seen: set[str] = set()
    for role in roles or []:
        entry = _role_row(catalog_roles, role_value(role, "role"), role_value(role, "subrole"))
        if entry is None or entry.role not in role_codes or entry.role in seen:
            continue
        seen.add(entry.role)
        entry.is_primary = bool(role_value(role, "is_primary", False))
        entry.priority = len(entries)
        if hero_catalog is not None:
            entry.hero_entries = build_hero_entries(
                role_value(role, "top_heroes"),
                hero_catalog=hero_catalog,
                max_heroes=resolved_max,
            )
        entries.append(entry)
    if mode in ("all_roles", "forced"):
        entries = apply_all_roles(
            entries, catalog_roles=catalog_roles, role_codes=role_codes, force_primary=mode == "forced"
        )
    return entries


def replace_registration_roles(
    registration: models.BalancerRegistration,
    roles: list[dict[str, Any]],
    *,
    catalog_roles: Mapping[str, models.CatalogRole],
    hero_catalog: HeroCatalog | None = None,
    max_heroes: int | None = None,
    mode: FlexRoleMode = "optional",
) -> None:
    role_codes = tuple(
        code for code, row in catalog_roles.items() if row.parent_role_id is None and row.workspace_id is None
    )
    existing_by_role = {existing.role: existing for existing in registration.roles}
    next_roles: list[models.BalancerRegistrationRole] = []
    seen_roles: set[str] = set()

    for index, role in enumerate(sorted(roles, key=lambda item: item.get("priority", DEFAULT_SORT_PRIORITY_SENTINEL))):
        entry = _role_row(catalog_roles, role.get("role"), role.get("subrole"))
        if entry is None or entry.role in seen_roles:
            continue
        seen_roles.add(entry.role)
        registration_role = existing_by_role.pop(entry.role, None)
        if registration_role is None:
            registration_role = entry
        else:
            registration_role.catalog_role = entry.catalog_role
            registration_role.dimension_id = entry.dimension_id
        registration_role.is_primary = bool(role.get("is_primary", index == 0))
        registration_role.priority = index
        registration_role.rank_value = role.get("rank_value")
        registration_role.is_active = bool(role.get("is_active", role.get("rank_value") is not None))

        if hero_catalog is not None:
            top_characters = role.get("top_characters")
            if top_characters is not None:
                registration_role.hero_entries = build_hero_entries(
                    top_characters,
                    hero_catalog=hero_catalog,
                    max_heroes=max_heroes or DEFAULT_MAX_TOP_HEROES,
                )

        next_roles.append(registration_role)

    if mode in ("all_roles", "forced"):
        next_roles = apply_all_roles(
            next_roles, catalog_roles=catalog_roles, role_codes=role_codes, force_primary=mode == "forced"
        )

    registration.roles[:] = next_roles


async def resolve_roster(
    session: AsyncSession,
    registration: models.BalancerRegistration | Any,
) -> PlayerRoster | None:
    """The resolved roster of ONE registration, straight from the engine.

    Write paths mutate roles and then want the ``ready``/``incomplete`` verdict.
    They hold a row loaded for their own reasons, which need not carry
    ``registration_load_options()``, so the roster is re-read through the engine's
    own query instead: autoflush publishes the pending role writes first, which
    is also what makes the verdict reflect the edit that just happened.
    """
    rosters = await roster_engine.for_tournament(
        session,
        registration.tournament_id,
        registration_ids=[registration.id],
        include_deleted=True,
    )
    return rosters.get(registration.id)


def included_balancer_status(roster: PlayerRoster | None) -> str:
    """The pool verdict: ``ready`` once every declared role carries a rank.

    No roster at all (a registration the engine did not resolve) reads as
    ``incomplete``.
    """
    return "ready" if roster is not None and roster.is_ranked_complete else "incomplete"


def sync_included_balancer_status(
    registration: models.BalancerRegistration | Any,
    roster: PlayerRoster | None,
) -> None:
    """Recompute `ready`/`incomplete` from the resolved roster -- the only two
    balancer statuses a role edit is allowed to change. `not_in_balancer`,
    `excluded` and any custom status are exclusively admin-managed
    (`set_balancer_status` rejects ready/incomplete), so a role-driven resync
    never overrides them.
    """
    current_balancer_status = getattr(registration, "balancer_status", None)
    if (
        getattr(registration, "status", None) == "approved"
        and current_balancer_status in AUTO_MANAGED_BALANCER_STATUSES
    ):
        registration.balancer_status = included_balancer_status(roster)


def is_included_in_balancer(
    registration: models.BalancerRegistration | Any,
    status_meta_map: dict[str, dict[str, Any]] | None = None,
) -> bool:
    """Whether `registration` currently counts as part of the balancer pool.

    Single source of truth: the *current status's* `excludes_from_balancer`
    flag -- true for the builtin `not_in_balancer`/`excluded` statuses, false
    for `ready`/`incomplete`, and workspace-configurable for a custom status.
    Pass the resolved `status_meta_map` (see `get_status_metas_map`) when one
    is already in hand -- callers without it (no custom-status catalog
    loaded) still get the correct answer for every builtin status.
    """
    if getattr(registration, "deleted_at", None) is not None:
        return False
    balancer_status = getattr(registration, "balancer_status", None)
    if status_meta_map is not None:
        meta = status_meta_map.get("balancer", {}).get(balancer_status)
        if meta is not None:
            return not meta["excludes_from_balancer"]
    return not is_balancer_status_excluded(balancer_status)


class RegistrationCommonService:
    """Cross-cutting registration lookups shared by the admin subsystems."""

    def __init__(
        self,
        *,
        form_repo: RegistrationFormRepository = RegistrationFormRepository(),
        tournament_repo: TournamentRepository = TournamentRepository(),
    ) -> None:
        self.form_repo = form_repo
        self.tournament_repo = tournament_repo

    async def _register_registration_changed(
        self,
        session: AsyncSession,
        registration: models.BalancerRegistration,
    ) -> None:
        await emit(
            session,
            scope=Scope.tournament(registration.tournament_id),
            invalidates=[Resource.TOURNAMENT_REGISTRATIONS],
            # A row created in this same transaction has no id until it flushes;
            # entity_ids is optional precision, so no id just means no narrowing.
            entity_ids={"registration_ids": [registration.id]} if registration.id is not None else None,
        )

    async def get_tournament_grid(self, session: AsyncSession, tournament_id: int) -> DivisionGrid:
        """Use the scoped full model so sheets and autofill retain native ranges."""
        tournament = await self.ensure_tournament_exists(session, tournament_id)
        version = await get_effective_division_grid_version(
            session, tournament.workspace_id, tournament_id=tournament_id, discipline=tournament.discipline
        )
        if version is None or not version.tiers:
            return runtime_fallback_grid(tournament.discipline)
        return load_runtime_grid(version)

    async def ensure_tournament_exists(self, session: AsyncSession, tournament_id: int) -> models.Tournament:
        tournament = await self.tournament_repo.get(session, tournament_id)
        if tournament is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
        return tournament

    async def get_tournament_discipline(self, session: AsyncSession, tournament_id: int) -> str:
        """The tournament's discipline code without loading the row; 404 when it does not exist."""
        owner = await self.tournament_repo.get_owner(session, tournament_id)
        if owner is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
        return owner[1]

    async def get_registration_form(
        self,
        session: AsyncSession,
        tournament_id: int,
    ) -> models.BalancerRegistrationForm | None:
        """The form WITH its current schema version eager-loaded.

        Delegated so there is one definition of "a usable form": every reader
        here goes on to ask the schema something, and ``current_version`` is
        never lazy-loadable in async code.
        """
        return await form_service.get_form(session, tournament_id)


_common_service = RegistrationCommonService()
