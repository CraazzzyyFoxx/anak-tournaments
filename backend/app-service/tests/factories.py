"""Shared ``Workspace`` test-double builder for app-service.

``_make_workspace`` used to be hand-rolled per test module, each carrying only
the subset of ``Workspace`` fields its own service call reads. Centralized
here as the union of every field any current caller needs; unused fields on a
``SimpleNamespace`` are harmless, so one overridable builder covers every
caller without forcing them to restate fields they don't touch.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any


def make_workspace(**overrides: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "id": 7,
        "slug": "owt",
        "custom_domain": None,
        "custom_domain_verification_token": None,
        "custom_domain_verified_at": None,
        "discord_guild_id": None,
        "discord_guild_verified_at": None,
        "discord_guild_verified_by_auth_user_id": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)
