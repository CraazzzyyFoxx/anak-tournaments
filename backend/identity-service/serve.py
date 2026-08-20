"""identity-svc: headless FastStream worker exposing identity RPC methods.

The Go gateway calls these over RabbitMQ request-reply (reply_to + correlation_id);
a handler simply returns the reply envelope and FastStream answers automatically.

This module is the transport adapter and nothing else: it parses the RPC payload,
resolves the caller when the method needs one, hands off to a service object, and
serialises the result. Every authorization decision, every query and every error
message belongs to `src/services/**`.
"""

from __future__ import annotations

import asyncio
import base64
import sys
from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID

from faststream import FastStream
from faststream.rabbit.annotations import RabbitMessage
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.errors import BaseAPIException as HTTPException
from shared.observability import (
    make_rabbit_broker,
    setup_logging,
    setup_sentry,
    setup_tracing,
    start_worker_metrics_server,
)
from shared.rpc.query import build_query_model
from src import schemas
from src.core import db
from src.core.config import settings
from src.core.redis import close_redis, init_redis
from src.core.s3 import s3_client
from src.schemas.rpc import rpc_error, rpc_ok, status_to_code
from src.services.api_keys import api_keys
from src.services.auth import auth
from src.services.avatars import avatars
from src.services.oauth import oauth
from src.services.oauth_providers import close_http_client
from src.services.players import players
from src.services.rbac_admin import (
    auth_user_admin,
    permission_admin,
    permission_denies,
    role_admin,
    session_admin,
)
from src.services.service_tokens import service_tokens
from src.services.token_validation import token_validation


def _install_uvloop() -> None:
    """Swap in uvloop where it ships (see the `platform_system == 'Linux'` dep marker)."""
    if sys.platform != "linux":
        return
    import uvloop

    asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())


def _validation_detail(exc: ValidationError) -> str:
    errors = exc.errors()
    if not errors:
        return "validation error"
    first = errors[0]
    loc = ".".join(str(part) for part in first.get("loc", ()) if part != "body")
    msg = first.get("msg", "invalid value")
    return f"{loc}: {msg}" if loc else msg


async def _rpc(label: str, op: Callable[[], Awaitable[Any]], *, failure: str = "internal error") -> dict:
    """Run an RPC body and map every outcome onto the reply envelope.

    One place decides how a domain error, a schema error and an unexpected crash
    each look on the wire, so no handler can drift from the mapping the gateway
    asserts on.
    """
    try:
        return rpc_ok(await op())
    except ValidationError as exc:
        return rpc_error("unprocessable", _validation_detail(exc))
    except HTTPException as exc:
        return rpc_error(status_to_code(exc.status_code), str(exc.detail))
    except Exception:  # pragma: no cover - defensive worker guard
        logger.exception(f"{label} RPC failed")
        return rpc_error("internal", failure)


async def _rpc_session(
    label: str,
    op: Callable[[AsyncSession], Awaitable[Any]],
    *,
    failure: str = "internal error",
) -> dict:
    """``_rpc`` with a database session scoped to the call."""

    async def run() -> Any:
        async with db.async_session_maker() as session:
            return await op(session)

    return await _rpc(label, run, failure=failure)


async def _with_active_user(
    access_token: Any,
    op: Callable[[AsyncSession, Any], Awaitable[Any]],
    *,
    label: str = "authenticated",
) -> dict:
    """Resolve the active user from a bearer access token, run op, map errors.

    Shared by every authenticated RPC method. A missing or non-string token is
    rejected before any database work — the gateway only omits it for anonymous
    callers, so this is not an error worth a round trip.
    """
    if not access_token or not isinstance(access_token, str):
        return rpc_error("forbidden", "Not authenticated")

    async def run(session: AsyncSession) -> Any:
        user = await token_validation.resolve_active_user(session, access_token)
        return await op(session, user)

    return await _rpc_session(label, run)


def _opt_int(data: dict, key: str) -> int | None:
    raw = data.get(key)
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{key} must be an integer")


def _require_int(data: dict, key: str) -> int:
    value = _opt_int(data, key)
    if value is None:
        raise HTTPException(status_code=422, detail=f"{key} is required")
    return value


