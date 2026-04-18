import logging
import sys
import traceback
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_FILE_PATH = Path(".local") / "temp.log"

_DEF_FORMAT = "[%(asctime)s] %(levelname)s %(name)s:%(lineno)d %(message)s"
_DEF_DATEFMT = "%Y-%m-%d %H:%M:%S"

_configured = False


def _log_unhandled_exception(exc_type, exc_value, exc_tb):
    logger = logging.getLogger("UNCAUGHT")
    formatted_tb = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
    logger.error("Uncaught exception with traceback:\n%s", formatted_tb)


def setup_logging(level: int = logging.INFO):
    global _configured
    if _configured:
        return
    LOG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger()
    root.setLevel(level)

    # Remove default handlers that may be present
    for h in list(root.handlers):
        root.removeHandler(h)

    formatter = logging.Formatter(_DEF_FORMAT, _DEF_DATEFMT)

    # Console handler
    ch = logging.StreamHandler()
    ch.setLevel(level)
    ch.setFormatter(formatter)
    root.addHandler(ch)

    fh = RotatingFileHandler(
        LOG_FILE_PATH, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    fh.setLevel(level)
    fh.setFormatter(formatter)
    root.addHandler(fh)

    # Install global exception hook for traceback logging
    sys.excepthook = _log_unhandled_exception

    logging.getLogger(__name__).info("Logging initialized. File=%s", LOG_FILE_PATH.resolve())
    _configured = True


__all__ = ["setup_logging", "LOG_FILE_PATH"]
