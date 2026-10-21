from pydantic import RedisDsn

from shared.core.config import BaseServiceSettings
from src.tools.healthcheck import DEFAULT_HEARTBEAT_PATH


class Settings(BaseServiceSettings):
    # Discord Bot
    discord_token: str

    # Redis: the realtime rail's publish transport, wired in main.py via
    # configure_realtime(). Required — without it emit() drops every event.
    redis_url: RedisDsn

    # The site every card links to (mix board, tournament pages, notification
    # settings) and the base of an encounter's OpenGraph picture.
    public_site_url: str = "http://localhost:3000"

    # RabbitMQ (optional)
    rabbitmq_url: str | None = None

    # Liveness: where GatewayWatchdog records a live gateway session and how
    # long the session may stay down before the process exits so Docker
    # restarts it. The path's default lives in the probe that reads the file
    # back (`python -m src.tools.healthcheck`), which stays free of this module
    # so a config problem can never be reported as a dead gateway session.
    gateway_heartbeat_path: str = DEFAULT_HEARTBEAT_PATH
    gateway_unready_timeout_seconds: float = 300.0

    # Logging overrides
    logs_celery_root_path: str = ""

    @property
    def broker_url(self) -> str | None:
        return self.rabbitmq_url


settings = Settings()
