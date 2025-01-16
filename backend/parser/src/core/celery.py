import logging
import sys
from pathlib import Path

from celery import Celery
from celery.signals import after_setup_logger
from loguru import logger as loguru_logger

from src.core import config
from src.core import logging as custom_logging

celery = Celery(
    "aqt_parser",
    backend=config.app.celery_result_backend.unicode_string(),
    broker=config.app.celery_broker_url.unicode_string(),
    broker_connection_retry_on_startup=True,
    timezone="UTC",
    backend_transport_options={"global_prefix": "celery-result"},
)


@after_setup_logger.connect
def setup_logging(*args, **kwargs):
    loguru_logger.handlers = []
    loguru_logger.remove()
    loguru_logger.add(
        Path(f"{config.app.logs_celery_root_path}/worker.log"),
        rotation="1 day",
        retention="1 year",
        compression="gz",
        level="INFO",
    )
    loguru_logger.add(
        sys.stderr,
        enqueue=True,
        backtrace=True,
        level="INFO",
    )
    celery_logger = logging.getLogger("celery")
    celery_logger.handlers = [
        handler for handler in celery_logger.handlers if not isinstance(handler, custom_logging.InterceptHandler)
    ]
