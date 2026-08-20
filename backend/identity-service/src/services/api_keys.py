"""Workspace-scoped API keys: issue, list, rename, revoke, validate."""

from __future__ import annotations

import hmac
import secrets
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.core.pagination import paginated_dict
from shared.repository import ApiKeyRepository, RoleRepository, WorkspaceMemberRepository, WorkspaceRepository
from shared.services.audit import record_audit
from src import models, schemas
from src.core import key_derivation
from src.core.config import settings

__all__ = ("ApiKeyService", "api_keys")


def _now() -> datetime:
    return datetime.now(UTC)


def _isoformat(value: datetime | None) -> str | None:
    """Render a timestamp for a JSONB audit snapshot (``json.dumps`` cannot)."""
    return value.isoformat() if value is not None else None


class ApiKeyService:
    PREFIX = "aqt_sk"
    DEFAULT_SCOPES = ["balancer.jobs"]
    DEFAULT_LIMITS: dict[str, int] = {
        "requests_per_minute": 60,
        "jobs_per_day": 100,
        "concurrent_jobs": 2,
        "max_upload_bytes": 10 * 1024 * 1024,
        "max_players": 500,
    }
    DEFAULT_CONFIG_POLICY: dict[str, Any] = {
        "allowed_keys": [
            "algorithm",
            "role_mask",
            "population_size",
            "generation_count",
            "use_captains",
            "max_result_variants",
        ],
        "allowed_algorithms": ["moo"],
        "max_values": {
            "population_size": 150,
            "generation_count": 500,
            "max_result_variants": 10,
        },
    }

    def __init__(
        self,
        *,
        keys: ApiKeyRepository = ApiKeyRepository(),
        workspaces: WorkspaceRepository = WorkspaceRepository(),
        members: WorkspaceMemberRepository = WorkspaceMemberRepository(),
        roles: RoleRepository = RoleRepository(),
        config: Any = settings,
    ) -> None:
        self.keys = keys
        self.workspaces = workspaces
        self.members = members
        self.roles = roles
        self.config = config
        # Domain-separated subkey for hashing API-key secrets (never the raw JWT secret).
        self._secret_key = key_derivation.api_key_secret_key(config.JWT_SECRET_KEY)

    # -- key material ------------------------------------------------------

    def is_api_key(self, raw_token: str) -> bool:
        return raw_token.startswith(f"{self.PREFIX}_")

    def _hash_secret(self, secret: str) -> str:
        """Hash an API-key secret for storage (domain-separated subkey, new writes)."""
        return key_derivation.hmac_sha256_hex(self._secret_key, secret)

    def _verify_secret(self, secret: str, stored_hash: str) -> bool:
        """Constant-time verify against the derived hash, then the legacy raw-secret
        hash — so API keys created before domain separation keep validating without
        a re-issue. New keys are always stored with the derived hash."""
        if hmac.compare_digest(stored_hash, self._hash_secret(secret)):
            return True
        legacy = key_derivation.legacy_hmac_sha256_hex(self.config.JWT_SECRET_KEY, secret)
        return hmac.compare_digest(stored_hash, legacy)

    @staticmethod
    def _split_key(raw_key: str) -> tuple[str, str] | None:
        parts = raw_key.split("_")
        if len(parts) != 4 or parts[0] != "aqt" or parts[1] != "sk":
            return None
        public_id = parts[2].strip()
        secret = parts[3].strip()
        if not public_id or not secret:
            return None
        return public_id, secret

    # -- serialization -----------------------------------------------------

    @staticmethod
    def _serialize(row: models.ApiKey) -> schemas.ApiKeyRead:
        return schemas.ApiKeyRead(
            id=row.id,
            name=row.name,
            workspace_id=row.workspace_id,
            public_id=row.public_id,
            scopes=list(row.scopes_json or []),
            limits=dict(row.limits_json or {}),
            config_policy=dict(row.config_policy_json or {}),
            expires_at=row.expires_at,
            revoked_at=row.revoked_at,
            last_used_at=row.last_used_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    @staticmethod
    def _clean_name(value: str) -> str:
        name = value.strip()
        if not name:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="API key name is required")
        return name

    # -- authorization -----------------------------------------------------

    @staticmethod
    def _has_permission_payload(permissions: list[dict[str, str]], resource: str, action: str) -> bool:
        for permission in permissions:
            pr = permission.get("resource")
            pa = permission.get("action")
            if (pr == resource or pr == "*") and (pa == action or pa == "*"):
                return True
        return False

    async def _ensure_active_workspace(self, session: AsyncSession, workspace_id: int) -> models.Workspace:
        workspace = await self.workspaces.get(session, workspace_id)
        if workspace is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
        if not workspace.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Workspace is inactive")
        return workspace

    async def _has_workspace_import_access(
        self,
        session: AsyncSession,
        *,
        user: models.AuthUser,
        workspace_id: int,
    ) -> bool:
        if user.is_superuser or user.has_permission("team", "create"):
            return True

        member = await self.members.get_member(session, workspace_id=workspace_id, auth_user_id=user.id)
        if member is None:
            return False
        # No legacy role-name shortcut here: it bypassed RBAC entirely, so a
        # workspace role narrowed to exclude ``team.create`` would still have
        # passed on the strength of its name alone. Owner is covered below by the
        # wildcard ``*``/``*`` grant behind ``admin.*``.
        workspace_rbac = await self.roles.workspace_rbac_for_user(session, user.id, [workspace_id])
        _, permissions = workspace_rbac.get(workspace_id, ([], []))
        return self._has_permission_payload(permissions, "team", "create")

    async def ensure_can_manage(
        self,
        session: AsyncSession,
        *,
        user: models.AuthUser,
        workspace_id: int,
    ) -> None:
        await self._ensure_active_workspace(session, workspace_id)
        if not await self._has_workspace_import_access(session, user=user, workspace_id=workspace_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied for workspace {workspace_id}: team.create required",
            )

    # -- read --------------------------------------------------------------

    async def _status_counts(
        self,
        session: AsyncSession,
        *,
        auth_user_id: int,
        workspace_id: int,
    ) -> schemas.ApiKeyStatusCounts:
        """Workspace-wide (current user's) API-key tallies by derived status."""
        tally = await self.keys.status_counts(
            session,
            auth_user_id=auth_user_id,
            workspace_id=workspace_id,
            now=_now(),
        )
        return schemas.ApiKeyStatusCounts(
            total=sum(tally.values()),
            active=tally.get("active", 0),
            expired=tally.get("expired", 0),
            revoked=tally.get("revoked", 0),
        )

    async def list(
        self,
        session: AsyncSession,
        *,
        user: models.AuthUser,
        params: schemas.ApiKeyListParams,
    ) -> dict:
        """Paginated list of the current user's API keys for a workspace, plus status counts."""
        if params.workspace_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="workspace_id is required",
            )
        await self.ensure_can_manage(session, user=user, workspace_id=params.workspace_id)

        rows, total = await self.keys.list_page(
            session,
            params,
            auth_user_id=user.id,
            workspace_id=params.workspace_id,
            search=params.search,
        )
        counts = await self._status_counts(session, auth_user_id=user.id, workspace_id=params.workspace_id)
        return {**paginated_dict([self._serialize(row) for row in rows], total, params), "counts": counts}

    # -- write -------------------------------------------------------------

    async def create(
        self,
        session: AsyncSession,
        *,
        user: models.AuthUser,
        payload: schemas.ApiKeyCreate,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> schemas.ApiKeyCreateResponse:
        await self.ensure_can_manage(session, user=user, workspace_id=payload.workspace_id)

        public_id = secrets.token_hex(8)
        secret = secrets.token_hex(32)
        full_key = f"{self.PREFIX}_{public_id}_{secret}"
        row = models.ApiKey(
            auth_user_id=user.id,
            workspace_id=payload.workspace_id,
            public_id=public_id,
            secret_hash=self._hash_secret(secret),
            name=self._clean_name(payload.name),
            scopes_json=list(self.DEFAULT_SCOPES),
            limits_json=dict(self.DEFAULT_LIMITS),
            config_policy_json=dict(self.DEFAULT_CONFIG_POLICY),
            expires_at=payload.expires_at,
        )
        await self.keys.create(session, row)
        # Never the secret, its hash, or the public id: an API key is identified in
        # the journal by its row id and human name, and by nothing that authenticates.
        await record_audit(
            session,
            action="api_key.create",
            source="admin",
            actor=user,
            actor_label=user.username or user.email,
            workspace_id=row.workspace_id,
            entity_type="api_key",
            entity_id=row.id,
            entity_label=row.name,
            after={
                "name": row.name,
                "scopes_json": list(row.scopes_json),
                "expires_at": _isoformat(row.expires_at),
            },
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await session.commit()
        await session.refresh(row)
        return schemas.ApiKeyCreateResponse(api_key=self._serialize(row), key=full_key)

    async def update(
        self,
        session: AsyncSession,
        *,
        user: models.AuthUser,
        api_key_id: int,
        payload: schemas.ApiKeyUpdate,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> schemas.ApiKeyRead:
        row = await self.keys.get(session, api_key_id)
        if row is None or row.auth_user_id != user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")
        await self.ensure_can_manage(session, user=user, workspace_id=row.workspace_id)
        before_name = row.name
        row.name = self._clean_name(payload.name)
        await record_audit(
            session,
            action="api_key.update",
            source="admin",
            actor=user,
            actor_label=user.username or user.email,
            workspace_id=row.workspace_id,
            entity_type="api_key",
            entity_id=row.id,
            entity_label=row.name,
            before={"name": before_name},
            after={"name": row.name},
            ip_address=ip_address,
            user_agent=user_agent,
        )
        await session.commit()
        await session.refresh(row)
        return self._serialize(row)

    async def revoke(
        self,
        session: AsyncSession,
        *,
        user: models.AuthUser,
        api_key_id: int,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> None:
        row = await self.keys.get(session, api_key_id)
        if row is None or row.auth_user_id != user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")
        await self.ensure_can_manage(session, user=user, workspace_id=row.workspace_id)
        if row.revoked_at is None:
            row.revoked_at = _now()
            # Inside the branch: revoking an already-revoked key changes nothing and
            # must not add a second "revoked" row to the journal.
            await record_audit(
                session,
                action="api_key.revoke",
                source="admin",
                actor=user,
                actor_label=user.username or user.email,
                workspace_id=row.workspace_id,
                entity_type="api_key",
                entity_id=row.id,
                entity_label=row.name,
                before={"revoked_at": None},
                after={"revoked_at": _isoformat(row.revoked_at)},
                ip_address=ip_address,
                user_agent=user_agent,
            )
            await session.commit()

    # -- validation --------------------------------------------------------

    async def validate(self, session: AsyncSession, raw_key: str) -> schemas.TokenPayload | None:
        parsed = self._split_key(raw_key)
        if parsed is None:
            return None

        public_id, secret = parsed
        api_key = await self.keys.get_by_public_id(session, public_id)
        if api_key is None:
            return None
        if not self._verify_secret(secret, api_key.secret_hash):
            return None
        if api_key.revoked_at is not None:
            return None
        if api_key.expires_at is not None and api_key.expires_at <= _now():
            return None
        if api_key.user is None or not api_key.user.is_active:
            return None
        if api_key.workspace is None or not api_key.workspace.is_active:
            return None
        if not await self._has_workspace_import_access(session, user=api_key.user, workspace_id=api_key.workspace_id):
            return None

        api_key.last_used_at = _now()
        await session.commit()

        scopes = list(api_key.scopes_json or [])
        limits = dict(api_key.limits_json or {})
        config_policy = dict(api_key.config_policy_json or {})
        return schemas.TokenPayload(
            sub=api_key.user.id,
            email=api_key.user.email,
            username=api_key.user.username,
            is_superuser=False,
            roles=[],
            permissions=[],
            workspaces=[
                schemas.WorkspaceMembership(
                    workspace_id=api_key.workspace_id,
                    slug=api_key.workspace.slug,
                    rbac_roles=[],
                    # ``team.create`` is what every balancer job path actually
                    # checks (rpc/admin.py, rpc/binary.py, rpc/draft.py, and
                    # WorkspaceAccessPolicy's default). The grant must stay in
                    # lockstep with those checks: any mismatch 403s every keyed
                    # balancer request.
                    rbac_permissions=[{"resource": "team", "action": "create"}],
                )
            ],
            credential_type="api_key",
            api_key=schemas.TokenApiKeyInfo(
                id=api_key.id,
                public_id=api_key.public_id,
                workspace_id=api_key.workspace_id,
                scopes=scopes,
                limits=limits,
                config_policy=config_policy,
            ),
        )


api_keys = ApiKeyService()
