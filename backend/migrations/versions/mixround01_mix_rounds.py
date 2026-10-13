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

#: Questions the data must answer before anything moves; a non-empty answer stops the revision (D79).
#: Kept text for text in backend/scripts/mixround01_preflight.sql (tests/test_mixround01_preflight_sql.py).
PREFLIGHT: tuple[tuple[str, str], ...] = (
    (
        "one workspace member sits on two seats of one round",
        """
        SELECT t.match_id, p.workspace_member_id, array_agg(p.id ORDER BY p.id) AS player_ids
          FROM casual.player p JOIN casual.team t ON t.id = p.team_id
         WHERE p.workspace_member_id IS NOT NULL
         GROUP BY t.match_id, p.workspace_member_id
        HAVING count(*) > 1
         ORDER BY t.match_id, p.workspace_member_id
        """,
    ),
    (
        "round does not have exactly two teams",
        """
        SELECT m.id AS match_id, count(t.id) AS teams
          FROM casual.match m LEFT JOIN casual.team t ON t.match_id = m.id
         GROUP BY m.id
        HAVING count(t.id) <> 2
         ORDER BY m.id
        """,
    ),
)
#: Not a stop: seats whose member left (FK nulled) have no anchor in encounter.team_member and are dropped.
SEATS_WITHOUT_MEMBER = "SELECT count(*) AS seats_without_member FROM casual.player WHERE workspace_member_id IS NULL"
PREFLIGHT_SAMPLE = 20


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


def _preflight() -> None:
    bind = op.get_bind()
    failures: list[str] = []
    for question, query in PREFLIGHT:
        rows = bind.execute(sa.text(query)).mappings().all()
        if rows:
            sample = "; ".join(str(dict(row)) for row in rows[:PREFLIGHT_SAMPLE])
            rest = len(rows) - PREFLIGHT_SAMPLE
            failures.append(f"{question} [{len(rows)}]: {sample}" + (f"; … {rest} more" if rest > 0 else ""))
    if failures:
        raise RuntimeError("mixround01 pre-flight failed; resolve these rows by hand first:\n" + "\n".join(failures))


# Set-based; nextval in an ordered select list keeps ids in recording order.
_BACKFILL = (
    """
    CREATE TEMP TABLE mixround01_round ON COMMIT DROP AS
    SELECT m.id AS match_id, nextval(pg_get_serial_sequence('encounter.encounter', 'id')) AS encounter_id
      FROM casual.match m ORDER BY m.id
    """,
    """
    CREATE TEMP TABLE mixround01_side ON COMMIT DROP AS
    SELECT t.id AS casual_team_id, r.encounter_id, t.name,
           CASE t.side WHEN 'home' THEN 1 ELSE 2 END AS slot,
           t.score AS raw_score,
           CASE WHEN t.score > o.score THEN 1 ELSE 0 END AS wins,
           CASE WHEN t.score < o.score THEN 2 ELSE 1 END AS placement,
           nextval(pg_get_serial_sequence('encounter.team', 'id')) AS encounter_team_id
      FROM casual.team t
      JOIN casual.team o ON o.match_id = t.match_id AND o.id <> t.id
      JOIN mixround01_round r ON r.match_id = t.match_id
     ORDER BY t.id
    """,
    """
    CREATE TEMP TABLE mixround01_seat ON COMMIT DROP AS
    SELECT p.id AS casual_player_id, s.encounter_id, s.encounter_team_id,
           nextval(pg_get_serial_sequence('encounter.team_member', 'id')) AS team_member_id
      FROM casual.player p JOIN mixround01_side s ON s.casual_team_id = p.team_id
     WHERE p.workspace_member_id IS NOT NULL
     ORDER BY p.id
    """,
    """
    INSERT INTO encounter.encounter
           (id, created_at, updated_at, workspace_id, discipline, tournament_id, custom_game_id, scoring_rule_id,
            name, slot_count, best_of, status, result_status, result_source, result_version, confirmed_at)
    SELECT r.encounter_id, m.created_at, m.updated_at, g.workspace_id, g.discipline, NULL, g.id, g.scoring_rule_id,
           a.name || ' vs ' || b.name, 2, 1, 'COMPLETED', 'confirmed', 'host', 1, m.created_at
      FROM mixround01_round r
      JOIN casual.match m ON m.id = r.match_id
      JOIN balancer.custom_game g ON g.id = m.custom_game_id
      JOIN mixround01_side a ON a.encounter_id = r.encounter_id AND a.slot = 1
      JOIN mixround01_side b ON b.encounter_id = r.encounter_id AND b.slot = 2
    """,
    """
    INSERT INTO encounter.team (id, created_at, encounter_id, tournament_id, slot, team_id, name, active, score, placement)
    SELECT s.encounter_team_id, e.created_at, s.encounter_id, NULL, s.slot, NULL, s.name, true, s.wins, s.placement
      FROM mixround01_side s JOIN encounter.encounter e ON e.id = s.encounter_id
    """,
    """
    INSERT INTO encounter.team_member
           (id, created_at, encounter_id, encounter_team_id, active, workspace_member_id, display_name_snapshot, rank, is_substitute)
    SELECT x.team_member_id, p.created_at, x.encounter_id, x.encounter_team_id, true, p.workspace_member_id,
           p.display_name_snapshot, p.rank, false
      FROM mixround01_seat x JOIN casual.player p ON p.id = x.casual_player_id
    """,
    """
    INSERT INTO encounter.team_member_role (team_member_id, dimension, role)
    SELECT x.team_member_id, 'player_role', p.role::text
      FROM mixround01_seat x JOIN casual.player p ON p.id = x.casual_player_id
     WHERE p.role IS NOT NULL
    """,
    """
    CREATE TEMP TABLE mixround01_game ON COMMIT DROP AS
    SELECT r.match_id, r.encounter_id, nextval(pg_get_serial_sequence('encounter.game', 'id')) AS game_id
      FROM mixround01_round r ORDER BY r.match_id
    """,
    """
    INSERT INTO encounter.game (id, created_at, encounter_id, position, map_id, state, result_source, result_version, confirmed_at)
    SELECT g.game_id, m.created_at, g.encounter_id, 1, m.map_id, 'confirmed', 'host', 1, m.created_at
      FROM mixround01_game g JOIN casual.match m ON m.id = g.match_id
    """,
    """
    INSERT INTO encounter.game_team (game_id, encounter_id, encounter_team_id, score, placement)
    SELECT g.game_id, s.encounter_id, s.encounter_team_id, s.raw_score, NULL
      FROM mixround01_game g JOIN mixround01_side s ON s.encounter_id = g.encounter_id
    """,
    """
    INSERT INTO encounter.result_audit
           (created_at, encounter_id, result_version, snapshot_scope, actor_user_id, action,
            from_result_status, to_result_status, "after", source)
    SELECT m.created_at, r.encounter_id, 1, 'encounter', u.id, 'confirm', 'none', 'confirmed',
           (SELECT jsonb_agg(jsonb_build_object('encounter_team_id', s.encounter_team_id,
                                                'score', s.wins::float8, 'placement', s.placement) ORDER BY s.slot)
              FROM mixround01_side s WHERE s.encounter_id = r.encounter_id),
           'host'
      FROM mixround01_round r
      JOIN casual.match m ON m.id = r.match_id
      LEFT JOIN players."user" u ON u.auth_user_id = m.recorded_by
    """,
    """
    INSERT INTO balancer.mix_round (encounter_id, lobby_index, points_per_win_applied)
    SELECT r.encounter_id, m.lobby_index, m.points_per_win_applied
      FROM mixround01_round r JOIN casual.match m ON m.id = r.match_id
    """,
    """
    INSERT INTO balancer.mix_round_member (encounter_id, workspace_member_id, busy, rank_delta_applied)
    SELECT x.encounter_id, p.workspace_member_id, false, p.rank_delta_applied
      FROM mixround01_seat x JOIN casual.player p ON p.id = x.casual_player_id
    """,
    # The seat wins: a busy row of a member seated in the same round is dropped (and reconciled).
    """
    INSERT INTO balancer.mix_round_member (encounter_id, workspace_member_id, busy)
    SELECT r.encounter_id, b.workspace_member_id, true
      FROM casual.match_busy_player b JOIN mixround01_round r ON r.match_id = b.match_id
     WHERE NOT EXISTS (SELECT 1 FROM balancer.mix_round_member rm
                        WHERE rm.encounter_id = r.encounter_id AND rm.workspace_member_id = b.workspace_member_id)
    """,
)


def upgrade() -> None:
    # First, in the transaction of the earlier revisions of this ``upgrade head``: a rejection must roll back
    # enclayer02's drop too, and ``autocommit_block`` below commits everything before it.
    _preflight()
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE encounter.encountergameresultsource ADD VALUE IF NOT EXISTS 'host'")
    _take_locks()
    for statement in (*_SCHEMA, *_BACKFILL):
        op.execute(statement)


def downgrade() -> None:
    raise RuntimeError("mixround01 is forward-fix only; restore from a backup to go back")
