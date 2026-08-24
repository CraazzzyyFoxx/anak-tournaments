"""Add ``registration.workspace_player_id`` and backfill from live registrations.

Revision ID: wsplyr02
Revises: wsplyr01
Create Date: 2026-08-24 00:00:00.000000

Groups live registrations by ``(workspace_id, battle_tag_normalized)``. Canon
rank is latest ``registration_role.updated_at`` per role. A registration whose
rank differs from that canon (or that was already pinned) stays pinned.
"""

from collections import defaultdict
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from shared.domain.workspace_player_backfill import (
    RegistrationBackfillRow,
    RoleBackfillRow,
    plan_backfill,
)

revision: str = "wsplyr02"
down_revision: str | Sequence[str] | None = "wsplyr01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_LOAD = """
SELECT
    r.id,
    t.workspace_id,
    r.battle_tag,
    r.battle_tag_normalized,
    r.display_name,
    wm.player_id,
    r.balancer_profile_overridden_at,
    r.submitted_at,
    r.updated_at,
    rr.role,
    rr.rank_value,
    rr.updated_at AS role_updated_at
FROM balancer.registration r
JOIN tournament.tournament t ON t.id = r.tournament_id
LEFT JOIN workspace_member wm ON wm.id = r.workspace_member_id
LEFT JOIN balancer.registration_role rr ON rr.registration_id = r.id
WHERE r.deleted_at IS NULL
"""


def _load_rows(conn) -> list[RegistrationBackfillRow]:
    grouped: dict[int, dict] = {}
    roles: dict[int, list[RoleBackfillRow]] = defaultdict(list)
    for row in conn.execute(sa.text(_LOAD)):
        grouped.setdefault(
            row.id,
            {
                "id": row.id,
                "workspace_id": row.workspace_id,
                "battle_tag": row.battle_tag,
                "battle_tag_normalized": row.battle_tag_normalized,
                "display_name": row.display_name,
                "player_id": row.player_id,
                "overridden_at": row.balancer_profile_overridden_at,
                "submitted_at": row.submitted_at,
                "updated_at": row.updated_at,
            },
        )
        if row.role is not None:
            roles[row.id].append(RoleBackfillRow(row.role, row.rank_value, row.role_updated_at))
    return [
        RegistrationBackfillRow(**payload, roles=tuple(roles.get(payload["id"], ())))
        for payload in grouped.values()
    ]


def _alloc_ids(conn, table: str, n: int) -> list[int]:
    if n == 0:
        return []
    lo = conn.execute(sa.text(f"SELECT COALESCE(MAX(id), 0) FROM balancer.{table}")).scalar()
    return list(range(lo + 1, lo + 1 + n))


def _apply(conn, plan) -> None:
    if not plan.players:
        return
    player_ids = _alloc_ids(conn, "workspace_player", len(plan.players))
    conn.execute(
        sa.text(
            """
            INSERT INTO balancer.workspace_player
                (id, workspace_id, battle_tag, battle_tag_normalized, display_name, player_id)
            VALUES
                (:id, :workspace_id, :battle_tag, :battle_tag_normalized, :display_name, :player_id)
            ON CONFLICT (workspace_id, battle_tag_normalized)
                WHERE battle_tag_normalized IS NOT NULL AND hidden_at IS NULL
            DO NOTHING
            """
        ),
        [
            {
                "id": pid,
                "workspace_id": player.workspace_id,
                "battle_tag": player.battle_tag,
                "battle_tag_normalized": player.battle_tag_normalized,
                "display_name": player.display_name,
                "player_id": player.player_id,
            }
            for pid, player in zip(player_ids, plan.players, strict=True)
        ],
    )
    lookup = {
        (row.workspace_id, row.battle_tag_normalized): row.id
        for row in conn.execute(
            sa.text(
                """
                SELECT id, workspace_id, battle_tag_normalized
                FROM balancer.workspace_player
                WHERE hidden_at IS NULL AND battle_tag_normalized IS NOT NULL
                """
            )
        )
    }
    rank_rows = []
    links = []
    for player in plan.players:
        wpid = lookup[(player.workspace_id, player.battle_tag_normalized)]
        for role, value in player.ranks.items():
            rank_rows.append({"workspace_player_id": wpid, "role": role, "rank_value": value})
        for rid in player.registration_ids:
            links.append({"id": rid, "workspace_player_id": wpid})
    rank_ids = _alloc_ids(conn, "workspace_player_rank", len(rank_rows))
    if rank_rows:
        conn.execute(
            sa.text(
                """
                INSERT INTO balancer.workspace_player_rank
                    (id, workspace_player_id, role, rank_value)
                VALUES
                    (:id, :workspace_player_id, :role, :rank_value)
                ON CONFLICT ON CONSTRAINT uq_workspace_player_rank DO NOTHING
                """
            ),
            [
                {"id": rid, **row}
                for rid, row in zip(rank_ids, rank_rows, strict=True)
            ],
        )
    if links:
        conn.execute(
            sa.text(
                "UPDATE balancer.registration SET workspace_player_id = :workspace_player_id WHERE id = :id"
            ),
            links,
        )
    if plan.pin_ids:
        conn.execute(
            sa.text(
                """
                UPDATE balancer.registration
                SET balancer_profile_overridden_at = now()
                WHERE id IN :ids AND balancer_profile_overridden_at IS NULL
                """
            ).bindparams(sa.bindparam("ids", expanding=True)),
            {"ids": list(plan.pin_ids)},
        )


def upgrade() -> None:
    op.add_column(
        "registration",
        sa.Column("workspace_player_id", sa.BigInteger(), nullable=True),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_registration_workspace_player_id"),
        "registration",
        ["workspace_player_id"],
        unique=False,
        schema="balancer",
    )
    op.create_foreign_key(
        "fk_balancer_registration_workspace_player_id",
        "registration",
        "workspace_player",
        ["workspace_player_id"],
        ["id"],
        source_schema="balancer",
        referent_schema="balancer",
        ondelete="SET NULL",
    )
    _apply(op.get_bind(), plan_backfill(_load_rows(op.get_bind())))


def downgrade() -> None:
    op.drop_constraint(
        "fk_balancer_registration_workspace_player_id",
        "registration",
        schema="balancer",
        type_="foreignkey",
    )
    op.drop_index(
        op.f("ix_balancer_registration_workspace_player_id"),
        table_name="registration",
        schema="balancer",
    )
    op.drop_column("registration", "workspace_player_id", schema="balancer")
