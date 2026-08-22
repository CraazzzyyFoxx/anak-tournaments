import secrets
import typing
from datetime import UTC, datetime

import dns.asyncresolver
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.errors import BaseAPIException as HTTPException
from shared.rbac import (
    assign_workspace_system_role,
    ensure_workspace_system_roles,
    replace_user_workspace_roles,
    user_has_only_workspace_owner_role,
)
from shared.repository import (
    AuthUserRepository,
    RoleRepository,
    UserRepository,
    UserRoleRepository,
    WorkspaceMemberRepository,
    WorkspaceRepository,
    get_or_create_workspace_member,
)
from shared.services.audit import record_audit
from shared.services.division_grid_access import get_default_division_grid_version_id
from shared.tenancy.hostnames import normalize_custom_domain
from src import models

__all__ = ["MEMBERS_SORT_FIELDS", "WorkspaceService", "workspaces"]

# Prefix for the generated per-workspace DNS verification token (the required
# TXT value at ``_owt-verify.<custom_domain>``). Namespaced so the string is
# unambiguous if it ever leaks into logs or support tickets.
_CUSTOM_DOMAIN_TOKEN_PREFIX = "owt-verify-"

_DOMAIN_CONFLICT_MESSAGE = "This custom domain is already claimed by another workspace"

MEMBERS_SORT_FIELDS = ("username", "role")


def _iso(value: datetime | None) -> str | None:
    """JSONB-safe timestamp for an audit before/after snapshot."""
    return value.isoformat() if value else None


