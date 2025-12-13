import sentry_sdk
from loguru import logger

from src.core import config


def configure_extensions() -> None:
    logger.info("Configuring extensions...")
    if config.settings.sentry_dsn:
        sentry_sdk.init(
            dsn=config.settings.sentry_dsn,
            environment=config.settings.environment,
            traces_sample_rate=1.0,
            profiles_sample_rate=1.0,
        )