def _opt_bool(data: dict, key: str) -> bool | None:
    raw = data.get(key)
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        if raw.lower() in ("true", "1", "yes"):
            return True
        if raw.lower() in ("false", "0", "no"):
            return False
    raise HTTPException(status_code=422, detail=f"{key} must be a boolean")


def _opt_str(data: dict, key: str) -> str | None:
    raw = data.get(key)
    if raw is None or raw == "":
        return None
    return str(raw)


def _paginated_dump(res: dict) -> dict:
    """Serialize a service-layer ``{results, total, page, per_page}`` envelope.

    ``results`` holds Pydantic models; everything else is passed through (so an
    optional ``counts`` model is serialized too).
    """
    out: dict[str, Any] = {
        "results": [item.model_dump(mode="json") for item in res["results"]],
        "total": res["total"],
        "page": res["page"],
        "per_page": res["per_page"],
    }
    counts = res.get("counts")
    if counts is not None:
        out["counts"] = counts.model_dump(mode="json")
    return out


logger = setup_logging(
    service_name="identity-svc",
    log_level=settings.log_level,
    logs_root_path=settings.logs_root_path,
    json_output=settings.json_logging,
)

_install_uvloop()

broker = make_rabbit_broker(settings.rabbitmq_url, logger=logger, prefetch_count=settings.rpc_prefetch_count)
app = FastStream(broker)


@app.on_startup
async def setup_worker() -> None:
    setup_sentry(
        dsn=settings.sentry_dsn,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        profiles_sample_rate=settings.sentry_profiles_sample_rate,
        service_name="identity-svc",
        enable_logs=settings.sentry_enable_logs,
        logs_level=settings.sentry_logs_level,
        enable_metrics=settings.sentry_enable_metrics,
        environment=settings.environment,
        release=settings.sentry_release,
        http_proxy=settings.sentry_http_proxy_url,
        https_proxy=settings.sentry_https_proxy_url,
    )
    setup_tracing(
        service_name="identity-svc",
        otlp_endpoint=settings.otlp_endpoint,
        enabled=settings.tracing_enabled,
        sampler_name=settings.otel_traces_sampler,
        sampler_arg=settings.otel_traces_sampler_arg,
        environment=settings.environment,
        release=settings.sentry_release,
        engine=db.async_engine,
    )
    if settings.worker_metrics_port:
        start_worker_metrics_server(settings.worker_metrics_port)
    await init_redis()
    await s3_client.start()
    logger.info("identity-svc started")


@app.on_shutdown
async def teardown_worker() -> None:
    await s3_client.close()
    await close_http_client()
    await close_redis()


# --- Token / service credentials ---


@broker.subscriber("rpc.identity.validate_token")
async def rpc_validate_token(data: dict, msg: RabbitMessage) -> dict:
    """Validate a bearer access token / API key, returning RBAC TokenPayload."""
    token = (data or {}).get("token")
    if not token or not isinstance(token, str):
        return rpc_error("bad_request", "token is required")

    async def run(session: AsyncSession) -> dict:
        payload = await token_validation.validate(session, token)
        return payload.model_dump(mode="json")

    return await _rpc_session("validate_token", run)


@broker.subscriber("rpc.identity.service_token")
async def rpc_service_token(data: dict, msg: RabbitMessage) -> dict:
    async def run() -> dict:
        req = schemas.ServiceTokenRequest.model_validate(data or {})
        return service_tokens.issue(req.client_id, req.client_secret).model_dump(mode="json")

    return await _rpc("service_token", run)


@broker.subscriber("rpc.identity.validate_service_token")
async def rpc_validate_service_token(data: dict, msg: RabbitMessage) -> dict:
    token = (data or {}).get("token")
    if not token or not isinstance(token, str):
        return rpc_error("unauthorized", "Invalid service token")

    async def run() -> dict:
        return service_tokens.validate(token).model_dump(mode="json")

    return await _rpc("validate_service_token", run)


