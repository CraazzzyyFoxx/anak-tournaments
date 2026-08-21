"""Re-export of the shared battle-tag resolver.

The implementation moved to :mod:`shared.services.team_export.identity` — this
file and its parser-service twin were byte-identical copies. Kept as a re-export
so ``src.services.user`` import sites (and their tests) keep resolving.
"""

from __future__ import annotations

from shared.services.team_export.identity import find_users_by_battle_tags

__all__ = ("find_users_by_battle_tags",)
