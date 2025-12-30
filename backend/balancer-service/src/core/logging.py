import logging
import sys
from pathlib import Path

from loguru import logger as loguru_logger

from src.core import config


class InterceptHandler(logging.Handler):
    def emit(self, record):
        # Get corresponding Loguru level if it exists.
        try:
            level = loguru_logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        # Find caller from where originated the logged message.
        frame, depth = sys._getframe(6), 6
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        loguru_logger.opt(depth=depth, exception=record.exc_info).log(
            level, record.getMessage()
        )


class APILogger:
    @classmethod
    def make_logger(cls):
        return cls.customize_logging(
            Path(f"{config.config.logs_root_path}/access.log"),
            level=config.config.log_level,
            rotation="1 day",
            retention="1 year",
            compression="gz",
            log_format=(
                "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
                "<level>{level: <8}</level> | "
                "<cyan>{name}</cyan> - <level>{message}</level>"
            ),
        )

    @classmethod
    def customize_logging(
        cls,
        filepath: Path,
        level: str,
        rotation: str,
        retention: str,
        compression: str,
        log_format: str,
    ):
        loguru_logger.remove()
        loguru_logger.add(
            sys.stderr,
            enqueue=True,
            backtrace=True,
            level=level.upper(),
            format=log_format,
        )
        loguru_logger.add(
            str(filepath),
            rotation=rotation,
            retention=retention,
            compression=compression,
            enqueue=True,
            backtrace=True,
            level=level.upper(),
            format=log_format,
        )

        intercept_handler = InterceptHandler()

        # Route standard `logging` through Loguru exactly once.
        # `force=True` prevents stacking handlers when modules are reloaded.
        logging.basicConfig(handlers=[intercept_handler], level=0, force=True)

        # Let these loggers bubble up to root (handled by intercept_handler).
        for _log in (
            "uvicorn",
            "uvicorn.error",
            "uvicorn.server",
            "uvicorn.lifespan",
            "uvicorn.lifespan.on",
            "fastapi",
            "celery",
            "sqlalchemy.engine.Engine",
        ):
            _logger = logging.getLogger(_log)
            _logger.handlers = []
            _logger.propagate = True

        # Suppress access logs (we already log requests via TimeMiddleware).
        for _log in ("uvicorn.access", "websockets.legacy.server"):
            _logger = logging.getLogger(_log)
            _logger.handlers = []
            _logger.propagate = False
        return loguru_logger


logger = APILogger.make_logger()