@broker.subscriber("rpc.identity.invalidate_session")
async def rpc_invalidate_session(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}
    token = data.get("token")
    if not token or not isinstance(token, str):
        return rpc_error("forbidden", "Not authenticated")
    try:
        user_id = int(data.get("user_id"))
    except (TypeError, ValueError):
        return rpc_error("bad_request", "Invalid user id")

    async def run() -> None:
        await service_tokens.invalidate_rbac(token, user_id)

    return await _rpc("invalidate_session", run)


# --- Auth core ---


@broker.subscriber("rpc.identity.register")
async def rpc_register(data: dict, msg: RabbitMessage) -> dict:
    async def run(session: AsyncSession) -> dict:
        payload = schemas.UserRegister.model_validate(data or {})
        user = await auth.register(session, payload)
        return schemas.AuthUser.model_validate(user).model_dump(mode="json")

    return await _rpc_session("register", run)


@broker.subscriber("rpc.identity.login")
async def rpc_login(data: dict, msg: RabbitMessage) -> dict:
    payload = data or {}

    async def run(session: AsyncSession) -> dict:
        creds = schemas.UserLogin.model_validate(payload)
        token = await auth.login(
            session,
            creds.email,
            creds.password,
            payload.get("user_agent"),
            payload.get("ip_address"),
        )
        return token.model_dump(mode="json")

    return await _rpc_session("login", run)


@broker.subscriber("rpc.identity.refresh")
async def rpc_refresh(data: dict, msg: RabbitMessage) -> dict:
    payload = data or {}

    async def run(session: AsyncSession) -> dict:
        req = schemas.RefreshTokenRequest.model_validate(payload)
        token = await auth.refresh(
            session,
            req.refresh_token,
            payload.get("user_agent"),
            payload.get("ip_address"),
        )
        return token.model_dump(mode="json")

    return await _rpc_session("refresh", run)


@broker.subscriber("rpc.identity.logout")
async def rpc_logout(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}
    refresh_token = data.get("refresh_token")
    if not data.get("access_token"):
        return rpc_error("forbidden", "Not authenticated")
    if not refresh_token:
        return rpc_error("unprocessable", "refresh_token is required")

    async def op(session: AsyncSession, user: Any) -> None:
        await auth.logout(session, user, refresh_token)

    return await _with_active_user(data.get("access_token"), op, label="logout")