class WorkspaceService:
    """Workspace + membership orchestration: repository-backed CRUD, the
    custom-domain (white-label) lifecycle, and the RBAC member queries."""

    def __init__(
        self,
        *,
        role_repo: RoleRepository = RoleRepository(),
        member_repo: WorkspaceMemberRepository = WorkspaceMemberRepository(),
        workspace_repo: WorkspaceRepository = WorkspaceRepository(),
        user_repo: UserRepository = UserRepository(),
        user_role_repo: UserRoleRepository = UserRoleRepository(),
        auth_user_repo: AuthUserRepository = AuthUserRepository(),
    ) -> None:
        self.role_repo = role_repo
        self.member_repo = member_repo
        self.workspace_repo = workspace_repo
        self.user_repo = user_repo
        self.user_role_repo = user_role_repo
        self.auth_user_repo = auth_user_repo

    # --- reads --------------------------------------------------------------

    async def get_by_id(self, session: AsyncSession, workspace_id: int) -> models.Workspace | None:
        return await self.workspace_repo.get_with_default_grid(session, workspace_id)

    async def get_by_slug(self, session: AsyncSession, slug: str) -> models.Workspace | None:
        return await self.workspace_repo.get_by_slug(session, slug)

    async def get_by_subdomain(self, session: AsyncSession, subdomain: str) -> models.Workspace | None:
        return await self.workspace_repo.get_by_subdomain(session, subdomain)

    async def get_by_custom_domain(self, session: AsyncSession, domain: str) -> models.Workspace | None:
        """Resolve a verified custom domain to its workspace (Phase 2 of ``by_host``).

        Delegates to the verified-only repo query — an unverified ``custom_domain``
        never resolves here.
        """
        return await self.workspace_repo.get_by_verified_custom_domain(session, domain)

    async def get_all(self, session: AsyncSession) -> typing.Sequence[models.Workspace]:
        return await self.workspace_repo.list_ordered(session)

    # --- custom domain (white-label Phase 2) --------------------------------

    async def _dns_txt_contains(self, name: str, expected: str) -> bool:
        """True iff a TXT record at ``name`` has a string that exactly equals ``expected``.

        Any DNS failure (NXDOMAIN, timeout, no-answer, malformed name, resolver
        misconfiguration, ...) resolves to ``False`` rather than raising —
        verification is meant to fail closed (``verify_custom_domain`` reports
        "not found yet"), never 500.
        """
        try:
            answers = await dns.asyncresolver.resolve(name, "TXT")
        except Exception:  # noqa: BLE001 -- any DNS failure means "not verified yet"
            return False
        for rdata in answers:
            txt = b"".join(rdata.strings).decode("utf-8", "ignore")
            if txt.strip() == expected:
                return True
        return False

    async def set_custom_domain(
        self, session: AsyncSession, workspace: models.Workspace, domain: str
    ) -> models.Workspace:
        """Store a normalized custom domain plus a fresh verification token, unverified.

        Re-pointing an already-verified domain (or setting a new one) always resets
        ``custom_domain_verified_at`` — the resolver (``get_by_custom_domain``) must
        never serve a domain whose ownership hasn't been (re-)proven via DNS TXT.

        Raises ``ValueError`` (mapped to 400 by the RPC caller) if ``domain`` fails
        ``normalize_custom_domain`` (empty, not a valid FQDN, or under the platform
        zone).

        Raises ``HTTPException(409)`` if another workspace already claims this
        domain (verified or not — the unique index ``ix_workspace_custom_domain``
        doesn't care either way). This is checked twice: a best-effort read
        up front (cheap, gives a clean error in the common case) AND the
        authoritative catch of the index's ``IntegrityError`` on write, since the
        read has a TOCTOU gap under a concurrent claim of the same domain.
        """
        normalized = normalize_custom_domain(domain)
        existing = await self.workspace_repo.get_by_custom_domain_any(session, normalized)
        if existing is not None and existing.id != workspace.id:
            raise HTTPException(status_code=409, detail=_DOMAIN_CONFLICT_MESSAGE)

        token = _CUSTOM_DOMAIN_TOKEN_PREFIX + secrets.token_urlsafe(24)
        try:
            await self.workspace_repo.update_fields(
                session,
                workspace,
                {
                    "custom_domain": normalized,
                    "custom_domain_verification_token": token,
                    "custom_domain_verified_at": None,
                },
            )
        except IntegrityError as exc:
            await session.rollback()
            raise HTTPException(status_code=409, detail=_DOMAIN_CONFLICT_MESSAGE) from exc
        return workspace

    async def clear_custom_domain(self, session: AsyncSession, workspace: models.Workspace) -> models.Workspace:
        """Remove the custom domain (and its token/verification state) entirely."""
        await self.workspace_repo.update_fields(
            session,
            workspace,
            {
                "custom_domain": None,
                "custom_domain_verification_token": None,
                "custom_domain_verified_at": None,
            },
        )
        return workspace

    async def verify_custom_domain(self, session: AsyncSession, workspace: models.Workspace) -> models.Workspace:
        """DNS-verify ``workspace.custom_domain`` and stamp ``custom_domain_verified_at``.

        Ownership proof is a TXT record at ``_owt-verify.<custom_domain>`` whose value
        equals the stored ``custom_domain_verification_token``. Raises 400 if no
        domain/token is set, or if the record doesn't (yet) match.

        The DNS TXT lookup is network I/O and must not run while pinning a pooled
        DB connection. By the time this is called, the caller's earlier read
        (``get_by_id``) has already opened an ambient transaction on ``session``
        — with nothing written yet, so committing it here is a plain read-only
        commit that only releases the connection. The lookup then runs with no
        session held, and the DB is only touched again (a fresh, short
        transaction) for the final ``custom_domain_verified_at`` write. This is
        safe against SQLAlchemy's attribute-expiry-on-commit: ``async_session_maker``
        is built with ``expire_on_commit=False`` (``backend/shared/core/db.py``),
        so this early commit never invalidates ``workspace``'s already-loaded
        attributes.
        """
        if not workspace.custom_domain or not workspace.custom_domain_verification_token:
            raise HTTPException(status_code=400, detail="No custom domain to verify")

        domain = workspace.custom_domain
        token = workspace.custom_domain_verification_token
        await session.commit()

        ok = await self._dns_txt_contains(f"_owt-verify.{domain}", token)
        if not ok:
            raise HTTPException(status_code=400, detail="Verification TXT record not found yet")
        await self.workspace_repo.update_fields(session, workspace, {"custom_domain_verified_at": datetime.now(UTC)})
        return workspace

    # --- writes -------------------------------------------------------------

    async def validate_default_division_grid_version(
        self,
        session: AsyncSession,
        *,
        workspace_id: int | None,
        version_id: int,
    ) -> None:
        owner_id = await session.scalar(
            sa.select(sa.func.coalesce(models.DivisionGrid.workspace_id, -1))
            .join(
                models.DivisionGridVersion,
                models.DivisionGridVersion.grid_id == models.DivisionGrid.id,
            )
            .where(models.DivisionGridVersion.id == version_id)
        )
        if owner_id is None:
            raise HTTPException(status_code=404, detail="Division grid version not found")
        if owner_id != -1 and owner_id != workspace_id:
            raise HTTPException(
                status_code=400,
                detail="Default division grid version must belong to the workspace or be global",
            )

    async def _resolve_default_division_grid_version_id(
        self,
        session: AsyncSession,
        version_id: int | None,
        *,
        workspace_id: int | None = None,
    ) -> int:
        if version_id is not None:
            await self.validate_default_division_grid_version(
                session,
                workspace_id=workspace_id,
                version_id=version_id,
            )
            return version_id

        resolved_version_id = await get_default_division_grid_version_id(session)
        if resolved_version_id is None:
            raise RuntimeError("System default division grid version is not configured")
        return resolved_version_id

    async def create(self, session: AsyncSession, **kwargs) -> models.Workspace:
        payload = dict(kwargs)
        payload["default_division_grid_version_id"] = await self._resolve_default_division_grid_version_id(
            session,
            payload.get("default_division_grid_version_id"),
        )

        workspace = models.Workspace(**payload)
        return await self.workspace_repo.create(session, workspace)

    async def update(self, session: AsyncSession, workspace: models.Workspace, data: dict) -> models.Workspace:
        if "default_division_grid_version_id" in data:
            raise HTTPException(
                status_code=400,
                detail="Activate division grid versions through the division-grid activation endpoint",
            )
        await self.workspace_repo.update_fields(session, workspace, dict(data))
        return workspace

    async def delete(self, session: AsyncSession, workspace: models.Workspace) -> None:
        await self.workspace_repo.delete(session, workspace)

    # --- members ------------------------------------------------------------

    async def get_members(self, session: AsyncSession, workspace_id: int) -> typing.Sequence[models.WorkspaceMember]:
        return await self.member_repo.list_by_workspace(session, workspace_id)

    async def list_members_page(
        self,
        session: AsyncSession,
        workspace_id: int,
        *,
        page: int,
        per_page: int,
        search: str | None,
        role_id: int | None = None,
        sort: str = "username",
        order: str = "asc",
    ) -> tuple[int, list[tuple[models.WorkspaceMember, models.AuthUser, list[models.Role]]]]:
        """Paginated + searchable + role-filterable/sortable RBAC members.

        Returns ``(total, [(member, auth_user, workspace_roles)])``. Thin
        translation of the service's ``order: str`` into the repository's
        ``descending: bool``; the three-statement query (count + page + one
        batched role fetch) lives in ``WorkspaceMemberRepository.list_page``.
        ``per_page == -1`` returns all members (capped) for selector/combobox
        callers. ``sort`` is one of ``username`` / ``role`` (primary system-role
        rank); ``order`` is ``asc`` / ``desc``.
        """
        return await self.member_repo.list_page(
            session,
            workspace_id=workspace_id,
            page=page,
            per_page=per_page,
            search=search,
            role_id=role_id,
            sort=sort,
            descending=order == "desc",
        )

    async def autofill_member_roles(self, session: AsyncSession, workspace_id: int) -> int:
        """Grant the baseline ``member`` role to every auth-linked member of
        ``workspace_id`` whose auth user currently holds no role there.

        Set-based and idempotent (the ``NOT EXISTS`` guard only touches role-less
        members, so re-running assigns nothing and never duplicates). Ensures the
        workspace system roles exist first so the ``member`` role is guaranteed
        present. Returns the number of grants inserted.
        """
        await ensure_workspace_system_roles(session, workspace_id)
        return await self.user_role_repo.grant_missing_workspace_member_role(session, workspace_id)

    async def get_member(
        self, session: AsyncSession, workspace_id: int, auth_user_id: int
    ) -> models.WorkspaceMember | None:
        return await self.member_repo.get_member(
            session,
            workspace_id=workspace_id,
            auth_user_id=auth_user_id,
        )

    async def _resolve_player_id_for_auth_user(self, session: AsyncSession, auth_user_id: int) -> int:
        """Resolve the ``players.user.id`` linked to ``auth_user_id``, provisioning a
        bare player if none exists.

        ``workspace_member`` is anchored on ``player_id``, so adding a member needs
        the auth user to have a linked ``players.user``. Post-Phase-A signups get one
        automatically, but legacy accounts (registered before that provisioning) have
        none — and Add Member explicitly targets staff who never played. Rather than
        500 on such users, provision the identity backbone on demand (mirrors
        ``ensure_player_for_auth_user``); the auth user's existence is validated by
        the caller (member_add) before we get here.
        """
        auth_user = await self.auth_user_repo.get(session, auth_user_id)
        name_hint = (auth_user.username or auth_user.email) if auth_user is not None else None
        player = await self.user_repo.ensure_for_auth_user(session, auth_user_id=auth_user_id, name_hint=name_hint)
        return player.id

    async def add_member(self, session: AsyncSession, workspace_id: int, auth_user_id: int) -> models.WorkspaceMember:
        """Create (or fetch) the membership row for the player linked to ``auth_user_id``.

        Callers keep passing ``auth_user_id`` (unchanged signature); internally we
        resolve the ``player_id`` the ``workspace_member`` row is actually
        anchored on. No longer accepts/writes a ``role`` — the column was dropped;
        RBAC (``user_roles``, keyed on ``auth_user_id``) is the source of truth.
        """
        await ensure_workspace_system_roles(session, workspace_id)
        player_id = await self._resolve_player_id_for_auth_user(session, auth_user_id)
        return await get_or_create_workspace_member(session, workspace_id=workspace_id, player_id=player_id)

    async def add_member_with_roles(
        self,
        session: AsyncSession,
        workspace_id: int,
        auth_user_id: int,
        *,
        role_ids: list[int],
    ) -> models.WorkspaceMember:
        member = await self.add_member(session, workspace_id, auth_user_id)
        await replace_user_workspace_roles(
            session,
            user_id=auth_user_id,
            workspace_id=workspace_id,
            role_ids=role_ids,
        )
        await session.flush()
        # ``updated_at`` (onupdate=func.now()) is server-computed and gets expired by
        # the flush; refresh inside the async context so callers can read it without
        # triggering a lazy load outside the greenlet (sqlalchemy.exc.MissingGreenlet).
        await session.refresh(member)
        return member

    async def _workspace_roles_from_ids(
        self,
        session: AsyncSession,
        workspace_id: int,
        role_ids: list[int],
    ) -> list[models.Role]:
        if not role_ids:
            return []
        roles = await self.role_repo.bulk_get(
            session,
            role_ids,
        )
        roles = [role for role in roles if role.workspace_id == workspace_id]
        if len({role.id for role in roles}) != len(set(role_ids)):
            raise ValueError("All role_ids must refer to roles in the target workspace")
        return roles

    async def get_member_auth_user_id(self, session: AsyncSession, member: models.WorkspaceMember) -> int:
        """Resolve the RBAC (``auth.user.id``) identity behind a membership row.

        ``workspace_member`` is anchored on ``player_id``; RBAC (``user_roles``,
        role assignment, ownership checks) stays keyed on ``auth_user_id``. This
        is the bridge between the two for code that only has the member row.
        """
        player = await self.user_repo.get(session, member.player_id)
        if player is None or player.auth_user_id is None:
            raise HTTPException(
                status_code=500,
                detail=f"workspace_member {member.id} has no linked auth user (player_id={member.player_id})",
            )
        return player.auth_user_id

    async def update_member_roles(
        self,
        session: AsyncSession,
        member: models.WorkspaceMember,
        *,
        role_ids: list[int],
    ) -> models.WorkspaceMember:
        auth_user_id = await self.get_member_auth_user_id(session, member)
        if await user_has_only_workspace_owner_role(
            session,
            user_id=auth_user_id,
            workspace_id=member.workspace_id,
        ):
            roles = await self._workspace_roles_from_ids(session, member.workspace_id, role_ids)
            if all(role.name != "owner" for role in roles):
                raise ValueError("Cannot remove the last workspace owner")

        await replace_user_workspace_roles(
            session,
            user_id=auth_user_id,
            workspace_id=member.workspace_id,
            role_ids=role_ids,
        )
        await session.flush()
        # ``updated_at`` (onupdate=func.now()) is server-computed and gets expired by
        # the flush; refresh inside the async context so callers can read it without
        # triggering a lazy load outside the greenlet (sqlalchemy.exc.MissingGreenlet).
        await session.refresh(member)
        return member

    async def get_member_workspace_roles(
        self,
        session: AsyncSession,
        workspace_id: int,
        auth_user_id: int,
    ) -> list[models.Role]:
        return await self.role_repo.list_for_user_workspace(
            session,
            user_id=auth_user_id,
            workspace_id=workspace_id,
        )

    async def can_remove_member(self, session: AsyncSession, member: models.WorkspaceMember) -> bool:
        auth_user_id = await self.get_member_auth_user_id(session, member)
        return not await user_has_only_workspace_owner_role(
            session,
            user_id=auth_user_id,
            workspace_id=member.workspace_id,
        )

    async def remove_member(self, session: AsyncSession, member: models.WorkspaceMember) -> None:
        auth_user_id = await self.get_member_auth_user_id(session, member)
        await self.user_role_repo.revoke_workspace_roles(
            session, user_id=auth_user_id, workspace_id=member.workspace_id
        )
        await self.member_repo.delete(session, member)

    # --- transactional operations -------------------------------------------
    # Everything below owns a ``session.commit()``: the transport layer never
    # closes a transaction it did not open. The primitives above stay
    # commit-free so they compose (and so the DB integration tests can roll
    # their whole fixture back).

    async def provision(
        self,
        session: AsyncSession,
        *,
        payload: dict,
        owner_auth_user_id: int,
    ) -> models.Workspace:
        """Create a workspace with its system roles and its first owner."""
        slug = payload.get("slug")
        if slug is not None and await self.get_by_slug(session, slug):
            raise HTTPException(status_code=400, detail="Workspace with this slug already exists")
        workspace = await self.create(session, **payload)
        await ensure_workspace_system_roles(session, workspace.id)
        await self.add_member(session, workspace.id, owner_auth_user_id)
        await assign_workspace_system_role(
            session, user_id=owner_auth_user_id, workspace_id=workspace.id, role_name="owner"
        )
        await session.commit()
        # The workspace was built in Python and only flushed, so its
        # ``default_division_grid_version`` was never loaded -- ``selectin`` is
        # a query-time strategy and does not run for an instance that never
        # went through a SELECT. Reading it below would then lazy-load from
        # sync Pydantic code (MissingGreenlet) whenever the create body named
        # a version. Awaited here, it is ordinary IO.
        await session.refresh(workspace, ["default_division_grid_version"])
        return workspace

    async def backfill_member_roles(self, session: AsyncSession, workspace_id: int) -> int:
        assigned = await self.autofill_member_roles(session, workspace_id)
        await session.commit()
        return assigned

    async def invite_member(
        self,
        session: AsyncSession,
        workspace_id: int,
        auth_user_id: int,
        *,
        role_ids: list[int],
    ) -> models.WorkspaceMember:
        member = await self.add_member_with_roles(session, workspace_id, auth_user_id, role_ids=role_ids)
        await session.commit()
        return member

    async def change_member_roles(
        self,
        session: AsyncSession,
        member: models.WorkspaceMember,
        *,
        role_ids: list[int],
    ) -> models.WorkspaceMember:
        member = await self.update_member_roles(session, member, role_ids=role_ids)
        await session.commit()
        return member

    async def revoke_member(self, session: AsyncSession, member: models.WorkspaceMember) -> None:
        await self.remove_member(session, member)
        await session.commit()

    async def _record_domain_change(
        self,
        session: AsyncSession,
        workspace: models.Workspace,
        *,
        action: str,
        actor: typing.Any,
        workspace_id: int,
        before: dict,
        after: dict,
    ) -> None:
        """One ``audit_log`` row for a custom-domain change, staged inside the
        mutation's own transaction.

        ``workspace_id`` is the caller's authorization scope, passed in rather
        than read off ``workspace``: the audit scope must be the scope the
        permission check ran against.

        The ``custom_domain_verification_token`` is deliberately absent from
        both sides. It is not a platform secret (the organizer publishes it as a
        public DNS TXT record), but the journal is append-only and never purged,
        so every rotated challenge would pile up there forever while answering
        nothing an auditor asks -- "who re-pointed our domain" is answered by
        the domain itself.
        """
        await record_audit(
            session,
            action=action,
            source="admin",
            actor=actor,
            actor_label=actor.username,
            workspace_id=workspace_id,
            entity_type="workspace",
            entity_id=workspace.id,
            entity_label=workspace.slug,
            before=before,
            after=after,
        )

    async def apply_custom_domain(
        self,
        session: AsyncSession,
        workspace: models.Workspace,
        domain: str,
        *,
        actor: typing.Any,
        workspace_id: int,
    ) -> models.Workspace:
        domain_before = workspace.custom_domain
        verified_before = workspace.custom_domain_verified_at
        workspace = await self.set_custom_domain(session, workspace, domain)
        await self._record_domain_change(
            session,
            workspace,
            action="workspace.domain_set",
            actor=actor,
            workspace_id=workspace_id,
            before={"custom_domain": domain_before, "custom_domain_verified_at": _iso(verified_before)},
            # Re-pointing always resets verification, so the after side is known.
            after={"custom_domain": workspace.custom_domain, "custom_domain_verified_at": None},
        )
        await session.commit()
        return workspace

    async def confirm_custom_domain(
        self,
        session: AsyncSession,
        workspace: models.Workspace,
        *,
        actor: typing.Any,
        workspace_id: int,
    ) -> models.Workspace:
        verified_before = workspace.custom_domain_verified_at
        workspace = await self.verify_custom_domain(session, workspace)
        # Recorded after the mutation, not before it: ``verify_custom_domain``
        # commits once to release the connection across the DNS lookup, so a row
        # added earlier would survive a failed verification.
        #
        # ``custom_domain`` is unchanged and sits on both sides on purpose --
        # without it the row says a domain was verified without saying which one.
        await self._record_domain_change(
            session,
            workspace,
            action="workspace.domain_verified",
            actor=actor,
            workspace_id=workspace_id,
            before={"custom_domain": workspace.custom_domain, "custom_domain_verified_at": _iso(verified_before)},
            after={
                "custom_domain": workspace.custom_domain,
                "custom_domain_verified_at": _iso(workspace.custom_domain_verified_at),
            },
        )
        await session.commit()
        return workspace

    async def drop_custom_domain(
        self,
        session: AsyncSession,
        workspace: models.Workspace,
        *,
        actor: typing.Any,
        workspace_id: int,
    ) -> models.Workspace:
        domain_before = workspace.custom_domain
        verified_before = workspace.custom_domain_verified_at
        workspace = await self.clear_custom_domain(session, workspace)
        # Token value omitted for the reason given in _record_domain_change; that
        # it was dropped follows from the domain going away.
        await self._record_domain_change(
            session,
            workspace,
            action="workspace.domain_clear",
            actor=actor,
            workspace_id=workspace_id,
            before={"custom_domain": domain_before, "custom_domain_verified_at": _iso(verified_before)},
            after={"custom_domain": None, "custom_domain_verified_at": None},
        )
        await session.commit()
        return workspace


workspaces = WorkspaceService()
