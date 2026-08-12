"""Normalisation of catalog alias lists, shared by every writer.

Aliases are the alternate names a match log may use for a hero, map or gamemode
(OverFast localisations for heroes, hand-written entries for maps and gamemodes).
Three admin services and the alias-attach RPC all write the same JSONB column, so
the cleaning rule lives here rather than being re-implemented — and re-diverged —
in each of them.

ponytail: cleaning is `strip` + drop-blank + exact-match dedupe, nothing more.
No casefold, no NFKC, no apostrophe unification: matching in the parser is exact
(`aliases @> '["…"]'`), so normalising on write without normalising on read would
only hide entries. Revisit when the alias-miss queue fills up with case variants.
"""

from __future__ import annotations

from collections.abc import Iterable

__all__ = ("normalize_aliases",)


def normalize_aliases(values: Iterable[str], *, canonical: str | None = None) -> list[str]:
    """Strip each value, drop blanks, dedupe preserving first-seen input order.

    ``canonical`` is the entity's own ``name``, and it is dropped when supplied:
    the lookup already matches on `name`, so storing it as an alias only
    duplicates the predicate. catalias0001 skips such pairs when seeding, and the
    write paths have to agree — production picked up `Assault -> ["Осада",
    "Assault"]` from an admin edit before this guard existed.
    """
    seen: dict[str, None] = {}
    for value in values:
        cleaned = value.strip()
        if cleaned and cleaned != canonical:
            seen.setdefault(cleaned, None)
    return list(seen)
