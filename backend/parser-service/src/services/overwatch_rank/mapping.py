"""Native OverFast division+tier -> integer rank_value mapping.

The default table is derived from :data:`shared.domain.ow_ladder.LADDER` — the
one place the ladder's shape is written down — so it cannot drift from the
division grid every service resolves ranks against. The mapping is configurable
at runtime via the ``parser.rank_mapping`` settings key: admin-provided entries
override individual cells of the default.

The native ``division``/``tier`` are always stored on the snapshot regardless, so
a mapping miss never loses source data, and a rebase of the ladder (see
``DEFAULT_RANK_MAPPING_VERSION``) can always be backfilled from them.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.domain import ow_ladder
from shared.schemas.settings import DEFAULT_RANK_MAPPING_VERSION
from shared.services import settings_provider

#: Lower bound (bottom tier) rank_value per native division.
DEFAULT_OW2_DIVISION_BASE = ow_ladder.ow_division_bases()

# Lookup key: (division_lowercase, tier) -> rank_value.
RankLookup = dict[tuple[str, int], int]


def build_default_lookup() -> RankLookup:
    return {
        (division, tier): ow_ladder.tier_rank_min(base, tier)
        for division, base in DEFAULT_OW2_DIVISION_BASE.items()
        for tier in range(1, ow_ladder.TIERS_PER_DIVISION + 1)
    }


def map_division_tier_to_rank_value(
    division: str | None,
    tier: int | None,
    lookup: RankLookup,
) -> int | None:
    """Resolve a native division+tier to an integer rank_value, or ``None``."""
    if not division or tier is None:
        return None
    return lookup.get((division.lower(), int(tier)))


async def get_rank_mapping(session: AsyncSession) -> tuple[RankLookup, str]:
    """Load the effective division+tier -> rank_value lookup and its version.

    Starts from the built-in default and overlays any admin-configured entries
    from ``parser.rank_mapping``. Returns ``(lookup, mapping_version)``; the
    version is recorded on each snapshot so a later mapping change is auditable.
    """
    config = await settings_provider.get_rank_mapping_config(session)
    lookup = build_default_lookup()
    for entry in config.entries:
        lookup[(entry.division.lower(), entry.tier)] = entry.rank_value
    version = config.version or DEFAULT_RANK_MAPPING_VERSION
    return lookup, version
