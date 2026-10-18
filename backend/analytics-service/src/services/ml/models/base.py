"""Artifact serialisation helpers for v2 models.

The concrete model classes, the ``MLModel`` protocol and ``align_features`` belong to the discipline's analytics module
(``shared.domain.analytics`` for the neutral contract). This module only stores and loads the whole object via
:mod:`joblib` (preferred over :mod:`pickle` for numpy array compactness).

Models are persisted as ``<algorithm_id>/<version>/<file>.joblib`` under the
``ANALYTICS_MODELS_DIR`` config setting.
"""

from __future__ import annotations

import os
import pickle
import tempfile
import typing
from pathlib import Path

import joblib

from src.core import config

__all__ = (
    "artifact_path",
    "save_artifact",
    "load_artifact",
    "ARTIFACT_UNAVAILABLE",
)

# A registry row whose file is gone or whose pickle still names a pre-conversion class path (module moved) is
# unusable; runners log it and fall back to their neutral result instead of failing the pass.
ARTIFACT_UNAVAILABLE = (FileNotFoundError, ModuleNotFoundError, pickle.UnpicklingError)


def artifact_path(algorithm_id: int, version: str, filename: str, *, root: str | None = None) -> Path:
    """Build the filesystem path for an artifact file.

    ``<ANALYTICS_MODELS_DIR>/<algorithm_id>/<version>/<filename>``.
    The directory is created on demand by :func:`save_artifact`.
    """
    base = Path(root or config.settings.analytics_models_dir)
    return base / str(algorithm_id) / version / filename


def save_artifact(obj: typing.Any, path: Path) -> str:
    """Atomically write ``obj`` to ``path`` via tmp+rename.

    Returns the storage URI to store in ``MLModelArtifact.storage_uri``
    (``file://`` scheme). Parent directories are created as needed.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        os.close(fd)
        joblib.dump(obj, tmp_path)
        os.replace(tmp_path, path)
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise
    return f"file://{path.as_posix()}"


def load_artifact(storage_uri: str) -> typing.Any:
    """Load an object previously saved via :func:`save_artifact`."""
    if storage_uri.startswith("file://"):
        return joblib.load(storage_uri.removeprefix("file://"))
    # Future: s3://, gs:// — implement when the storage backend changes.
    raise NotImplementedError(f"Unsupported storage scheme: {storage_uri}")
