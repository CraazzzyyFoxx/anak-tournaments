"""Draft / Preview / Live / Done — derived from a stage's flags.

``is_active`` / ``is_published`` / ``is_completed`` are the source of truth;
this module only names their combinations.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

__all__ = ("StageLifecycle", "stage_lifecycle")


class StageLifecycle(StrEnum):
    DRAFT = "draft"
    PREVIEW = "preview"
    LIVE = "live"
    DONE = "done"


def stage_lifecycle(stage: Any, *, has_encounters: bool) -> StageLifecycle:
    if getattr(stage, "is_completed", False):
        return StageLifecycle.DONE
    if getattr(stage, "is_published", False) or getattr(stage, "is_active", False):
        return StageLifecycle.LIVE
    if has_encounters:
        return StageLifecycle.PREVIEW
    return StageLifecycle.DRAFT
