"""Pure hero-alias merge logic. Zero session, zero await — see
``backend/ARCHITECTURE.md``'s ``domain/`` boundary.
"""

from __future__ import annotations

import typing

__all__ = ("merge_aliases",)


def merge_aliases(*, existing: typing.Iterable[str], localized: typing.Iterable[str], canonical: str) -> list[str]:
    """Union of the stored and the localized names, minus the canonical one.

    ponytail: only ever adds, never removes — an alias carries no provenance, so
    the sync cannot tell its own stale entry from a hand-added one. When OverFast
    renames a hero, the stale alias is dropped through the admin UI.
    """
    return sorted({*existing, *localized} - {canonical})
