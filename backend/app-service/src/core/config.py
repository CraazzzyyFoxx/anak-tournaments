from pydantic import RedisDsn

from shared.core.config import BaseServiceSettings


class Settings(BaseServiceSettings):
    project_name: str = "Anak Tournaments API"
    project_url: str
    battle_tag_regex: str = r"([\w0-9]{2,12}#[0-9]{4,})"
    api_v1_str: str = "/api/v1"

    redis_url: RedisDsn
    rabbitmq_url: str = "amqp://guest:guest@rabbitmq:5672"

    # Cache TTLs
    users_cache_ttl: int = 60
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
