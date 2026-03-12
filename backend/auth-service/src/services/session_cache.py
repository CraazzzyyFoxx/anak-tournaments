"""Redis-backed RBAC cache for instant role/permission propagation."""

import json

from loguru import logger

from src.core.redis import get_redis

RBAC_KEY_PREFIX = "rbac:user:"
RBAC_TTL_SECONDS = 60


def _key(user_id: int) -> str:
    return f"{RBAC_KEY_PREFIX}{user_id}"


async def get_rbac(user_id: int) -> dict | None:
    """Return cached RBAC payload or None on miss."""
    redis = get_redis()
    raw = await redis.get(_key(user_id))
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        logger.warning(f"Corrupted RBAC cache for user {user_id}, evicting")
        await redis.delete(_key(user_id))
        return None


async def set_rbac(user_id: int, roles: list[str], permissions: list[str]) -> None:
    """Store RBAC data with TTL."""
    redis = get_redis()
    payload = json.dumps({"roles": roles, "permissions": permissions})
    await redis.set(_key(user_id), payload, ex=RBAC_TTL_SECONDS)


async def invalidate_rbac(user_id: int) -> None:
    """Immediately remove cached RBAC for a user."""
    redis = get_redis()
    await redis.delete(_key(user_id))
    logger.info(f"RBAC cache invalidated for user {user_id}")
