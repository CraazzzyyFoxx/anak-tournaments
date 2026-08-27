"""Slug generation for the public tournament URL (``/tournaments/{slug}``).

The slug is generated once from ``Tournament.name`` at creation and frozen
afterward (see ``shared.models.tournament.tournament.Tournament.slug``); an
explicit admin rename goes through ``TournamentRepository`` and writes the old
value to ``TournamentSlugRedirect`` so links already shared keep resolving.

Uniqueness is GLOBAL (not per-workspace): the public tournament route carries
no workspace segment, so two organizers' "season-1" would otherwise collide.
"""

from __future__ import annotations

import re

from sqlalchemy.ext.asyncio import AsyncSession

from shared.repository.tournament import TournamentRepository

__all__ = ("slugify", "generate_unique_tournament_slug")

# Common practical Cyrillic -> Latin transliteration (not GOST-strict, just
# readable): tournament names in this community are frequently Russian, and a
# plain ASCII-strip would collapse most of them to nothing.
_CYRILLIC_MAP = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "",
    "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}

_NON_SLUG_CHARS = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    """Lowercase, transliterate Cyrillic, and hyphenate; ``"tournament"`` if empty."""
    transliterated = "".join(_CYRILLIC_MAP.get(ch, ch) for ch in text.lower())
    slug = _NON_SLUG_CHARS.sub("-", transliterated).strip("-")
    return slug or "tournament"


async def generate_unique_tournament_slug(
    session: AsyncSession,
    name: str,
    *,
    tournament_repo: TournamentRepository,
) -> str:
    """``slugify(name)``, disambiguated with a ``-2``, ``-3``, ... suffix on collision."""
    base = slugify(name)
    candidate = base
    suffix = 2
    while await tournament_repo.get_by_slug(session, candidate) is not None:
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate
