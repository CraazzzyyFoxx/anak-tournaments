from pydantic import RedisDsn

from shared.core.config import BaseServiceSettings


class Settings(BaseServiceSettings):
    redis_url: RedisDsn
    # No default: a missing RABBITMQ_URL must fail at startup rather than fall
    # back to insecure ``guest:guest`` credentials.
    rabbitmq_url: str

    @property
    def api_cache_url(self):
        return f"{self.redis_url}/3"

    @property
    def backend_cache_url(self):
        return f"{self.redis_url}/4"


settings = Settings()
