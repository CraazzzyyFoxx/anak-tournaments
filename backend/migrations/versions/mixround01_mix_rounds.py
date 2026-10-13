"""Mix rounds on the encounter layer (V2, D71-D79).

An encounter is owned by a tournament OR a pickup mix (``custom_game_id``); each mix gets a discipline and its
own ``wins`` rule; ``balancer.mix_round`` / ``balancer.mix_round_member`` hold what only the balancer reads.
The data half moves every ``casual.match`` across; ``casual.*`` itself stays until the gated ``mixround02``.

``'host'`` is added to ``encounter.encountergameresultsource`` in its own committed transaction first:
PostgreSQL forbids using a label in the transaction that added it. Forward-fix only.

Revision ID: mixround01
Revises: enclayer02
"""

from __future__ import annotations

import time
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.exc import OperationalError

revision: str = "mixround01"
down_revision: str | Sequence[str] | None = "enclayer02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RETRYABLE_SQLSTATES = frozenset({"55P03", "40P01"})
LOCK_TIMEOUT = "3s"
LOCK_ATTEMPTS = 40
LOCK_BACKOFF_SECONDS = 6.0
#: Copied, not imported: a migration keeps meaning what it meant when it ran.
WINS_END_FORMULA = "games >= best_of or max_wins * 2 > best_of"
#: Altered tables, plus ``casual.*`` so the old image cannot record a round mid-move.
_EXCLUSIVE = (
    "encounter.encounter, encounter.team, balancer.custom_game, balancer.custom_game_team_name, "
    "casual.match, casual.team, casual.player, casual.match_busy_player"
)


def _take_locks() -> None:
    """Every lock first, retrying past busy readers (``enclayer01``/``bsplit02``)."""
    bind = op.get_bind()
    bind.execute(sa.text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
    for attempt in range(1, LOCK_ATTEMPTS + 1):
        savepoint = bind.begin_nested()
        try:
            bind.execute(sa.text(f"LOCK TABLE {_EXCLUSIVE} IN ACCESS EXCLUSIVE MODE"))
        except OperationalError as exc:
            savepoint.rollback()
            if getattr(exc.orig, "sqlstate", None) not in RETRYABLE_SQLSTATES or attempt == LOCK_ATTEMPTS:
                raise
            time.sleep(LOCK_BACKOFF_SECONDS)
        else:
            savepoint.commit()
            return


_SCHEMA = (
    """
    ALTER TABLE balancer.custom_game
      ADD COLUMN discipline VARCHAR(32) NOT NULL DEFAULT 'overwatch'
        CONSTRAINT fk_custom_game_discipline REFERENCES catalog.discipline (code),
      ADD COLUMN scoring_rule_id BIGINT,
      ADD CONSTRAINT uq_custom_game_owner_key UNIQUE (id, workspace_id, discipline)
    """,
    # One wins rule per existing mix. nextval in the select list runs after ORDER BY (PG >= 9.6).
    """
    CREATE TEMP TABLE mixround01_rule ON COMMIT DROP AS
    SELECT g.id AS custom_game_id, g.workspace_id,
           nextval(pg_get_serial_sequence('encounter.scoring_rule', 'id')) AS rule_id
      FROM balancer.custom_game g ORDER BY g.id
    """,
    f"""
    INSERT INTO encounter.scoring_rule (id, workspace_id, preset, game_formula, end_formula)
    SELECT rule_id, workspace_id, 'wins', 'win', '{WINS_END_FORMULA}' FROM mixround01_rule
    """,
    "UPDATE balancer.custom_game g SET scoring_rule_id = r.rule_id FROM mixround01_rule r WHERE r.custom_game_id = g.id",
    """
    ALTER TABLE balancer.custom_game
      ALTER COLUMN scoring_rule_id SET NOT NULL,
      ADD CONSTRAINT fk_custom_game_scoring_rule FOREIGN KEY (scoring_rule_id, workspace_id)
        REFERENCES encounter.scoring_rule (id, workspace_id) DEFERRABLE INITIALLY DEFERRED
    """,
    """
    ALTER TABLE balancer.custom_game_team_name
      DROP CONSTRAINT ck_custom_game_team_name_index,
      ADD CONSTRAINT ck_custom_game_team_name_index CHECK (team_index BETWEEN 0 AND 11)
    """,
    """
    ALTER TABLE encounter.encounter
      ALTER COLUMN tournament_id DROP NOT NULL,
      ADD COLUMN custom_game_id BIGINT,
      DROP CONSTRAINT ck_encounter_result_source,
      ADD CONSTRAINT ck_encounter_result_source
        CHECK (result_source IN ('games', 'series_claim', 'admin', 'import', 'host')),
      ADD CONSTRAINT ck_encounter_owner CHECK (num_nonnulls(tournament_id, custom_game_id) = 1),
      ADD CONSTRAINT fk_encounter_custom_game FOREIGN KEY (custom_game_id, workspace_id, discipline)
        REFERENCES balancer.custom_game (id, workspace_id, discipline) ON DELETE CASCADE
    """,
    "CREATE INDEX ix_encounter_custom_game_id ON encounter.encounter (custom_game_id)",
    "ALTER TABLE encounter.team ALTER COLUMN tournament_id DROP NOT NULL",
    """
    CREATE TABLE balancer.mix_round (
      encounter_id           BIGINT PRIMARY KEY
        CONSTRAINT fk_mix_round_encounter REFERENCES encounter.encounter (id) ON DELETE CASCADE,
      lobby_index            INTEGER NOT NULL,
      points_per_win_applied INTEGER,
      CONSTRAINT ck_mix_round_lobby_index CHECK (lobby_index BETWEEN 0 AND 5)
    )
    """,
    """
    CREATE TABLE balancer.mix_round_member (
      encounter_id        BIGINT NOT NULL
        CONSTRAINT fk_mix_round_member_round REFERENCES balancer.mix_round (encounter_id) ON DELETE CASCADE,
      workspace_member_id BIGINT NOT NULL
        CONSTRAINT fk_mix_round_member_workspace_member REFERENCES workspace_member (id) DEFERRABLE INITIALLY DEFERRED,
      busy                BOOLEAN NOT NULL,
      rank_delta_applied  INTEGER,
      PRIMARY KEY (encounter_id, workspace_member_id),
      CONSTRAINT ck_mix_round_member_busy CHECK (NOT busy OR rank_delta_applied IS NULL)
    )
    """,
    "CREATE INDEX ix_mix_round_member_workspace_member_id ON balancer.mix_round_member (workspace_member_id)",
)


def upgrade() -> None:
    # Anything that must run in the same transaction as the earlier revisions of this ``upgrade head`` goes ABOVE
    # this block: ``autocommit_block`` commits everything before it.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE encounter.encountergameresultsource ADD VALUE IF NOT EXISTS 'host'")
    _take_locks()
    for statement in _SCHEMA:
        op.execute(statement)


def downgrade() -> None:
    raise RuntimeError("mixround01 is forward-fix only; restore from a backup to go back")
