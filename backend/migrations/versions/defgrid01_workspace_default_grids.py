"""Give every workspace its own division grid of each enabled game that has a native ladder.

Revision ID: defgrid01
Revises: owmapdrop01
Create Date: 2026-10-21 00:00:00.000000

The backfill twin of ``shared.services.division_grid.provisioning.provision_default_grids``, through the same rules
(``shared.domain.division_grid_defaults``). A workspace with no grid of an enabled game (archived ones count) gets one,
slug ``{game}-default`` (``-2``, ``-3``… when taken) and named after the game, whose published v1 is the game's native
ladder: one division per ladder rank. v1 becomes the game's explicit default unless the workspace already has one, or a
system grid of the game is in force: the backfill never moves a game already running off it (a new workspace or a game
enabled later may, with nothing played; see ``default_grid_plan``).

Downgrade is a no-op: from here on the grids are the workspace's own data, which tournaments may already pin.
"""

from collections import defaultdict
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from shared.disciplines import discipline
from shared.domain.division_grid_defaults import (
    TIER_FIELDS,
    default_grid_plan,
    default_version_label,
    native_ladder_tiers,
    unique_slug,
)

revision: str = "defgrid01"
down_revision: str | Sequence[str] | None = "owmapdrop01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INSERT_TIER = sa.text(
    f"INSERT INTO division_grid_tier (version_id, {', '.join(TIER_FIELDS)}) "
    f"VALUES (:version_id, {', '.join(f':{field}' for field in TIER_FIELDS)})"
)


def upgrade() -> None:
    bind = op.get_bind()
    slugs: dict[int, set[str]] = defaultdict(set)
    own: set[tuple[int, str]] = set()
    for workspace_id, code, slug in bind.execute(
        sa.text("SELECT workspace_id, discipline, slug FROM division_grid WHERE workspace_id IS NOT NULL")
    ):
        slugs[workspace_id].add(slug)
        own.add((workspace_id, code))
    explicit = {
        tuple(row)
        for row in bind.execute(sa.text("SELECT workspace_id, discipline FROM workspace_division_grid_default"))
    }
    system = set(
        bind.execute(
            sa.text(
                "SELECT DISTINCT g.discipline FROM division_grid g "
                "JOIN division_grid_version v ON v.grid_id = g.id WHERE g.workspace_id IS NULL"
            )
        ).scalars()
    )
    played = {
        tuple(row)
        for row in bind.execute(sa.text("SELECT DISTINCT workspace_id, discipline FROM tournament.tournament"))
    }
    for workspace_id, enabled in bind.execute(
        sa.text("SELECT id, disciplines_enabled FROM workspace ORDER BY id")
    ).all():
        for code in enabled:
            create, activate = default_grid_plan(
                has_ladder=bool(discipline(code).native_ladder),
                has_own_grid=(workspace_id, code) in own,
                has_explicit_default=(workspace_id, code) in explicit,
                has_system_grid=code in system,
                has_tournaments=(workspace_id, code) in played,
                fresh=False,
            )
            if not create:
                continue
            slug = unique_slug(f"{code}-default", slugs[workspace_id])
            slugs[workspace_id].add(slug)
            grid_id = bind.execute(
                sa.text(
                    "INSERT INTO division_grid (workspace_id, discipline, slug, name) "
                    "VALUES (:workspace_id, :discipline, :slug, :name) RETURNING id"
                ),
                {"workspace_id": workspace_id, "discipline": code, "slug": slug, "name": discipline(code).name},
            ).scalar_one()
            version_id = bind.execute(
                sa.text(
                    "INSERT INTO division_grid_version (grid_id, version, label, status, published_at) "
                    "VALUES (:grid_id, 1, :label, 'published', now()) RETURNING id"
                ),
                {"grid_id": grid_id, "label": default_version_label(code)},
            ).scalar_one()
            bind.execute(_INSERT_TIER, [{**tier, "version_id": version_id} for tier in native_ladder_tiers(code)])
            if activate:
                bind.execute(
                    sa.text(
                        "INSERT INTO workspace_division_grid_default (workspace_id, discipline, version_id) "
                        "VALUES (:workspace_id, :discipline, :version_id)"
                    ),
                    {"workspace_id": workspace_id, "discipline": code, "version_id": version_id},
                )


def downgrade() -> None:
    pass
