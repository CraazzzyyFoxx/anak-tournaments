"""Training-device helpers for ML models.

The service should train faster on GPU-capable machines, but it must remain
portable on ordinary CPU-only developer boxes and production workers. These
helpers map ``ML_TRAIN_DEVICE`` to ordered fallback candidates; the library
constructor parameters for one candidate belong to the module trainer that
builds the estimator.
"""

from __future__ import annotations

from shared.domain.analytics import MLTrainDevice
from src.core.config import settings

__all__ = (
    "MLTrainDevice",
    "lightgbm_devices",
    "xgboost_devices",
)


def _configured_device() -> str:
    return str(getattr(settings, "ml_train_device", "auto") or "auto").lower()


def _fallback_enabled() -> bool:
    return bool(getattr(settings, "ml_gpu_fallback", True))


def lightgbm_devices() -> tuple[MLTrainDevice, ...]:
    """Return LightGBM device candidates in the order they should be tried."""
    configured = _configured_device()
    fallback = _fallback_enabled()
    if configured == "cpu":
        return ("cpu",)
    if configured == "cuda":
        return ("cuda", "cpu") if fallback else ("cuda",)
    if configured == "gpu":
        return ("gpu", "cpu") if fallback else ("gpu",)
    # ``auto``: CUDA is fastest when available, OpenCL GPU is broader, CPU is
    # guaranteed. The fallback path handles CPU-only LightGBM wheels.
    return ("cuda", "gpu", "cpu") if fallback else ("cuda",)


def xgboost_devices() -> tuple[MLTrainDevice, ...]:
    """Return XGBoost device candidates in the order they should be tried."""
    configured = _configured_device()
    fallback = _fallback_enabled()
    if configured == "cpu":
        return ("cpu",)
    # XGBoost's modern GPU backend is CUDA. Treat ``gpu`` as a user-friendly
    # alias so one env var works across LightGBM and XGBoost.
    return ("cuda", "cpu") if fallback else ("cuda",)
