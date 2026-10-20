from pydantic import RedisDsn

from shared.core.config import BaseServiceSettings


class Settings(BaseServiceSettings):
    project_name: str = "OWT API"
    project_url: str
    # Gateway mount prefix for app-service: tournament-service owns the bare
    # /api/v1 namespace, so app-service is carved out under /api/v1/core.
    api_v1_str: str = "/api/v1/core"

    redis_url: RedisDsn
    # No default: a missing RABBITMQ_URL must fail at startup rather than fall
    # back to insecure ``guest:guest`` credentials.
    rabbitmq_url: str
    # Same bot token discord-service runs on: the Discord pickers ask that
    # service first and only reach Discord's REST API themselves when it is down.
    discord_token: str | None = None

    # Absolute base of the public site, used to build the links notification
    # DMs and channel posts carry (``PUBLIC_SITE_URL``). Platform zone only:
    # the frontend mirrors the same value as ``NEXT_PUBLIC_SITE_URL``, and
    # links to a workspace's subdomain or custom domain are out of scope.
    public_site_url: str = "http://localhost:3000"

    # Cache TTLs
    # ``users_cache_ttl`` covers the *tournament-derived* /users/* read caches
    # (tournaments, tournament_stats, heroes, encounters, maps, teammates,
    # matches_summary, compare, ...). Their inputs only change on tournament
    # ingestion, whose tournament-resource ``CacheInvalidatedEvent`` broadly drops
    # every user_* key (see ``services.user_cache.tournament_user_cache_patterns``).
    # The TTL is just a safety net, aligned with the sibling read domains.
    users_cache_ttl: int = 60 * 5
    # ``user_profile`` is *identity-derived* (name/avatar/socials). App-side
    # profile edits invalidate it precisely (see services.user_cache), but
    # identity-service self-service avatar/name edits propagate to the player
    # WITHOUT a cross-service invalidation hook, so this TTL is the only bound on
    # that staleness. Kept short deliberately — do not fold it into
    # ``users_cache_ttl`` without wiring identity-service invalidation first.
    user_profile_cache_ttl: int = 60
    tournaments_cache_ttl: int = 60 * 5
    gamemodes_cache_ttl: int = 60 * 5
    maps_cache_ttl: int = 60 * 5
    heroes_cache_ttl: int = 60 * 5
    statistics_cache_ttl: int = 60 * 5
    teams_cache_ttl: int = 60 * 5
    encounters_cache_ttl: int = 60 * 5
    achievements_cache_ttl: int = 60 * 5

    @property
    def api_cache_url(self):
        return f"{self.redis_url}/3"

    @property
    def backend_cache_url(self):
        return f"{self.redis_url}/4"


settings = Settings()