@broker.subscriber("rpc.identity.logout_all")
async def rpc_logout_all(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> None:
        await auth.logout_all(session, user)

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.list_sessions")
async def rpc_list_sessions(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> list[dict]:
        summaries = await auth.list_sessions(session, user)
        return [item.model_dump(mode="json") for item in summaries]

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.revoke_session")
async def rpc_revoke_session(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}
    raw_session_id = data.get("session_id")

    async def op(session: AsyncSession, user: Any) -> None:
        try:
            session_uuid = UUID(str(raw_session_id))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid session id")
        await auth.revoke_session(session, user, session_uuid)

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.get_me")
async def rpc_get_me(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        result = await auth.get_me(session, user.id)
        return result.model_dump(mode="json")

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.update_me")
async def rpc_update_me(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        payload = schemas.UserUpdate.model_validate(data)
        updated = await auth.update_me(session, user, payload)
        return schemas.AuthUser.model_validate(updated, from_attributes=True).model_dump(mode="json")

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.delete_me")
async def rpc_delete_me(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> None:
        await auth.delete_me(
            session,
            user,
            ip_address=data.get("ip_address"),
            user_agent=data.get("user_agent"),
        )

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.set_password")
async def rpc_set_password(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> None:
        payload = schemas.PasswordSetRequest.model_validate(data)
        await auth.set_password(session, user, payload)

    return await _with_active_user(data.get("access_token"), op)


# --- OAuth ---


@broker.subscriber("rpc.identity.oauth_providers")
async def rpc_oauth_providers(data: dict, msg: RabbitMessage) -> dict:
    return rpc_ok([provider.model_dump(mode="json") for provider in oauth.list_providers()])


@broker.subscriber("rpc.identity.oauth_url")
async def rpc_oauth_url(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}
    provider = data.get("provider")
    if not provider or not isinstance(provider, str):
        return rpc_error("bad_request", "provider is required")
    origin, redirect, action = data.get("origin"), data.get("redirect"), data.get("action")
    if not origin or not isinstance(origin, str):
        return rpc_error("bad_request", "origin is required")
    if not isinstance(redirect, str) or not redirect:
        redirect = "/"
    if not action or not isinstance(action, str):
        return rpc_error("bad_request", "action is required")
    csrf = data.get("csrf")
    if not csrf or not isinstance(csrf, str):
        return rpc_error("bad_request", "csrf is required")
    # Optional (Task 10R fix 1): only the frontend's custom-domain apex bounce
    # supplies this (see oauth-login.ts). Anything not a non-empty string is
    # treated as absent -- the state carries it only when present.
    guard_hash = data.get("guard_hash")
    if not isinstance(guard_hash, str) or not guard_hash:
        guard_hash = None

    async def run() -> dict:
        result = oauth.authorization_url(
            provider, origin=origin, redirect=redirect, action=action, csrf=csrf, guard_hash=guard_hash
        )
        return result.model_dump(mode="json")

    return await _rpc("oauth_url", run)


@broker.subscriber("rpc.identity.oauth_callback")
async def rpc_oauth_callback(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}
    provider, code, state = data.get("provider"), data.get("code"), data.get("state")
    if not (provider and code and state):
        return rpc_error("unprocessable", "provider, code and state are required")

    async def run(session: AsyncSession) -> dict:
        result = await oauth.callback(
            session,
            provider,
            code,
            state,
            data.get("user_agent"),
            data.get("ip_address"),
            data.get("csrf"),
        )
        return result.model_dump(mode="json")

    return await _rpc_session(
        "oauth_callback", run, failure=f"OAuth authentication failed for {provider}"
    )


@broker.subscriber("rpc.identity.sso_exchange")
async def rpc_sso_exchange(data: dict, msg: RabbitMessage) -> dict:
    """Redeem a one-time SSO ticket (custom-domain OAuth callback handoff).

    Called by the custom domain's own frontend route -- never by the apex --
    after the callback returned `mode="ticket"`. The ticket is single-use
    (Redis GETDEL); a missing, expired, already-redeemed, or unknown ticket all
    look identical from here, as does a `guard` cookie that fails the
    browser-binding check (Task 10R fix 1).
    """
    data = data or {}
    ticket = data.get("ticket")
    if not ticket or not isinstance(ticket, str):
        return rpc_error("bad_request", "ticket is required")

    result = await oauth.sso_exchange(data.get("guard"), ticket)
    if result is None:
        return rpc_error("bad_request", "invalid or expired ticket")
    return rpc_ok(result)


@broker.subscriber("rpc.identity.oauth_link")
async def rpc_oauth_link(data: dict, msg: RabbitMessage) -> dict:
    """Custom-domain-aware account-link callback (Task 10R re-architecture).

    Unlike every OTHER authenticated RPC method here, a missing bearer is NOT
    rejected up front -- `oauth.link` decides whether one is required, branching
    on the signed OAuth state's origin: a platform-host link still requires a
    resolvable user, but a custom-domain link never does; it can only ever mint
    a single-use provider-identity ticket for a LIVE session on the custom
    domain itself to redeem later (`rpc.identity.link_complete`).

    A *present but invalid* access_token is treated the same as a missing one
    (best-effort resolution, mirroring the gateway's own fail-safe-to-anonymous
    posture for this route) so a stale platform cookie can never block an
    otherwise-valid custom-domain ticket issuance.
    """
    data = data or {}
    provider, code, state = data.get("provider"), data.get("code"), data.get("state")
    if not (provider and code and state):
        return rpc_error("unprocessable", "provider, code and state are required")
    access_token = data.get("access_token")

    async def run(session: AsyncSession) -> dict:
        user = None
        if access_token:
            try:
                user = await token_validation.resolve_active_user(session, access_token)
            except HTTPException:
                user = None
        result = await oauth.link(session, user, provider, code, state, data.get("csrf"))
        return result.model_dump(mode="json")

    return await _rpc_session("oauth_link", run)


@broker.subscriber("rpc.identity.link_complete")
async def rpc_link_complete(data: dict, msg: RabbitMessage) -> dict:
    """Redeem a pending-link ticket and attach its PROVIDER identity to the
    bearer-authenticated caller (step 6 of the Task 10R end-ticket flow).

    A bearer is mandatory here (SECURITY INVARIANT #4): this is the step that
    resolves the linked-to site account, and that resolution must come from
    nothing but the live session presented on THIS call. `guard` is the raw
    `owt_xdomain_guard` cookie; the redemption fails closed on a mismatch even
    though the bearer is valid.
    """
    data = data or {}
    ticket = data.get("ticket")
    guard = data.get("guard")

    async def op(session: AsyncSession, user: Any) -> dict:
        if not ticket or not isinstance(ticket, str):
            raise HTTPException(status_code=422, detail="ticket is required")
        return await oauth.link_complete(session, user, ticket, guard)

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.oauth_connections")
async def rpc_oauth_connections(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> list[dict]:
        conns = await oauth.connections_for(session, user)
        return [conn.model_dump(mode="json") for conn in conns]

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.oauth_unlink")
async def rpc_oauth_unlink(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}
    provider = data.get("provider")
    # Optional: target one specific connection when several of the same provider
    # are linked; omitted = unlink all connections for the provider.
    provider_user_id = data.get("provider_user_id")

    async def op(session: AsyncSession, user: Any) -> None:
        if not provider:
            raise HTTPException(status_code=400, detail="provider is required")
        await oauth.unlink(session, user, provider, provider_user_id=provider_user_id)

    return await _with_active_user(data.get("access_token"), op)


# --- API keys ---


@broker.subscriber("rpc.identity.list_api_keys")
async def rpc_list_api_keys(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        qp = build_query_model(schemas.ApiKeyListQueryParams, data.get("query"))
        params = schemas.ApiKeyListParams.from_query_params(qp)
        return _paginated_dump(await api_keys.list(session, user=user, params=params))

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.create_api_key")
async def rpc_create_api_key(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        payload = schemas.ApiKeyCreate.model_validate(data)
        result = await api_keys.create(
            session,
            user=user,
            payload=payload,
            ip_address=data.get("ip_address"),
            user_agent=data.get("user_agent"),
        )
        return result.model_dump(mode="json")

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.update_api_key")
async def rpc_update_api_key(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        payload = schemas.ApiKeyUpdate.model_validate(data)
        result = await api_keys.update(
            session,
            user=user,
            api_key_id=_require_int(data, "api_key_id"),
            payload=payload,
            ip_address=data.get("ip_address"),
            user_agent=data.get("user_agent"),
        )
        return result.model_dump(mode="json")

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.revoke_api_key")
async def rpc_revoke_api_key(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> None:
        await api_keys.revoke(
            session,
            user=user,
            api_key_id=_require_int(data, "api_key_id"),
            ip_address=data.get("ip_address"),
            user_agent=data.get("user_agent"),
        )

    return await _with_active_user(data.get("access_token"), op)


# --- RBAC admin ---
#
# Authed RPC methods resolve the active user from the gateway-injected bearer
# access_token via _with_active_user, then the admin services run the full
# permission checks, the exact 403/404 semantics, and the RBAC cache
# invalidation side effects.


@broker.subscriber("rpc.identity.rbac.list_permissions")
async def rpc_rbac_list_permissions(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        qp = build_query_model(schemas.PermissionListQueryParams, data.get("query"))
        params = schemas.PermissionListParams.from_query_params(qp)
        return _paginated_dump(await permission_admin.list(session, user, params))

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.create_permission")
async def rpc_rbac_create_permission(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        payload = schemas.PermissionCreate.model_validate(data)
        permission = await permission_admin.create(
            session, user, payload, ip_address=data.get("ip_address"), user_agent=data.get("user_agent")
        )
        return schemas.PermissionRead.model_validate(permission, from_attributes=True).model_dump(mode="json")

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.delete_permission")
async def rpc_rbac_delete_permission(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> None:
        await permission_admin.delete(
            session,
            user,
            _require_int(data, "permission_id"),
            ip_address=data.get("ip_address"),
            user_agent=data.get("user_agent"),
        )

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.list_roles")
async def rpc_rbac_list_roles(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        qp = build_query_model(schemas.RoleListQueryParams, data.get("query"))
        params = schemas.RoleListParams.from_query_params(qp)
        return _paginated_dump(await role_admin.list(session, user, params))

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.get_role")
async def rpc_rbac_get_role(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        role = await role_admin.get(session, user, _require_int(data, "role_id"))
        return schemas.RoleWithPermissions.model_validate(role, from_attributes=True).model_dump(mode="json")

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.create_role")
async def rpc_rbac_create_role(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        payload = schemas.RoleCreate.model_validate(data)
        role = await role_admin.create(
            session, user, payload, ip_address=data.get("ip_address"), user_agent=data.get("user_agent")
        )
        return schemas.RoleRead.model_validate(role, from_attributes=True).model_dump(mode="json")

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.update_role")
async def rpc_rbac_update_role(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        payload = schemas.RoleUpdate.model_validate(data)
        role = await role_admin.update(
            session,
            user,
            _require_int(data, "role_id"),
            payload,
            ip_address=data.get("ip_address"),
            user_agent=data.get("user_agent"),
        )
        return schemas.RoleRead.model_validate(role, from_attributes=True).model_dump(mode="json")

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.delete_role")
async def rpc_rbac_delete_role(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> None:
        await role_admin.delete(
            session,
            user,
            _require_int(data, "role_id"),
            ip_address=data.get("ip_address"),
            user_agent=data.get("user_agent"),
        )

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.list_auth_users")
async def rpc_rbac_list_auth_users(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        qp = build_query_model(schemas.AuthUserListQueryParams, data.get("query"))
        params = schemas.AuthUserListParams.from_query_params(qp)
        return _paginated_dump(await auth_user_admin.list(session, user, params))

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.get_auth_user")
async def rpc_rbac_get_auth_user(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        detail = await auth_user_admin.get(session, user, _require_int(data, "user_id"))
        return detail.model_dump(mode="json")

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.assign_linked_player")
async def rpc_rbac_assign_linked_player(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> None:
        user_id = _require_int(data, "user_id")
        payload = schemas.AuthUserPlayerLinkAssign.model_validate(data)
        await auth_user_admin.assign_linked_player(
            session, user, user_id, payload, ip_address=data.get("ip_address"), user_agent=data.get("user_agent")
        )

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.remove_linked_player")
async def rpc_rbac_remove_linked_player(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> None:
        await auth_user_admin.remove_linked_player(
            session,
            user,
            _require_int(data, "user_id"),
            _require_int(data, "player_id"),
            ip_address=data.get("ip_address"),
            user_agent=data.get("user_agent"),
        )

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.delete_auth_user")
async def rpc_rbac_delete_auth_user(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> None:
        await auth_user_admin.delete(
            session,
            user,
            _require_int(data, "user_id"),
            ip_address=data.get("ip_address"),
            user_agent=data.get("user_agent"),
        )

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.assign_role")
async def rpc_rbac_assign_role(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> None:
        payload = schemas.UserRoleAssign.model_validate(data)
        await role_admin.assign_to_user(
            session, user, payload, ip_address=data.get("ip_address"), user_agent=data.get("user_agent")
        )

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.remove_role")
async def rpc_rbac_remove_role(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> None:
        payload = schemas.UserRoleRemove.model_validate(data)
        await role_admin.remove_from_user(
            session, user, payload, ip_address=data.get("ip_address"), user_agent=data.get("user_agent")
        )

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.get_user_roles")
async def rpc_rbac_get_user_roles(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> list[dict]:
        roles = await role_admin.user_roles(session, user, _require_int(data, "user_id"))
        return [schemas.RoleRead.model_validate(r, from_attributes=True).model_dump(mode="json") for r in roles]

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.list_user_denies")
async def rpc_rbac_list_user_denies(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> list[dict]:
        return await permission_denies.list(session, user, _require_int(data, "user_id"))

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.add_user_deny")
async def rpc_rbac_add_user_deny(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> list[dict]:
        user_id = _opt_int(data, "user_id")
        permission_id = _opt_int(data, "permission_id")
        if user_id is None or permission_id is None:
            raise HTTPException(status_code=422, detail="user_id and permission_id are required")
        return await permission_denies.add(
            session,
            user,
            user_id,
            permission_id,
            reason=data.get("reason"),
            workspace_id=_opt_int(data, "workspace_id"),
            ip_address=data.get("ip_address"),
            user_agent=data.get("user_agent"),
        )

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.remove_user_deny")
async def rpc_rbac_remove_user_deny(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> list[dict]:
        user_id = _opt_int(data, "user_id")
        permission_id = _opt_int(data, "permission_id")
        if user_id is None or permission_id is None:
            raise HTTPException(status_code=422, detail="user_id and permission_id are required")
        return await permission_denies.remove(
            session,
            user,
            user_id,
            permission_id,
            workspace_id=_opt_int(data, "workspace_id"),
            ip_address=data.get("ip_address"),
            user_agent=data.get("user_agent"),
        )

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.list_oauth_connections")
async def rpc_rbac_list_oauth_connections(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        qp = build_query_model(schemas.OAuthConnectionListQueryParams, data.get("query"))
        params = schemas.OAuthConnectionListParams.from_query_params(qp)
        return _paginated_dump(await auth_user_admin.list_oauth_connections(session, user, params))

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.list_sessions")
async def rpc_rbac_list_sessions(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        qp = build_query_model(schemas.SessionListQueryParams, data.get("query"))
        params = schemas.SessionListParams.from_query_params(qp)
        return _paginated_dump(await session_admin.list_auth_sessions(session, user, params))

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.rbac.delete_oauth_connection")
async def rpc_rbac_delete_oauth_connection(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> None:
        await auth_user_admin.delete_oauth_connection(
            session,
            user,
            _require_int(data, "connection_id"),
            ip_address=data.get("ip_address"),
            user_agent=data.get("user_agent"),
        )

    return await _with_active_user(data.get("access_token"), op)


# --- Player linking ---


@broker.subscriber("rpc.identity.player.link")
async def rpc_player_link(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        payload = schemas.PlayerLinkRequest.model_validate(data)
        result = await players.link_and_describe(session, user, payload)
        return result.model_dump(mode="json")

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.player.unlink")
async def rpc_player_unlink(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> None:
        await players.unlink(session, user, _require_int(data, "player_id"))

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.player.linked")
async def rpc_player_linked(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> list[dict]:
        linked = await players.linked_payload(session, user)
        return [player.model_dump(mode="json") for player in linked]

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.player.set_primary")
async def rpc_player_set_primary(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        return await players.confirm_primary(session, user, _require_int(data, "player_id"))

    return await _with_active_user(data.get("access_token"), op)


# --- Current-user avatar ---


@broker.subscriber("rpc.identity.me.avatar_set")
async def rpc_me_avatar_set(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        if user.is_denied("account", "avatar"):
            raise HTTPException(status_code=403, detail="You are not allowed to change your avatar")
        raw = data.get("content_b64")
        if not isinstance(raw, str) or not raw:
            raise HTTPException(status_code=422, detail="content_b64 is required")
        try:
            file_data = base64.b64decode(raw)
        except (ValueError, TypeError) as exc:
            raise HTTPException(status_code=400, detail="invalid base64 content") from exc
        content_type = data.get("content_type")
        updated = await avatars.set(
            session,
            user,
            s3_client,
            file_data,
            content_type if isinstance(content_type, str) else "application/octet-stream",
        )
        return schemas.AuthUser.model_validate(updated, from_attributes=True).model_dump(mode="json")

    return await _with_active_user(data.get("access_token"), op)


@broker.subscriber("rpc.identity.me.avatar_delete")
async def rpc_me_avatar_delete(data: dict, msg: RabbitMessage) -> dict:
    data = data or {}

    async def op(session: AsyncSession, user: Any) -> dict:
        if user.is_denied("account", "avatar"):
            raise HTTPException(status_code=403, detail="You are not allowed to change your avatar")
        updated = await avatars.delete(session, user, s3_client)
        return schemas.AuthUser.model_validate(updated, from_attributes=True).model_dump(mode="json")

    return await _with_active_user(data.get("access_token"), op)
