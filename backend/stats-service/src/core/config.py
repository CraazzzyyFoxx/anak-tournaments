from pydantic import RedisDsn, field_validator

from shared.core.config import BaseServiceSettings
from shared.disciplines import DISCIPLINES
from shared.disciplines.spec import DisciplineSpec


def select_disciplines(raw: str | None) -> tuple[DisciplineSpec, ...]:
    """The disciplines a stats process serves: ``STATS_DISCIPLINES`` (comma-separated installed codes), else every installed one.

    A configured value is never repaired: an empty list, an empty entry, a duplicate or a code nobody installed is an
    error, so a typo cannot silently drop a game's ingest queue.
    """
    if raw is None:
        return tuple(DISCIPLINES.values())
    codes = [code.strip() for code in raw.split(",")]
    if not all(codes):
        raise ValueError("STATS_DISCIPLINES must be a comma-separated list of discipline codes with no empty entry")
    duplicates = sorted({code for code in codes if codes.count(code) > 1})
    if duplicates:
        raise ValueError(f"STATS_DISCIPLINES lists {', '.join(duplicates)} more than once")
    unknown = [code for code in codes if code not in DISCIPLINES]
    if unknown:
        raise ValueError(
            f"STATS_DISCIPLINES names disciplines that are not installed: {', '.join(unknown)} "
            f"(installed: {', '.join(DISCIPLINES)})"
        )
    return tuple(DISCIPLINES[code] for code in codes)


class AppConfig(BaseServiceSettings):
    project_name: str = "OWT"
    debug: bool = False
    project_url: str
    port: int = 8002

    # Disciplines this deployment serves (see select_disciplines); the worker consumes one ingest queue per entry.
    stats_disciplines: str | None = None

    # Match-log ingestion safety caps (defense-in-depth against oversized or
    # adversarial logs; see review MEDIUM: match-logs uploaded/parsed without a
    # size limit). Enforced before base64-decode and before building the parsing
    # DataFrame.
    max_match_log_bytes: int = 25 * 1024 * 1024

    # Match-log stall recovery (src/services/match_logs/reaper.py). The
    # stats.ingest.<discipline> queues TTL messages after 5 minutes, so a record whose
    # event expired or whose worker died is only recoverable from the row.
    log_reaper_enabled: bool = True
    log_reaper_tick_seconds: int = 300
    # Must stay above the 5-minute queue TTL: inside that window a message can
    # still be waiting on a busy consumer, and requeueing would double-parse.
    log_reaper_pending_after_seconds: int = 900
    # A parse still running after this long has no live worker behind it.
    log_reaper_processing_after_seconds: int = 1800
    log_reaper_max_attempts: int = 5
    log_reaper_batch_size: int = 25
    # Failed logs (src/services/match_logs/retention.py) stay in S3 this long for
    # inspection/retry. Unfinished logs are deleted immediately instead.
    failed_log_retention_days: int = 14

    redis_url: RedisDsn

    # Subscription resolution credentials (Boosty asks discord-service over the broker)
    twitch_client_id: str | None = None

    # RabbitMQ
    rabbitmq_url: str | None = None

    # RabbitMQ Management API (for queue depth monitoring)
    rabbitmq_management_url: str = "http://rabbitmq:15672"
    rabbitmq_management_user: str = "guest"
    rabbitmq_management_password: str = "guest"

    @field_validator("stats_disciplines")
    @classmethod
    def _installed_disciplines(cls, value: str | None) -> str | None:
        select_disciplines(value)
        return value

    @property
    def selected_disciplines(self) -> tuple[DisciplineSpec, ...]:
        return select_disciplines(self.stats_disciplines)

    @property
    def broker_url(self):
        return self.rabbitmq_url


settings = AppConfig()
