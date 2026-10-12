"""Encounter layer: schema ``encounter``, participations, games, claims, reports.

Expand half of the V1 match-layer cutover (spec §13.3-§13.6). The existing
encounter tables MOVE -- ``ALTER TABLE … SET SCHEMA`` keeps every id, so
``/encounters/{id}``, the realtime topics and the seven external foreign keys of
§13.7 go on working -- and are reshaped in place around a participation
(``encounter.team``) instead of a home and an away side.

Nothing is dropped here. Every legacy column stays, made nullable where the new
row shape no longer writes it, unmapped from the ORM; ``enclayer02`` drops them
in the deploy after V1, as CONTRIBUTING requires for destructive migrations.

Constraints whose data has not been backfilled yet are added ``NOT VALID``: they
bind every new row immediately and are validated at the end of this same
revision, after the data half has run. ``downgrade()`` refuses: the move is
forward-fix only.

The data half (§13.8) runs in the same transaction: the pre-flight checks that
stop the revision rather than guess, then the backfill of every column added
here, then ``SET NOT NULL`` / ``VALIDATE CONSTRAINT``. Its converters are pure
and golden-tested from ``backend/tests/test_enclayer01_convert.py``, which is why
this module imports nothing from ``shared``: a migration has to keep meaning what
it meant on the day it ran. Lobby scores are NOT written here -- the level-2
formula runs in Python, in ``backend/scripts/enclayer01_recompute_lobbies.py``.

Revision ID: enclayer01
Revises: apikeysu01
"""

from __future__ import annotations

import json
import time
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.exc import OperationalError

# Annotated form on purpose: scripts/export_erd.py finds the chain's head with
# ``^revision:\s*str\s*=`` and silently skips a revision written any other way.
revision: str = "enclayer01"
down_revision: str | Sequence[str] | None = "apikeysu01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RETRYABLE_SQLSTATES = frozenset({"55P03", "40P01"})
LOCK_TIMEOUT = "3s"
LOCK_ATTEMPTS = 40
LOCK_BACKOFF_SECONDS = 6.0
#: Every table this revision ALTERS, which is every table it needs ACCESS
#: EXCLUSIVE on -- including the four ``matches.*`` tables whose team foreign
#: keys are rewritten at the end. Taking them all here, under the retry, is the
#: point: a lock upgraded mid-migration has no attempt left to give back, and a
#: 3s timeout against an unlocked 27M-row table aborts the whole revision.
_EXCLUSIVE = (
    "tournament.encounter, tournament.encounter_game, tournament.encounter_result_audit, "
    "tournament.encounter_room_event, tournament.encounter_link, tournament.pick_ban_session, "
    "tournament.pick_ban_entry, tournament.pick_ban_submission, "
    "tournament.tournament, tournament.team, tournament.stage, tournament.stage_item, workspace_member, "
    "matches.match, matches.statistics, matches.kill_feed, matches.event"
)
#: Only referenced by the new tables' foreign keys, never altered.
_REFERENCED = 'workspace, players."user"'


def _take_locks() -> None:
    """Take every lock this revision needs, before it changes anything.

    Each attempt is its own SAVEPOINT: a cancelled or deadlocked statement
    aborts the transaction alembic wraps the migration in, and rolling the
    savepoint back both restores that transaction and releases whatever locks
    the attempt did get. ``SET LOCAL`` is issued outside the savepoint so a
    rollback does not also roll back the timeout.
    """
    bind = op.get_bind()
    bind.execute(sa.text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
    for attempt in range(1, LOCK_ATTEMPTS + 1):
        savepoint = bind.begin_nested()
        try:
            bind.execute(sa.text(f"LOCK TABLE {_EXCLUSIVE} IN ACCESS EXCLUSIVE MODE"))
            bind.execute(sa.text(f"LOCK TABLE {_REFERENCED} IN SHARE ROW EXCLUSIVE MODE"))
        except OperationalError as exc:
            savepoint.rollback()
            if getattr(exc.orig, "sqlstate", None) not in RETRYABLE_SQLSTATES or attempt == LOCK_ATTEMPTS:
                raise
            time.sleep(LOCK_BACKOFF_SECONDS)
        else:
            savepoint.commit()
            return


# --------------------------------------------------------------------------- #
# 1. Schemas, the discipline stub, and the enum types the layer owns
# --------------------------------------------------------------------------- #

#: The nine types that belong to the match layer move WITH THEIR NAMES: pg keys
#: index predicates and column types on OIDs, so nothing that referenced them
#: needs rewriting. ``pickbanmode``/``pickbanfirstpickrule``/``pickbanrotation``
#: stay in ``tournament`` -- they describe a config, not a room.
_MOVED_TYPES = (
    "encounterstatus",
    "encounterresultstatus",
    "encountergamestate",
    "encountergameresultsource",
    "encounterresultauditaction",
    "pickbankind",
    "pickbanentrystatus",
    "pickbanseedsource",
    "pickbansessionstatus",
)

_SCHEMAS_AND_TYPES = (
    "CREATE SCHEMA encounter",
    "CREATE SCHEMA catalog",
    """
    CREATE TABLE catalog.discipline (
      code       VARCHAR(32) PRIMARY KEY,
      name       VARCHAR(64) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    # Seeded here, not in the data half: the ORM writes ``discipline`` from the
    # moment this revision lands, and the column's FK needs a row to point at.
    "INSERT INTO catalog.discipline (code, name) VALUES ('overwatch', 'Overwatch')",
    *(f"ALTER TYPE tournament.{name} SET SCHEMA encounter" for name in _MOVED_TYPES),
    "ALTER TYPE encounter.pickbanseedsource RENAME VALUE 'fallback_home' TO 'fallback_first_slot'",
    # Label only: nothing in this revision writes it (PostgreSQL forbids using a
    # value in the transaction that added it).
    "ALTER TYPE encounter.encounterresultauditaction ADD VALUE IF NOT EXISTS 'auto_pending'",
    "CREATE TYPE encounter.pickbanactor AS ENUM ('team', 'decider', 'admin', 'system')",
)


# --------------------------------------------------------------------------- #
# 2. The tables that move (ids preserved) and the three that are renamed
# --------------------------------------------------------------------------- #

_MOVE_TABLES = (
    *(
        f"ALTER TABLE tournament.{name} SET SCHEMA encounter"
        for name in (
            "encounter",
            "encounter_game",
            "encounter_result_audit",
            "encounter_room_event",
            "pick_ban_session",
            "pick_ban_entry",
            "pick_ban_submission",
        )
    ),
    "ALTER TABLE encounter.encounter_game RENAME TO game",
    "ALTER TABLE encounter.encounter_result_audit RENAME TO result_audit",
    "ALTER TABLE encounter.encounter_room_event RENAME TO room_event",
)


# --------------------------------------------------------------------------- #
# 3. Owner keys outside the layer (§13.5)
# --------------------------------------------------------------------------- #

_OWNER_KEYS = (
    # NOT NULL with a server default, so the owner key below can exist before
    # the data half writes anything: every tournament is Overwatch in V1.
    """
    ALTER TABLE tournament.tournament
      ADD COLUMN discipline VARCHAR(32) NOT NULL DEFAULT 'overwatch' REFERENCES catalog.discipline (code)
    """,
    "ALTER TABLE tournament.tournament ADD CONSTRAINT uq_tournament_owner_key UNIQUE (id, workspace_id, discipline)",
    "ALTER TABLE tournament.team ADD CONSTRAINT uq_team_id_tournament UNIQUE (id, tournament_id)",
    "ALTER TABLE tournament.stage ADD CONSTRAINT uq_stage_id_tournament UNIQUE (id, tournament_id)",
    "ALTER TABLE tournament.stage_item ADD CONSTRAINT uq_stage_item_id_stage UNIQUE (id, stage_id)",
    # Soft removal of a workspace member (D66): a roster snapshot is anchored on
    # the member row and must not lose it.
    "ALTER TABLE workspace_member ADD COLUMN removed_at TIMESTAMPTZ",
)


# --------------------------------------------------------------------------- #
# 4. New tables of the layer (§13.3)
# --------------------------------------------------------------------------- #

_NEW_TABLES = (
    # The composite targets the new tables point at, on the two tables that
    # moved rather than being created here.
    "ALTER TABLE encounter.encounter ADD CONSTRAINT uq_encounter_id_tournament UNIQUE (id, tournament_id)",
    "ALTER TABLE encounter.game ADD CONSTRAINT uq_game_id_encounter UNIQUE (id, encounter_id)",
    """
    CREATE TABLE encounter.scoring_rule (
      id               BIGSERIAL PRIMARY KEY,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ,
      workspace_id     BIGINT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
      preset           VARCHAR(16) NOT NULL,
      columns          JSONB NOT NULL DEFAULT '[]',
      placement_points FLOAT8[] NOT NULL DEFAULT '{}',
      game_formula     VARCHAR(500) NOT NULL,
      end_formula      VARCHAR(500) NOT NULL,
      CONSTRAINT uq_scoring_rule_id_workspace UNIQUE (id, workspace_id),
      CONSTRAINT ck_scoring_rule_preset CHECK (preset IN ('wins', 'points')),
      CONSTRAINT ck_scoring_rule_columns CHECK (jsonb_typeof(columns) = 'array')
    )
    """,
    # Nullable until the data half writes one rule per stage; SET NOT NULL is
    # part of the same revision, after the backfill.
    """
    ALTER TABLE tournament.stage
      ADD COLUMN scoring_rule_id BIGINT REFERENCES encounter.scoring_rule (id) DEFERRABLE INITIALLY DEFERRED
    """,
    """
    CREATE TABLE encounter.team (
      id            BIGSERIAL PRIMARY KEY,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ,
      encounter_id  BIGINT NOT NULL REFERENCES encounter.encounter (id) ON DELETE CASCADE,
      tournament_id BIGINT NOT NULL,
      slot          INTEGER NOT NULL,
      team_id       BIGINT,
      name          VARCHAR(255) NOT NULL,
      seed          INTEGER,
      active        BOOLEAN NOT NULL DEFAULT true,
      score         FLOAT8 NOT NULL DEFAULT 0,
      placement     INTEGER,
      CONSTRAINT fk_team_encounter_tournament FOREIGN KEY (encounter_id, tournament_id)
        REFERENCES encounter.encounter (id, tournament_id) ON DELETE CASCADE,
      CONSTRAINT fk_team_source FOREIGN KEY (team_id, tournament_id)
        REFERENCES tournament.team (id, tournament_id) ON DELETE SET NULL (team_id),
      CONSTRAINT uq_team_id_encounter UNIQUE (id, encounter_id),
      CONSTRAINT uq_team_id_encounter_active UNIQUE (id, encounter_id, active),
      CONSTRAINT ck_team_slot CHECK (slot >= 1),
      CONSTRAINT ck_team_placement CHECK (placement IS NULL OR placement >= 1),
      CONSTRAINT ck_team_score_finite CHECK (score NOT IN ('NaN', 'Infinity', '-Infinity'))
    )
    """,
    "CREATE UNIQUE INDEX uq_team_active_slot ON encounter.team (encounter_id, slot) WHERE active",
    """
    CREATE UNIQUE INDEX uq_team_active_source ON encounter.team (encounter_id, team_id)
      WHERE active AND team_id IS NOT NULL
    """,
    "CREATE INDEX ix_team_team_id ON encounter.team (team_id)",
    """
    CREATE TABLE encounter.team_member (
      id                    BIGSERIAL PRIMARY KEY,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ,
      encounter_id          BIGINT NOT NULL REFERENCES encounter.encounter (id) ON DELETE CASCADE,
      encounter_team_id     BIGINT NOT NULL,
      active                BOOLEAN NOT NULL,
      workspace_member_id   BIGINT NOT NULL,
      display_name_snapshot VARCHAR(255) NOT NULL,
      rank                  INTEGER,
      is_substitute         BOOLEAN NOT NULL DEFAULT false,
      CONSTRAINT fk_team_member_team FOREIGN KEY (encounter_team_id, encounter_id, active)
        REFERENCES encounter.team (id, encounter_id, active) ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT fk_team_member_workspace_member FOREIGN KEY (workspace_member_id)
        REFERENCES workspace_member (id) DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT uq_team_member_member UNIQUE (encounter_team_id, workspace_member_id)
    )
    """,
    """
    CREATE UNIQUE INDEX uq_team_member_active_member ON encounter.team_member (encounter_id, workspace_member_id)
      WHERE active
    """,
    "CREATE INDEX ix_team_member_workspace_member_id ON encounter.team_member (workspace_member_id)",
    """
    CREATE TABLE encounter.team_member_role (
      team_member_id BIGINT NOT NULL REFERENCES encounter.team_member (id) ON DELETE CASCADE,
      dimension      VARCHAR(32) NOT NULL,
      role           VARCHAR(64) NOT NULL,
      PRIMARY KEY (team_member_id, dimension, role)
    )
    """,
    """
    CREATE TABLE encounter.game_team (
      game_id           BIGINT NOT NULL,
      encounter_id      BIGINT NOT NULL REFERENCES encounter.encounter (id) ON DELETE CASCADE,
      encounter_team_id BIGINT NOT NULL,
      score             INTEGER,
      placement         INTEGER,
      column_values     JSONB NOT NULL DEFAULT '{}',
      starting_side     VARCHAR(16),
      replay_code       VARCHAR(32),
      PRIMARY KEY (game_id, encounter_team_id),
      CONSTRAINT fk_game_team_game FOREIGN KEY (game_id, encounter_id)
        REFERENCES encounter.game (id, encounter_id) DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT fk_game_team_team FOREIGN KEY (encounter_team_id, encounter_id)
        REFERENCES encounter.team (id, encounter_id) DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT ck_game_team_score CHECK (score IS NULL OR score >= 0),
      CONSTRAINT ck_game_team_placement CHECK (placement IS NULL OR placement >= 1),
      CONSTRAINT ck_game_team_values CHECK (jsonb_typeof(column_values) = 'object')
    )
    """,
    """
    CREATE UNIQUE INDEX uq_game_team_side ON encounter.game_team (game_id, starting_side)
      WHERE starting_side IS NOT NULL
    """,
    "CREATE INDEX ix_game_team_team ON encounter.game_team (encounter_team_id)",
    """
    CREATE TABLE encounter.game_claim (
      id               BIGSERIAL PRIMARY KEY,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ,
      encounter_id     BIGINT NOT NULL REFERENCES encounter.encounter (id) ON DELETE CASCADE,
      game_id          BIGINT NOT NULL,
      claimant_team_id BIGINT NOT NULL,
      reporter_user_id BIGINT REFERENCES players."user" (id) ON DELETE SET NULL,
      basis_version    INTEGER NOT NULL,
      CONSTRAINT uq_game_claim_claimant UNIQUE (game_id, claimant_team_id),
      CONSTRAINT uq_game_claim_id_game UNIQUE (id, game_id),
      CONSTRAINT fk_game_claim_game FOREIGN KEY (game_id, encounter_id)
        REFERENCES encounter.game (id, encounter_id) DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT fk_game_claim_claimant FOREIGN KEY (game_id, claimant_team_id)
        REFERENCES encounter.game_team (game_id, encounter_team_id) DEFERRABLE INITIALLY DEFERRED
    )
    """,
    """
    CREATE TABLE encounter.game_claim_result (
      claim_id          BIGINT NOT NULL,
      game_id           BIGINT NOT NULL,
      encounter_team_id BIGINT NOT NULL,
      score             INTEGER,
      placement         INTEGER,
      column_values     JSONB NOT NULL DEFAULT '{}',
      PRIMARY KEY (claim_id, encounter_team_id),
      CONSTRAINT fk_claim_result_claim FOREIGN KEY (claim_id, game_id)
        REFERENCES encounter.game_claim (id, game_id) ON DELETE CASCADE,
      CONSTRAINT fk_claim_result_participant FOREIGN KEY (game_id, encounter_team_id)
        REFERENCES encounter.game_team (game_id, encounter_team_id) DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT ck_claim_result_score CHECK (score IS NULL OR score >= 0),
      CONSTRAINT ck_claim_result_placement CHECK (placement IS NULL OR placement >= 1),
      CONSTRAINT ck_claim_result_values CHECK (jsonb_typeof(column_values) = 'object')
    )
    """,
    """
    CREATE TABLE encounter.team_report (
      id                 BIGSERIAL PRIMARY KEY,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ,
      encounter_id       BIGINT NOT NULL REFERENCES encounter.encounter (id) ON DELETE CASCADE,
      encounter_team_id  BIGINT NOT NULL,
      reporter_user_id   BIGINT REFERENCES players."user" (id) ON DELETE SET NULL,
      games_played       INTEGER,
      basis_version      BIGINT NOT NULL,
      closeness          INTEGER,
      comment            TEXT,
      custom_fields_json JSON NOT NULL DEFAULT '{}',
      CONSTRAINT uq_team_report_claimant UNIQUE (encounter_id, encounter_team_id),
      CONSTRAINT uq_team_report_id_encounter UNIQUE (id, encounter_id),
      CONSTRAINT fk_team_report_team FOREIGN KEY (encounter_team_id, encounter_id)
        REFERENCES encounter.team (id, encounter_id) DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT ck_team_report_games CHECK (games_played IS NULL OR games_played >= 1),
      CONSTRAINT ck_team_report_closeness CHECK (closeness BETWEEN 1 AND 10)
    )
    """,
    """
    CREATE TABLE encounter.team_report_result (
      report_id         BIGINT NOT NULL,
      encounter_id      BIGINT NOT NULL,
      encounter_team_id BIGINT NOT NULL,
      score             FLOAT8 NOT NULL,
      placement         INTEGER,
      wins              INTEGER,
      PRIMARY KEY (report_id, encounter_team_id),
      CONSTRAINT fk_report_result_report FOREIGN KEY (report_id, encounter_id)
        REFERENCES encounter.team_report (id, encounter_id) ON DELETE CASCADE,
      CONSTRAINT fk_report_result_team FOREIGN KEY (encounter_team_id, encounter_id)
        REFERENCES encounter.team (id, encounter_id) DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT ck_report_result_score_finite CHECK (score NOT IN ('NaN', 'Infinity', '-Infinity')),
      CONSTRAINT ck_report_result_placement CHECK (placement IS NULL OR placement >= 1),
      CONSTRAINT ck_report_result_wins CHECK (wins IS NULL OR wins >= 0)
    )
    """,
    # New, not moved: ``tournament.encounter_readiness`` is keyed by side and
    # stays behind as legacy until enclayer02.
    """
    CREATE TABLE encounter.readiness (
      id                BIGSERIAL PRIMARY KEY,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ,
      encounter_id      BIGINT NOT NULL REFERENCES encounter.encounter (id) ON DELETE CASCADE,
      encounter_team_id BIGINT NOT NULL,
      ready_user_id     BIGINT REFERENCES players."user" (id) ON DELETE SET NULL,
      CONSTRAINT uq_readiness_team UNIQUE (encounter_id, encounter_team_id),
      CONSTRAINT fk_readiness_team FOREIGN KEY (encounter_team_id, encounter_id)
        REFERENCES encounter.team (id, encounter_id) DEFERRABLE INITIALLY DEFERRED
    )
    """,
    """
    CREATE TABLE tournament.bracket_encounter (
      encounter_id  BIGINT PRIMARY KEY,
      tournament_id BIGINT NOT NULL,
      stage_id      BIGINT,
      stage_item_id BIGINT,
      round         INTEGER NOT NULL,
      CONSTRAINT fk_bracket_encounter FOREIGN KEY (encounter_id, tournament_id)
        REFERENCES encounter.encounter (id, tournament_id) ON DELETE CASCADE,
      CONSTRAINT fk_bracket_stage FOREIGN KEY (stage_id, tournament_id)
        REFERENCES tournament.stage (id, tournament_id) ON DELETE SET NULL (stage_id),
      CONSTRAINT fk_bracket_stage_item FOREIGN KEY (stage_item_id, stage_id)
        REFERENCES tournament.stage_item (id, stage_id) ON DELETE SET NULL (stage_item_id)
    )
    """,
    "CREATE INDEX ix_bracket_encounter_stage_id ON tournament.bracket_encounter (stage_id)",
    "CREATE INDEX ix_bracket_encounter_stage_item_id ON tournament.bracket_encounter (stage_item_id)",
)


# --------------------------------------------------------------------------- #
# 5. Reshaping the tables that moved
# --------------------------------------------------------------------------- #

_RESHAPE = (
    # ── encounter.encounter ────────────────────────────────────────────────
    """
    ALTER TABLE encounter.encounter
      ADD COLUMN workspace_id    BIGINT,
      ADD COLUMN discipline      VARCHAR(32),
      ADD COLUMN scoring_rule_id BIGINT,
      ADD COLUMN slot_count      INTEGER,
      ADD COLUMN result_source   VARCHAR(16),
      ADD COLUMN result_version  BIGINT NOT NULL DEFAULT 0
    """,
    "ALTER TABLE encounter.encounter RENAME COLUMN current_map_index TO current_game_position",
    # The sides, the series score and the bracket position move out; the columns
    # stay until enclayer02 and stop being written here.
    """
    ALTER TABLE encounter.encounter
      ALTER COLUMN home_score DROP NOT NULL,
      ALTER COLUMN away_score DROP NOT NULL,
      ALTER COLUMN round      DROP NOT NULL
    """,
    # Both checks speak home/away and ``format``, which D43 removes.
    "ALTER TABLE encounter.encounter DROP CONSTRAINT ck_encounter_format",
    "ALTER TABLE encounter.encounter DROP CONSTRAINT ck_encounter_ffa_has_no_sides",
    # Superseded by the three-column owner key below.
    "ALTER TABLE encounter.encounter DROP CONSTRAINT encounter_tournament_id_fkey",
    # The legacy side columns stay (unmapped) until enclayer02, but their
    # ``ON DELETE CASCADE`` to tournament.team must not: a migrated encounter
    # still carries its home/away ids, and deleting the team would otherwise
    # cascade through them into the encounter, its games, claims and matches (D55).
    """
    ALTER TABLE encounter.encounter
      DROP CONSTRAINT encounter_home_team_id_fkey,
      DROP CONSTRAINT encounter_away_team_id_fkey
    """,
    """
    ALTER TABLE encounter.encounter
      RENAME CONSTRAINT ck_encounter_result_status_matches_status TO ck_encounter_confirmed_completed
    """,
    """
    ALTER TABLE encounter.encounter
      ADD CONSTRAINT fk_encounter_owner FOREIGN KEY (tournament_id, workspace_id, discipline)
        REFERENCES tournament.tournament (id, workspace_id, discipline) ON DELETE CASCADE NOT VALID
    """,
    """
    ALTER TABLE encounter.encounter
      ADD CONSTRAINT fk_encounter_scoring_rule FOREIGN KEY (scoring_rule_id, workspace_id)
        REFERENCES encounter.scoring_rule (id, workspace_id) DEFERRABLE INITIALLY DEFERRED NOT VALID
    """,
    """
    ALTER TABLE encounter.encounter
      ADD CONSTRAINT ck_encounter_best_of CHECK (best_of >= 1) NOT VALID,
      ADD CONSTRAINT ck_encounter_slot_count CHECK (slot_count >= 2) NOT VALID,
      -- The column is new and defaulted to 0, so no existing row can fail it.
      ADD CONSTRAINT ck_encounter_result_version CHECK (result_version >= 0),
      ADD CONSTRAINT ck_encounter_result_source
        CHECK (result_source IN ('games', 'series_claim', 'admin', 'import')) NOT VALID,
      ADD CONSTRAINT ck_encounter_confirmed_source
        CHECK (result_status <> 'confirmed' OR result_source IS NOT NULL) NOT VALID
    """,
    "CREATE INDEX ix_encounter_workspace_id ON encounter.encounter (workspace_id)",
    # ── encounter.game ─────────────────────────────────────────────────────
    "ALTER TABLE encounter.game DROP CONSTRAINT ck_encounter_game_format",
    "ALTER TABLE encounter.game DROP CONSTRAINT ck_encounter_game_ffa_has_no_scores",
    "ALTER TABLE encounter.game DROP CONSTRAINT ck_encounter_game_confirmed_shape",
    """
    ALTER TABLE encounter.game ADD CONSTRAINT ck_game_confirmed_shape
      CHECK (state <> 'confirmed' OR (result_source IS NOT NULL AND confirmed_at IS NOT NULL))
    """,
    "ALTER TABLE encounter.game RENAME CONSTRAINT ck_encounter_game_position TO ck_game_position",
    "ALTER INDEX encounter.uq_encounter_game_encounter_position RENAME TO uq_game_encounter_position",
    "ALTER INDEX encounter.ix_tournament_encounter_game_encounter_id RENAME TO ix_game_encounter_id",
    "ALTER INDEX encounter.ix_tournament_encounter_game_map_id RENAME TO ix_game_map_id",
    # ── encounter.result_audit ─────────────────────────────────────────────
    """
    ALTER TABLE encounter.result_audit
      ADD COLUMN result_version BIGINT,
      ADD COLUMN snapshot_scope VARCHAR(16),
      ADD COLUMN "before"       JSONB,
      ADD COLUMN "after"        JSONB
    """,
    # The score pair and the lobby blob become one ``before``/``after`` shape.
    "ALTER TABLE encounter.result_audit DROP CONSTRAINT ck_encounter_result_audit_after_shape",
    # ``adopted_team_id`` keeps its name and changes meaning: a participation,
    # not a tournament team. The data half remaps the stored ids.
    "ALTER TABLE encounter.result_audit DROP CONSTRAINT encounter_result_audit_adopted_team_id_fkey",
    "ALTER TABLE encounter.result_audit DROP CONSTRAINT fk_tournament_encounter_result_audit_game_id",
    """
    ALTER TABLE encounter.result_audit
      ADD CONSTRAINT uq_result_audit_version UNIQUE (encounter_id, result_version),
      ADD CONSTRAINT fk_result_audit_game FOREIGN KEY (game_id, encounter_id)
        REFERENCES encounter.game (id, encounter_id) DEFERRABLE INITIALLY DEFERRED NOT VALID,
      ADD CONSTRAINT fk_result_audit_adopted FOREIGN KEY (adopted_team_id, encounter_id)
        REFERENCES encounter.team (id, encounter_id) ON DELETE SET NULL (adopted_team_id) NOT VALID,
      ADD CONSTRAINT ck_result_audit_scope CHECK (snapshot_scope IN ('encounter', 'game')) NOT VALID,
      ADD CONSTRAINT ck_result_audit_game_scope
        CHECK (snapshot_scope = 'encounter' OR game_id IS NOT NULL) NOT VALID
    """,
    "ALTER INDEX encounter.ix_tournament_encounter_result_audit_game_id RENAME TO ix_result_audit_game_id",
    # ── encounter.room_event ───────────────────────────────────────────────
    "ALTER TABLE encounter.room_event ADD COLUMN encounter_team_id BIGINT",
    """
    ALTER TABLE encounter.room_event
      ADD CONSTRAINT fk_room_event_team FOREIGN KEY (encounter_team_id, encounter_id)
        REFERENCES encounter.team (id, encounter_id) ON DELETE SET NULL (encounter_team_id) NOT VALID
    """,
    # ── encounter.pick_ban_session ─────────────────────────────────────────
    """
    ALTER TABLE encounter.pick_ban_session
      ADD COLUMN pool_json                 JSON,
      ADD COLUMN first_team_id             BIGINT,
      ADD COLUMN pending_chooser_team_id   BIGINT,
      ADD COLUMN undo_requested_by_team_id BIGINT
    """,
    """
    ALTER TABLE encounter.pick_ban_session
      ADD CONSTRAINT uq_pick_ban_session_id_encounter UNIQUE (id, encounter_id),
      ADD CONSTRAINT fk_pick_ban_session_first_team FOREIGN KEY (first_team_id, encounter_id)
        REFERENCES encounter.team (id, encounter_id) ON DELETE SET NULL (first_team_id) NOT VALID,
      ADD CONSTRAINT fk_pick_ban_session_pending_chooser FOREIGN KEY (pending_chooser_team_id, encounter_id)
        REFERENCES encounter.team (id, encounter_id) ON DELETE SET NULL (pending_chooser_team_id) NOT VALID,
      ADD CONSTRAINT fk_pick_ban_session_undo_requested_by FOREIGN KEY (undo_requested_by_team_id, encounter_id)
        REFERENCES encounter.team (id, encounter_id) ON DELETE SET NULL (undo_requested_by_team_id) NOT VALID
    """,
    "ALTER INDEX encounter.ix_tournament_pick_ban_session_encounter_id RENAME TO ix_pick_ban_session_encounter_id",
    # ── encounter.pick_ban_entry ───────────────────────────────────────────
    """
    ALTER TABLE encounter.pick_ban_entry
      ADD COLUMN encounter_id         BIGINT,
      ADD COLUMN picked_by_kind       encounter.pickbanactor,
      ADD COLUMN picked_by_team_id    BIGINT,
      ADD COLUMN protected_by_kind    encounter.pickbanactor,
      ADD COLUMN protected_by_team_id BIGINT
    """,
    # Superseded by the composite FK, which also scopes the board to the room's
    # encounter.
    "ALTER TABLE encounter.pick_ban_entry DROP CONSTRAINT pick_ban_entry_session_id_fkey",
    """
    ALTER TABLE encounter.pick_ban_entry
      ADD CONSTRAINT fk_pick_ban_entry_session FOREIGN KEY (session_id, encounter_id)
        REFERENCES encounter.pick_ban_session (id, encounter_id) ON DELETE CASCADE NOT VALID,
      ADD CONSTRAINT fk_pick_ban_entry_picked_by FOREIGN KEY (picked_by_team_id, encounter_id)
        REFERENCES encounter.team (id, encounter_id) ON DELETE SET NULL (picked_by_team_id) NOT VALID,
      ADD CONSTRAINT fk_pick_ban_entry_protected_by FOREIGN KEY (protected_by_team_id, encounter_id)
        REFERENCES encounter.team (id, encounter_id) ON DELETE SET NULL (protected_by_team_id) NOT VALID,
      ADD CONSTRAINT ck_pick_ban_entry_picked_by
        CHECK ((picked_by_kind = 'team') = (picked_by_team_id IS NOT NULL)) NOT VALID,
      ADD CONSTRAINT ck_pick_ban_entry_protected_by
        CHECK ((protected_by_kind = 'team') = (protected_by_team_id IS NOT NULL)) NOT VALID
    """,
    "ALTER INDEX encounter.ix_tournament_pick_ban_entry_session_id RENAME TO ix_pick_ban_entry_session_id",
    "ALTER INDEX encounter.ix_tournament_pick_ban_entry_item_id RENAME TO ix_pick_ban_entry_item_id",
    # ── encounter.pick_ban_submission ──────────────────────────────────────
    """
    ALTER TABLE encounter.pick_ban_submission
      ADD COLUMN encounter_id      BIGINT,
      ADD COLUMN encounter_team_id BIGINT,
      ALTER COLUMN side DROP NOT NULL
    """,
    "ALTER TABLE encounter.pick_ban_submission DROP CONSTRAINT pick_ban_submission_session_id_fkey",
    """
    ALTER TABLE encounter.pick_ban_submission
      ADD CONSTRAINT fk_pick_ban_submission_session FOREIGN KEY (session_id, encounter_id)
        REFERENCES encounter.pick_ban_session (id, encounter_id) ON DELETE CASCADE NOT VALID,
      ADD CONSTRAINT fk_pick_ban_submission_team FOREIGN KEY (encounter_team_id, encounter_id)
        REFERENCES encounter.team (id, encounter_id) DEFERRABLE INITIALLY DEFERRED NOT VALID
    """,
    "ALTER INDEX encounter.ix_tournament_pick_ban_submission_session_id RENAME TO ix_pick_ban_submission_session_id",
)


# --------------------------------------------------------------------------- #
# 6. Changes outside the layer (§13.5)
# --------------------------------------------------------------------------- #

#: Until V4 the stats tables keep their own ``team_id`` columns; what changes is
#: that deleting a tournament team no longer deletes the games it played.
#: Deferred so a cascade that removes both sides at once still commits, and
#: ``NOT VALID`` so re-adding them does not scan 27M statistics rows while the
#: ACCESS EXCLUSIVE lock taken at the start is held. They are validated by the
#: next revision, ``enclayer01b``, in its own transaction.
_MATCH_TEAM_FKS = (
    ("matches.match", "match_home_team_id_fkey", "home_team_id"),
    ("matches.match", "match_away_team_id_fkey", "away_team_id"),
    ("matches.statistics", "statistics_team_id_fkey", "team_id"),
    ("matches.kill_feed", "kill_feed_killer_team_id_fkey", "killer_team_id"),
    ("matches.kill_feed", "kill_feed_victim_team_id_fkey", "victim_team_id"),
    ("matches.event", "assists_team_id_fkey", "team_id"),
    ("matches.event", "assists_related_team_id_fkey", "related_team_id"),
)

_EXTERNAL = (
    # ── tournament.encounter_link: roles and sides become positions ────────
    # The old enum column cannot carry a slot number and the new one needs its
    # name; enclayer02 drops the renamed original.
    "ALTER TABLE tournament.encounter_link RENAME COLUMN target_slot TO legacy_target_slot",
    """
    ALTER TABLE tournament.encounter_link
      ADD COLUMN tournament_id   BIGINT,
      ADD COLUMN source_position INTEGER,
      ADD COLUMN target_slot     INTEGER,
      ALTER COLUMN role               DROP NOT NULL,
      ALTER COLUMN legacy_target_slot DROP NOT NULL,
      ALTER COLUMN source_encounter_id TYPE BIGINT,
      ALTER COLUMN target_encounter_id TYPE BIGINT
    """,
    """
    ALTER TABLE tournament.encounter_link
      DROP CONSTRAINT encounter_link_source_encounter_id_fkey,
      DROP CONSTRAINT encounter_link_target_encounter_id_fkey,
      ADD CONSTRAINT fk_link_source FOREIGN KEY (source_encounter_id, tournament_id)
        REFERENCES encounter.encounter (id, tournament_id) ON DELETE CASCADE NOT VALID,
      ADD CONSTRAINT fk_link_target FOREIGN KEY (target_encounter_id, tournament_id)
        REFERENCES encounter.encounter (id, tournament_id) ON DELETE CASCADE NOT VALID,
      ADD CONSTRAINT uq_link_source_position UNIQUE (source_encounter_id, source_position),
      ADD CONSTRAINT uq_link_target_slot UNIQUE (target_encounter_id, target_slot),
      ADD CONSTRAINT ck_link_not_self CHECK (source_encounter_id <> target_encounter_id) NOT VALID,
      ADD CONSTRAINT ck_link_positions CHECK (source_position >= 1 AND target_slot >= 1) NOT VALID
    """,
    # ── matches.* keep their statistics when a team is deleted ─────────────
    *(
        f"ALTER TABLE {table} DROP CONSTRAINT {name}, "
        f"ADD CONSTRAINT {name} FOREIGN KEY ({column}) REFERENCES tournament.team (id) "
        f"DEFERRABLE INITIALLY DEFERRED NOT VALID"
        for table, name, column in _MATCH_TEAM_FKS
    ),
)


# --------------------------------------------------------------------------- #
# 7. Pre-flight checks (§13.8)
# --------------------------------------------------------------------------- #

#: The four questions the data has to answer before anything moves. Every one of
#: them is a decision the migration must NOT make by row order -- which role the
#: player really had, which team they played for, which game a replay code
#: belongs to -- so a non-empty answer stops the revision and a human resolves
#: the rows. ``PREFLIGHT`` and ``GUARDS`` live, query for query, in
#: ``backend/scripts/enclayer01_preflight.sql`` so an operator can run them days
#: before the deploy window; they are written against the PRE-move names on
#: purpose and run before the first DDL statement.
PREFLIGHT: tuple[tuple[str, str], ...] = (
    (
        "tournament.player rows of one workspace member in one team disagree on role or rank",
        """
        SELECT p.team_id, p.workspace_member_id, array_agg(p.id ORDER BY p.id) AS player_ids
          FROM tournament.player p
         GROUP BY p.team_id, p.workspace_member_id
        HAVING count(DISTINCT (p.role, p.rank)) > 1
         ORDER BY p.team_id, p.workspace_member_id
        """,
    ),
    (
        "one workspace member sits in two rosters of the same encounter",
        """
        WITH seat AS (
            SELECT id AS encounter_id, home_team_id AS team_id
              FROM tournament.encounter WHERE home_team_id IS NOT NULL
             UNION ALL
            SELECT id, away_team_id FROM tournament.encounter WHERE away_team_id IS NOT NULL
             UNION ALL
            SELECT encounter_id, team_id FROM tournament.encounter_participant
        ),
        member_seat AS (
            SELECT seat.encounter_id, p.workspace_member_id, seat.team_id,
                   bool_or(NOT p.is_substitution) AS regular
              FROM seat JOIN tournament.player p ON p.team_id = seat.team_id
             GROUP BY seat.encounter_id, p.workspace_member_id, seat.team_id
        )
        SELECT encounter_id, workspace_member_id, array_agg(team_id ORDER BY team_id) AS team_ids
          FROM member_seat
         GROUP BY encounter_id, workspace_member_id
        HAVING count(*) > 1 AND count(*) FILTER (WHERE regular) <> 1
         ORDER BY encounter_id, workspace_member_id
        """,
    ),
    (
        "encounter result status disagrees with encounter status",
        """
        SELECT id AS encounter_id, status::text AS status, result_status::text AS result_status
          FROM tournament.encounter
         WHERE (result_status = 'confirmed') <> (status = 'COMPLETED')
         ORDER BY id
        """,
    ),
    (
        "replay code names a position holding both a cancelled and a live game",
        """
        SELECT c.id AS map_code_id, r.encounter_id, c.map_index
          FROM tournament.encounter_map_code c
          JOIN tournament.encounter_captain_report r ON r.id = c.report_id
         WHERE EXISTS (SELECT 1 FROM tournament.encounter_game g
                        WHERE g.encounter_id = r.encounter_id AND g.position = c.map_index
                          AND g.state = 'cancelled')
           AND EXISTS (SELECT 1 FROM tournament.encounter_game g
                        WHERE g.encounter_id = r.encounter_id AND g.position = c.map_index
                          AND g.state <> 'cancelled')
         ORDER BY c.id
        """,
    ),
)

#: Further questions, beyond §13.8's four. Not transfer decisions: each is a
#: state a validated legacy CHECK or a column default already forbids
#: (``ck_encounter_game_result_placement``, ``encounter_game_result.stats NOT
#: NULL``), that the data model has no answer for, or that one of this
#: revision's immediate constraints (a link's unique target slot, a seat's
#: source key, the bracket row's owner keys, ``ck_encounter_best_of``,
#: ``ck_pick_ban_entry_picked_by``) or the lobby recompute would reject later.
#: They are here because the cost is one cheap query and the alternative is the
#: backfill aborting halfway through the ACCESS EXCLUSIVE window on a row the
#: operator could have seen days earlier. Like the four above, they stop the
#: revision with the ids.
GUARDS: tuple[tuple[str, str], ...] = (
    (
        "game result placement is below 1, which encounter.game_team cannot store",
        """
        SELECT r.id AS game_result_id, r.game_id, r.team_id, r.placement
          FROM tournament.encounter_game_result r
         WHERE r.placement IS NOT NULL AND r.placement < 1
         ORDER BY r.id
        """,
    ),
    (
        "journal row adopted a team that holds no seat in its encounter",
        """
        SELECT a.id AS result_audit_id, a.encounter_id, a.adopted_team_id
          FROM tournament.encounter_result_audit a
          JOIN tournament.encounter e ON e.id = a.encounter_id
         WHERE a.adopted_team_id IS NOT NULL
           AND a.adopted_team_id IS DISTINCT FROM e.home_team_id
           AND a.adopted_team_id IS DISTINCT FROM e.away_team_id
           AND NOT EXISTS (SELECT 1 FROM tournament.encounter_participant p
                            WHERE p.encounter_id = a.encounter_id AND p.team_id = a.adopted_team_id)
         ORDER BY a.id
        """,
    ),
    (
        "link repeats a target slot, joins an encounter to itself, or crosses tournaments",
        """
        SELECT l.id AS link_id, l.source_encounter_id, l.target_encounter_id, l.target_slot::text AS target_slot
          FROM tournament.encounter_link l
          JOIN tournament.encounter s ON s.id = l.source_encounter_id
          JOIN tournament.encounter t ON t.id = l.target_encounter_id
         WHERE s.tournament_id <> t.tournament_id
            OR l.source_encounter_id = l.target_encounter_id
            OR EXISTS (SELECT 1 FROM tournament.encounter_link o
                        WHERE o.target_encounter_id = l.target_encounter_id
                          AND o.target_slot = l.target_slot AND o.id <> l.id)
         ORDER BY l.id
        """,
    ),
    (
        "encounter best_of is below 1",
        """
        SELECT id AS encounter_id, best_of FROM tournament.encounter WHERE best_of < 1 ORDER BY id
        """,
    ),
    (
        "duel seats the same team on both sides",
        """
        SELECT id AS encounter_id, home_team_id AS team_id
          FROM tournament.encounter
         WHERE home_team_id = away_team_id
         ORDER BY id
        """,
    ),
    (
        "seated team belongs to another tournament than its encounter",
        """
        SELECT e.id AS encounter_id, e.tournament_id, t.id AS team_id, t.tournament_id AS team_tournament_id
          FROM tournament.encounter e
          JOIN tournament.team t ON t.id IN (e.home_team_id, e.away_team_id)
         WHERE t.tournament_id <> e.tournament_id
         UNION
        SELECT e.id, e.tournament_id, t.id, t.tournament_id
          FROM tournament.encounter_participant p
          JOIN tournament.encounter e ON e.id = p.encounter_id
          JOIN tournament.team t ON t.id = p.team_id
         WHERE t.tournament_id <> e.tournament_id
         ORDER BY 1, 3
        """,
    ),
    (
        "encounter sits in a stage of another tournament, or in a stage item of another stage",
        """
        SELECT e.id AS encounter_id, e.tournament_id, e.stage_id, e.stage_item_id
          FROM tournament.encounter e
         WHERE (e.stage_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM tournament.stage s
                                 WHERE s.id = e.stage_id AND s.tournament_id = e.tournament_id))
            OR (e.stage_item_id IS NOT NULL AND e.stage_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM tournament.stage_item i
                                 WHERE i.id = e.stage_item_id AND i.stage_id = e.stage_id))
         ORDER BY e.id
        """,
    ),
    (
        "pick-ban entry was picked or protected by a side that holds no seat in its encounter",
        """
        SELECT en.id AS pick_ban_entry_id, s.encounter_id, v.column_name, v.side
          FROM tournament.pick_ban_entry en
          JOIN tournament.pick_ban_session s ON s.id = en.session_id
          JOIN tournament.encounter e ON e.id = s.encounter_id
          CROSS JOIN LATERAL (VALUES ('picked_by', en.picked_by::text),
                                     ('protected_by', en.protected_by::text)) AS v(column_name, side)
         WHERE (v.side = 'home' AND e.home_team_id IS NULL)
            OR (v.side = 'away' AND e.away_team_id IS NULL)
         ORDER BY en.id, v.column_name
        """,
    ),
    (
        "ffa encounter is not in an ffa_league stage, so it would be scored by wins and skipped by the lobby recompute",
        """
        SELECT e.id AS encounter_id, e.stage_id, s.stage_type::text AS stage_type
          FROM tournament.encounter e
          LEFT JOIN tournament.stage s ON s.id = e.stage_id
         WHERE e.format = 'ffa' AND s.stage_type::text IS DISTINCT FROM 'ffa_league'
         ORDER BY e.id
        """,
    ),
)

#: How many offending rows the error message carries; the rest are counted.
PREFLIGHT_SAMPLE = 20


def _preflight() -> None:
    """Run the checks and stop the revision with the offending ids.

    Runs AFTER ``_take_locks`` and before the first DDL statement: a SELECT
    issued first would take ACCESS SHARE on the very tables the revision then
    needs ACCESS EXCLUSIVE on, and a lock upgrade is exactly the deadlock the
    retry loop cannot give an attempt back for.
    """
    bind = op.get_bind()
    failures: list[str] = []
    for question, query in (*PREFLIGHT, *GUARDS):
        rows = bind.execute(sa.text(query)).mappings().all()
        if not rows:
            continue
        sample = "; ".join(str(dict(row)) for row in rows[:PREFLIGHT_SAMPLE])
        rest = len(rows) - PREFLIGHT_SAMPLE
        failures.append(f"{question} [{len(rows)}]: {sample}" + (f"; … {rest} more" if rest > 0 else ""))
    if failures:
        raise RuntimeError("enclayer01 pre-flight failed; resolve these rows by hand first:\n" + "\n".join(failures))


# --------------------------------------------------------------------------- #
# 8. Converters (pure; golden-tested by backend/tests/test_enclayer01_convert.py)
# --------------------------------------------------------------------------- #

#: D61: a series is decided by wins, and it is over once every position is
#: played or one side is past half (a drawn map pays no win but burns a game).
WINS_END_FORMULA = "games >= best_of or max_wins * 2 > best_of"
#: A lobby plays its whole card; points decide, not wins.
POINTS_END_FORMULA = "games >= best_of"


def wins_rule() -> dict:
    """The series preset: one point per game won, no organizer columns."""
    return {
        "preset": "wins",
        "columns": [],
        "placement_points": [],
        "game_formula": "win",
        "end_formula": WINS_END_FORMULA,
    }


def scoring_rule_for_stage(stage_type: str, ffa_columns, ffa_formula: str | None, ffa_placement_points) -> dict:
    """One stage's rule row (§13.8). Only a lobby stage keeps its FFA settings.

    A bracket stage's ``ffa_*`` columns are the table defaults nobody entered;
    carrying them would compile a formula the ``wins`` preset never evaluates.

    ``ffa_league`` is the only lobby stage type there is -- in the PG type and in
    ``shared.core.enums.StageType`` -- and the two exact-match filters that
    follow from it are load-bearing: a lobby stage mapped to ``wins`` would be
    skipped by ``enclayer01_recompute_lobbies.py``, which selects on
    ``preset == 'points'``, and would keep ``score = 0`` forever with nothing
    raised. So an unknown ``ffa_`` type stops the revision instead.
    """
    if stage_type != "ffa_league":
        if stage_type.startswith("ffa_"):
            raise RuntimeError(
                f"enclayer01 has no scoring rule for stage type {stage_type!r}:"
                " map it like 'ffa_league' before migrating"
            )
        return wins_rule()
    return {
        "preset": "points",
        "columns": list(ffa_columns) if ffa_columns else [],
        "placement_points": [float(points) for points in (ffa_placement_points or ())],
        # ``stage.ffa_formula`` is NOT NULL with default 'score'; a NULL can only
        # come from a hand-edited row, and the engine must still compile it.
        "game_formula": ffa_formula or "score",
        "end_formula": POINTS_END_FORMULA,
    }


def duel_placements(slot1_score: int, slot2_score: int, completed: bool) -> tuple[int | None, int | None]:
    """Places of the two seats of a duel. No place until there is a result; a
    draw gives both first (§13.8)."""
    if not completed:
        return (None, None)
    if slot1_score == slot2_score:
        return (1, 1)
    return (1, 2) if slot1_score > slot2_score else (2, 1)


def result_source_for(
    confirmed: bool,
    stored: tuple[int, int],
    games_aggregate: tuple[int, int] | None,
    *,
    lobby_with_games: bool = False,
) -> str | None:
    """Where a confirmed encounter's official result came from (D57).

    ``games`` only when the stored score IS the confirmed games' score --
    anything else is a number somebody put there (an admin, a Challonge import)
    and must not be presented as recomputable from an incomplete set of games.
    ``games_aggregate`` is None when there is nothing comparable to aggregate:
    no confirmed game carries a score pair (a series confirmed without its games).

    A lobby is the exception: it never stored a series score (its standing is
    the formula over its games, always was), so a confirmed lobby that has
    confirmed games IS ``games`` -- ``import`` would freeze it against every
    later game correction and rule edit, which only ``games`` results follow.
    """
    if not confirmed:
        return None
    if lobby_with_games:
        return "games"
    return "games" if games_aggregate is not None and tuple(games_aggregate) == tuple(stored) else "import"


def ruleset_actor(actor: str) -> str:
    """Ruleset actors stop naming sides (§13.4): ``home``/``away`` become slots."""
    return {"home": "slot:1", "away": "slot:2"}.get(actor, actor)


def rewrite_ruleset(document):
    """A ruleset v2 document with every step's ``actors`` moved to slots."""
    if not isinstance(document, dict):
        return document
    phases = document.get("phases")
    if not isinstance(phases, list):
        return document
    rewritten = []
    for phase in phases:
        if not isinstance(phase, dict) or not isinstance(phase.get("steps"), list):
            rewritten.append(phase)
            continue
        steps = [
            {**step, "actors": ruleset_actor(step["actors"])}
            if isinstance(step, dict) and isinstance(step.get("actors"), str)
            else step
            for step in phase["steps"]
        ]
        rewritten.append({**phase, "steps": steps})
    return {**document, "phases": rewritten}


def pool_snapshot(
    mode: str | None,
    rotation: str | None,
    kind: str,
    best_of: int,
    item_ids: Sequence[int],
    slot_item_ids: Sequence[Sequence[int]],
) -> dict:
    """The pool a running room was opened against, in the shape the room reads.

    Mirrors ``pick_ban_session.pool_snapshot`` (the writer of every new room):
    ``{mode, rotation, progressive, items, slots: [[item ids]]}``, slots in
    position order and cut to the series' ``best_of``. ``progressive`` is true
    for slot mode and for every hero room -- a missing flag stops the next round
    from ever opening. A room whose config was deleted (``mode is None``) keeps
    an empty pool, still progressive when it is a hero room.
    """
    return {
        "mode": mode or "pool",
        "rotation": rotation or "fixed",
        "progressive": mode == "slots" or kind == "hero",
        "items": list(item_ids),
        "slots": [list(items) for items in slot_item_ids[:best_of]],
    }


#: The two keys a notification payload carried while an encounter had a home
#: and an away side.
_LEGACY_TEAM_NAME_KEYS = ("home_team_name", "away_team_name")
_NOTIFICATION_KINDS = ("encounter.scheduled", "encounter.dispute_review")


def notification_payload(payload):
    """A stored notification payload with ``team_names`` instead of the pair.

    The inbox and the Discord renderer read only ``team_names`` (every seat's
    name in slot order); rows written before the cutover carry the pair alone.
    Idempotent: a payload without the pair, or already carrying ``team_names``,
    only loses the pair.
    """
    if not isinstance(payload, dict) or not any(key in payload for key in _LEGACY_TEAM_NAME_KEYS):
        return payload
    rest = {key: value for key, value in payload.items() if key not in _LEGACY_TEAM_NAME_KEYS}
    if isinstance(rest.get("team_names"), list):
        return rest
    return {**rest, "team_names": [payload.get(key) or "" for key in _LEGACY_TEAM_NAME_KEYS]}


def _snapshot_lines(entries, team_participations: dict[int, int]) -> list[dict] | None:
    """A lobby snapshot's rows, keyed by participation instead of source team.

    Everything but ``team_id`` is carried verbatim -- a game snapshot keeps its
    placement and stats, a lobby total its points and games. An entry whose team
    no longer has a participation is dropped: it could not be read by anything
    keyed on participations, and the legacy ``ffa_results_json`` column stays in
    the table until ``enclayer02``, so nothing is lost.
    """
    if entries is None:
        return None
    lines = []
    for entry in entries:
        participation = team_participations.get(entry.get("team_id"))
        if participation is None:
            continue
        lines.append({"encounter_team_id": participation, **{k: v for k, v in entry.items() if k != "team_id"}})
    return lines


def _duel_lines(slot1_score, slot2_score, slot_participations: dict[int, int]) -> list[dict] | None:
    """A duel snapshot's rows: one per occupied seat, placed by the pair."""
    if slot1_score is None and slot2_score is None:
        return None
    places = duel_placements(slot1_score or 0, slot2_score or 0, True)
    lines = []
    for slot, score, placement in ((1, slot1_score, places[0]), (2, slot2_score, places[1])):
        participation = slot_participations.get(slot)
        if participation is not None:
            lines.append({"encounter_team_id": participation, "score": score, "placement": placement})
    return lines


def audit_snapshot(row: dict, slot_participations: dict[int, int], team_participations: dict[int, int]) -> dict:
    """``before``/``after``/``snapshot_scope`` of one journal row (D47, D68).

    The scope is the shape of the snapshot, not the presence of ``game_id``: a
    lobby totals row is written WITH the game that triggered it, and it is still
    the encounter's standing (§13.8). A duel's score pair is a game's accepted
    score when the row names a game, and the series score otherwise.
    """
    ffa = row.get("ffa_results_json")
    if isinstance(ffa, dict):
        before = _snapshot_lines(ffa.get("before"), team_participations)
        after = _snapshot_lines(ffa.get("after"), team_participations)
        lobby_total = any(
            "points" in entry for entries in (ffa.get("before") or [], ffa.get("after") or []) for entry in entries
        )
        scope = "game" if row.get("game_id") is not None and not lobby_total else "encounter"
    else:
        before = _duel_lines(row.get("home_score_before"), row.get("away_score_before"), slot_participations)
        after = _duel_lines(row.get("home_score_after"), row.get("away_score_after"), slot_participations)
        scope = "game" if row.get("game_id") is not None else "encounter"
    return {"before": before, "after": after if after is not None else [], "snapshot_scope": scope}


# --------------------------------------------------------------------------- #
# 9. Backfill (§13.8)
# --------------------------------------------------------------------------- #

_DISCIPLINE = (
    # The row is already seeded with the schema half; both statements are here
    # so the backfill can be read -- and re-run -- as one piece.
    "INSERT INTO catalog.discipline (code, name) VALUES ('overwatch', 'Overwatch') ON CONFLICT (code) DO NOTHING",
    "UPDATE tournament.tournament SET discipline = 'overwatch' WHERE discipline IS DISTINCT FROM 'overwatch'",
)

_ENCOUNTER_COLUMNS = (
    """
    UPDATE encounter.encounter e SET workspace_id = t.workspace_id, discipline = t.discipline
      FROM tournament.tournament t
     WHERE t.id = e.tournament_id AND (e.workspace_id IS NULL OR e.discipline IS NULL)
    """,
    """
    UPDATE encounter.encounter e SET scoring_rule_id = s.scoring_rule_id
      FROM tournament.stage s
     WHERE s.id = e.stage_id AND e.scoring_rule_id IS NULL
    """,
    # A duel seats two; a lobby seats as many as its highest participant slot.
    # Two is the floor: ``ck_encounter_slot_count`` says an encounter nobody
    # entered is still a meeting of two seats.
    """
    UPDATE encounter.encounter e
       SET slot_count = GREATEST(2, COALESCE(
             (SELECT max(p.slot) FROM tournament.encounter_participant p WHERE p.encounter_id = e.id), 0))
     WHERE e.slot_count IS NULL
    """,
    """
    INSERT INTO tournament.bracket_encounter (encounter_id, tournament_id, stage_id, stage_item_id, round)
         SELECT e.id, e.tournament_id, e.stage_id, e.stage_item_id, e.round
           FROM encounter.encounter e
          WHERE e.round IS NOT NULL
    ON CONFLICT (encounter_id) DO NOTHING
    """,
)

#: Lobby seats carry their participant row's slot; the duel seats are written in
#: Python, which is where the placement rule lives.
_FFA_PARTICIPATIONS = """
    INSERT INTO encounter.team (encounter_id, tournament_id, slot, team_id, name)
         SELECT p.encounter_id, e.tournament_id, p.slot, p.team_id, left(t.name, 255)
           FROM tournament.encounter_participant p
           JOIN encounter.encounter e ON e.id = p.encounter_id
           JOIN tournament.team t ON t.id = p.team_id
    ON CONFLICT (encounter_id, slot) WHERE active DO NOTHING
"""

#: A member who is a regular of one seat of the encounter and only a substitute
#: on another seat played for the regular seat: legacy rows cannot say which
#: team a substitute registration was used for, and the statistics agree with
#: the regular seat. Pre-flight check 2 refuses what this cannot settle.
_SUBSTITUTE_ON_A_REGULARS_OTHER_SEAT = """
       AND NOT (p.is_substitution AND EXISTS (
                SELECT 1 FROM encounter.team ot
                  JOIN tournament.player q ON q.team_id = ot.team_id
                 WHERE ot.encounter_id = et.encounter_id AND ot.team_id <> et.team_id
                   AND q.workspace_member_id = p.workspace_member_id AND NOT q.is_substitution))
"""

_ROSTERS = (
    # The whole roster of the seat's team, substitutes included (D40) -- except
    # a substitute row of a member who is a regular on another seat of the same
    # encounter. Rows of one member that agree collapse here; rows that
    # disagree were stopped by pre-flight check 1, so ``DISTINCT ON`` only ever
    # picks between equals.
    f"""
    INSERT INTO encounter.team_member
           (encounter_id, encounter_team_id, active, workspace_member_id, display_name_snapshot, rank, is_substitute)
    SELECT DISTINCT ON (et.id, p.workspace_member_id)
           et.encounter_id, et.id, et.active, p.workspace_member_id, left(p.name, 255), p.rank, p.is_substitution
      FROM encounter.team et
      JOIN tournament.player p ON p.team_id = et.team_id
     WHERE et.team_id IS NOT NULL {_SUBSTITUTE_ON_A_REGULARS_OTHER_SEAT}
     ORDER BY et.id, p.workspace_member_id, p.id
    ON CONFLICT (encounter_team_id, workspace_member_id) DO NOTHING
    """,
    # Role and sub-role are two rows of one dimension (D67): the sub-role is a
    # child code of the role, not a second axis.
    f"""
    WITH roster AS (
        SELECT DISTINCT ON (et.id, p.workspace_member_id)
               et.id AS encounter_team_id, p.workspace_member_id, p.role::text AS role, p.sub_role
          FROM encounter.team et
          JOIN tournament.player p ON p.team_id = et.team_id
         WHERE et.team_id IS NOT NULL {_SUBSTITUTE_ON_A_REGULARS_OTHER_SEAT}
         ORDER BY et.id, p.workspace_member_id, p.id
    )
    INSERT INTO encounter.team_member_role (team_member_id, dimension, role)
         SELECT tm.id, 'player_role', code
           FROM encounter.team_member tm
           JOIN roster r ON r.encounter_team_id = tm.encounter_team_id
                        AND r.workspace_member_id = tm.workspace_member_id
     CROSS JOIN LATERAL (VALUES (r.role), (r.sub_role)) AS v(code)
          WHERE code IS NOT NULL
    ON CONFLICT DO NOTHING
    """,
)

#: One row per participation per game, including cancelled positions and games
#: nobody has played yet -- an empty row IS the statement that this seat has no
#: result here (§13.8).
_GAME_TEAM_ROWS = """
    INSERT INTO encounter.game_team (game_id, encounter_id, encounter_team_id)
         SELECT g.id, g.encounter_id, et.id
           FROM encounter.game g
           JOIN encounter.team et ON et.encounter_id = g.encounter_id
    ON CONFLICT (game_id, encounter_team_id) DO NOTHING
"""

_GAME_RESULTS = (
    # ``column_values`` is NOT NULL here while ``stats`` is only NOT NULL over
    # there: COALESCE costs nothing and removes the dependency entirely. The
    # placement comes across raw -- ``ck_encounter_game_result_placement``
    # already says it is NULL or >= 1, and a row that somehow is not was named
    # by the guard above rather than rounded up to a place nobody finished in.
    """
    UPDATE encounter.game_team gt
       SET placement = r.placement, column_values = COALESCE(r.stats, '{}'::jsonb)
      FROM tournament.encounter_game_result r
      JOIN encounter.team et ON et.encounter_id = r.encounter_id AND et.team_id = r.team_id
     WHERE gt.game_id = r.game_id AND gt.encounter_team_id = et.id
    """,
    # The code was filed against a report's team and a map index; the position
    # it names has exactly one live game (pre-flight check 4).
    """
    UPDATE encounter.game_team gt SET replay_code = c.code
      FROM tournament.encounter_map_code c
      JOIN tournament.encounter_captain_report r ON r.id = c.report_id
      JOIN encounter.team et ON et.encounter_id = r.encounter_id AND et.team_id = r.team_id
      JOIN encounter.game g ON g.encounter_id = r.encounter_id AND g.position = c.map_index
                           AND g.state <> 'cancelled'
     WHERE gt.game_id = g.id AND gt.encounter_team_id = et.id AND gt.replay_code IS NULL
    """,
)

_CLAIMS_AND_REPORTS = (
    # A map report was one side's claim about one game. ``basis_version = 0``:
    # the claims predate versioning, so they are all based on "no result yet".
    """
    INSERT INTO encounter.game_claim
           (created_at, updated_at, encounter_id, game_id, claimant_team_id, reporter_user_id, basis_version)
         SELECT mr.created_at, mr.updated_at, g.encounter_id, mr.game_id, et.id, mr.reporter_user_id, 0
           FROM tournament.encounter_map_report mr
           JOIN encounter.game g ON g.id = mr.game_id
           JOIN encounter.team et ON et.encounter_id = g.encounter_id
                                 AND et.slot = CASE mr.side WHEN 'home' THEN 1 WHEN 'away' THEN 2 END
    ON CONFLICT (game_id, claimant_team_id) DO NOTHING
    """,
    """
    INSERT INTO encounter.game_claim_result (claim_id, game_id, encounter_team_id, score)
         SELECT c.id, c.game_id, et.id, CASE et.slot WHEN 1 THEN mr.home_score WHEN 2 THEN mr.away_score END
           FROM tournament.encounter_map_report mr
           JOIN encounter.game g ON g.id = mr.game_id
           JOIN encounter.team claimant ON claimant.encounter_id = g.encounter_id
                                       AND claimant.slot = CASE mr.side WHEN 'home' THEN 1 WHEN 'away' THEN 2 END
           JOIN encounter.game_claim c ON c.game_id = mr.game_id AND c.claimant_team_id = claimant.id
           JOIN encounter.team et ON et.encounter_id = g.encounter_id AND et.slot IN (1, 2)
    ON CONFLICT (claim_id, encounter_team_id) DO NOTHING
    """,
    # ``games_played`` stays NULL: a captain report carried a score, never how
    # many games it took, and the number is not invented here (D59).
    """
    INSERT INTO encounter.team_report
           (created_at, updated_at, encounter_id, encounter_team_id, reporter_user_id, games_played,
            basis_version, closeness, comment, custom_fields_json)
         SELECT cr.created_at, cr.updated_at, cr.encounter_id, et.id, cr.reporter_user_id, NULL,
                0, cr.closeness, cr.comment, cr.custom_fields_json
           FROM tournament.encounter_captain_report cr
           JOIN encounter.team et ON et.encounter_id = cr.encounter_id AND et.team_id = cr.team_id
    ON CONFLICT (encounter_id, encounter_team_id) DO NOTHING
    """,
    """
    INSERT INTO encounter.team_report_result (report_id, encounter_id, encounter_team_id, score)
         SELECT tr.id, tr.encounter_id, et.id,
                CASE et.slot WHEN 1 THEN cr.home_score WHEN 2 THEN cr.away_score END
           FROM tournament.encounter_captain_report cr
           JOIN encounter.team reporter ON reporter.encounter_id = cr.encounter_id
                                       AND reporter.team_id = cr.team_id
           JOIN encounter.team_report tr ON tr.encounter_id = cr.encounter_id
                                        AND tr.encounter_team_id = reporter.id
           JOIN encounter.team et ON et.encounter_id = cr.encounter_id AND et.slot IN (1, 2)
    ON CONFLICT (report_id, encounter_team_id) DO NOTHING
    """,
    """
    INSERT INTO encounter.readiness (created_at, updated_at, encounter_id, encounter_team_id, ready_user_id)
         SELECT r.created_at, r.updated_at, r.encounter_id, et.id, r.ready_user_id
           FROM tournament.encounter_readiness r
           JOIN encounter.team et ON et.encounter_id = r.encounter_id
                                 AND et.slot = CASE r.side WHEN 'home' THEN 1 WHEN 'away' THEN 2 END
    ON CONFLICT (encounter_id, encounter_team_id) DO NOTHING
    """,
    """
    UPDATE encounter.room_event re SET encounter_team_id = et.id
      FROM encounter.team et
     WHERE et.encounter_id = re.encounter_id
       AND et.slot = CASE re.side WHEN 'home' THEN 1 WHEN 'away' THEN 2 END
       AND re.encounter_team_id IS NULL
    """,
)

_PICK_BAN = (
    """
    UPDATE encounter.pick_ban_entry e SET encounter_id = s.encounter_id
      FROM encounter.pick_ban_session s WHERE s.id = e.session_id AND e.encounter_id IS NULL
    """,
    """
    UPDATE encounter.pick_ban_submission sub SET encounter_id = s.encounter_id
      FROM encounter.pick_ban_session s WHERE s.id = sub.session_id AND sub.encounter_id IS NULL
    """,
    # A side becomes a participation; ``decider``/``admin`` keep their meaning in
    # the actor kind, which is what the old enum conflated (§13.4).
    *(
        f"""
        UPDATE encounter.pick_ban_entry e
           SET {column}_kind = CASE WHEN e.{column}::text IN ('home', 'away') THEN 'team'
                                    ELSE e.{column}::text END::encounter.pickbanactor,
               {column}_team_id = CASE WHEN e.{column}::text IN ('home', 'away') THEN (
                   SELECT t.id FROM encounter.team t
                    WHERE t.encounter_id = e.encounter_id
                      AND t.slot = CASE e.{column}::text WHEN 'home' THEN 1 ELSE 2 END) END
         WHERE e.{column} IS NOT NULL AND e.{column}_kind IS NULL
        """
        for column in ("picked_by", "protected_by")
    ),
    """
    UPDATE encounter.pick_ban_submission sub SET encounter_team_id = t.id
      FROM encounter.team t
     WHERE t.encounter_id = sub.encounter_id
       AND t.slot = CASE sub.side WHEN 'home' THEN 1 WHEN 'away' THEN 2 END
       AND sub.encounter_team_id IS NULL
    """,
    """
    UPDATE encounter.pick_ban_session s
       SET first_team_id = (SELECT t.id FROM encounter.team t
                             WHERE t.encounter_id = s.encounter_id
                               AND t.slot = CASE s.first_side::text WHEN 'home' THEN 1 WHEN 'away' THEN 2 END),
           pending_chooser_team_id = (SELECT t.id FROM encounter.team t
                             WHERE t.encounter_id = s.encounter_id
                               AND t.slot = CASE s.pending_loser_side::text
                                            WHEN 'home' THEN 1 WHEN 'away' THEN 2 END),
           undo_requested_by_team_id = (SELECT t.id FROM encounter.team t
                             WHERE t.encounter_id = s.encounter_id
                               AND t.slot = CASE s.undo_requested_by::text
                                            WHEN 'home' THEN 1 WHEN 'away' THEN 2 END)
     WHERE s.first_side IS NOT NULL OR s.pending_loser_side IS NOT NULL OR s.undo_requested_by IS NOT NULL
    """,
    # The seeds were the room's; they belong to the seat. One encounter may hold
    # a map and a hero room, so the lowest session id wins deterministically.
    """
    WITH seed AS (
        SELECT DISTINCT ON (encounter_id) encounter_id, home_seed, away_seed
          FROM encounter.pick_ban_session
         WHERE home_seed IS NOT NULL OR away_seed IS NOT NULL
         ORDER BY encounter_id, id
    )
    UPDATE encounter.team t SET seed = CASE t.slot WHEN 1 THEN seed.home_seed WHEN 2 THEN seed.away_seed END
      FROM seed
     WHERE seed.encounter_id = t.encounter_id AND t.slot IN (1, 2) AND t.seed IS NULL
       AND (CASE t.slot WHEN 1 THEN seed.home_seed WHEN 2 THEN seed.away_seed END) IS NOT NULL
    """,
)

#: Advancement stops speaking of winners and sides: a link is "the Nth place of
#: this encounter fills that encounter's Mth seat" (D13, D65).
_LINKS = """
    UPDATE tournament.encounter_link l
       SET tournament_id = e.tournament_id,
           source_position = CASE l.role::text WHEN 'winner' THEN 1 WHEN 'loser' THEN 2 END,
           target_slot = CASE l.legacy_target_slot::text WHEN 'home' THEN 1 WHEN 'away' THEN 2 END
      FROM encounter.encounter e
     WHERE e.id = l.source_encounter_id AND l.tournament_id IS NULL
"""

_AUDIT_VERSIONS = (
    # The journal had no versions; its order is its history, so the rows are
    # numbered by when they were written and the encounter carries the count.
    """
    WITH numbered AS (
        SELECT id, row_number() OVER (PARTITION BY encounter_id ORDER BY created_at, id) AS version
          FROM encounter.result_audit
    )
    UPDATE encounter.result_audit a SET result_version = n.version
      FROM numbered n WHERE n.id = a.id AND a.result_version IS NULL
    """,
    """
    UPDATE encounter.encounter e SET result_version = counted.rows
      FROM (SELECT encounter_id, count(*) AS rows FROM encounter.result_audit GROUP BY encounter_id) counted
     WHERE counted.encounter_id = e.id AND e.result_version = 0
    """,
)

_FINALIZE = (
    # The backfill wrote through deferred foreign keys (the rules, the roster
    # snapshots, the game rows); their checks are still queued, and ALTER TABLE
    # refuses to touch a table with pending trigger events. Firing them here
    # also means a reference the backfill got wrong fails BEFORE the NOT NULLs
    # and the validations, which is the error worth reading.
    "SET CONSTRAINTS ALL IMMEDIATE",
    """
    ALTER TABLE encounter.encounter
      ALTER COLUMN workspace_id    SET NOT NULL,
      ALTER COLUMN discipline      SET NOT NULL,
      ALTER COLUMN scoring_rule_id SET NOT NULL,
      ALTER COLUMN slot_count      SET NOT NULL
    """,
    "ALTER TABLE tournament.stage ALTER COLUMN scoring_rule_id SET NOT NULL",
    """
    ALTER TABLE encounter.result_audit
      ALTER COLUMN result_version SET NOT NULL,
      ALTER COLUMN snapshot_scope SET NOT NULL,
      ALTER COLUMN "after"        SET NOT NULL
    """,
    "ALTER TABLE encounter.pick_ban_session ALTER COLUMN pool_json SET NOT NULL",
    "ALTER TABLE encounter.pick_ban_entry ALTER COLUMN encounter_id SET NOT NULL",
    "ALTER TABLE encounter.pick_ban_submission ALTER COLUMN encounter_id SET NOT NULL",
    """
    ALTER TABLE tournament.encounter_link
      ALTER COLUMN tournament_id   SET NOT NULL,
      ALTER COLUMN source_position SET NOT NULL,
      ALTER COLUMN target_slot     SET NOT NULL
    """,
    # Only buildable now: every pre-migration row had NULL ``encounter_team_id``
    # and NULLS NOT DISTINCT would have collided on the two sides of one step.
    """
    CREATE UNIQUE INDEX uq_pick_ban_submission_step_team_attempt
        ON encounter.pick_ban_submission (session_id, step_index, encounter_team_id, attempt) NULLS NOT DISTINCT
    """,
    # Every constraint the schema half could only add NOT VALID, now that the
    # data behind it exists, except the ``matches.*`` foreign keys (``enclayer01b``).
    # ``ck_encounter_result_version`` is not here: it was added VALID against a
    # column that was born defaulted to 0.
    *(
        f"ALTER TABLE {table} VALIDATE CONSTRAINT {name}"
        for table, name in (
            ("encounter.encounter", "fk_encounter_owner"),
            ("encounter.encounter", "fk_encounter_scoring_rule"),
            ("encounter.encounter", "ck_encounter_best_of"),
            ("encounter.encounter", "ck_encounter_slot_count"),
            ("encounter.encounter", "ck_encounter_result_source"),
            ("encounter.encounter", "ck_encounter_confirmed_source"),
            ("encounter.result_audit", "fk_result_audit_game"),
            ("encounter.result_audit", "fk_result_audit_adopted"),
            ("encounter.result_audit", "ck_result_audit_scope"),
            ("encounter.result_audit", "ck_result_audit_game_scope"),
            ("encounter.room_event", "fk_room_event_team"),
            ("encounter.pick_ban_session", "fk_pick_ban_session_first_team"),
            ("encounter.pick_ban_session", "fk_pick_ban_session_pending_chooser"),
            ("encounter.pick_ban_session", "fk_pick_ban_session_undo_requested_by"),
            ("encounter.pick_ban_entry", "fk_pick_ban_entry_session"),
            ("encounter.pick_ban_entry", "fk_pick_ban_entry_picked_by"),
            ("encounter.pick_ban_entry", "fk_pick_ban_entry_protected_by"),
            ("encounter.pick_ban_entry", "ck_pick_ban_entry_picked_by"),
            ("encounter.pick_ban_entry", "ck_pick_ban_entry_protected_by"),
            ("encounter.pick_ban_submission", "fk_pick_ban_submission_session"),
            ("encounter.pick_ban_submission", "fk_pick_ban_submission_team"),
            ("tournament.encounter_link", "fk_link_source"),
            ("tournament.encounter_link", "fk_link_target"),
            ("tournament.encounter_link", "ck_link_not_self"),
            ("tournament.encounter_link", "ck_link_positions"),
        )
    ),
)

_INSERT_RULE = (
    "INSERT INTO encounter.scoring_rule"
    " (workspace_id, preset, columns, placement_points, game_formula, end_formula)"
    " VALUES (:workspace_id, :preset, CAST(:columns AS JSONB), CAST(:placement_points AS FLOAT8[]),"
    " :game_formula, :end_formula) RETURNING id"
)


def _rule_params(workspace_id: int, rule: dict) -> dict:
    """A rule dict as bind parameters. The array goes as a literal: an empty
    Python list has no element type for the driver to infer."""
    return {
        "workspace_id": workspace_id,
        "preset": rule["preset"],
        "columns": json.dumps(rule["columns"]),
        "placement_points": "{" + ",".join(repr(float(points)) for points in rule["placement_points"]) + "}",
        "game_formula": rule["game_formula"],
        "end_formula": rule["end_formula"],
    }


def _write_many(bind, statement: str, rows: list[dict]) -> None:
    """One executemany for rows the converters had to build in Python.

    ponytail: parameter sets, not a temporary table -- psycopg pipelines them,
    and a cutover window is allowed to take minutes.
    """
    if rows:
        bind.execute(sa.text(statement), rows)


def _scoring_rules(bind) -> None:
    """One rule per stage, plus one ``wins`` rule per tournament for the
    encounters that belong to no stage (freeplay, imports)."""
    stages = (
        bind.execute(
            sa.text(
                "SELECT s.id, s.stage_type::text AS stage_type, s.ffa_columns, s.ffa_formula,"
                " s.ffa_placement_points, t.workspace_id"
                " FROM tournament.stage s JOIN tournament.tournament t ON t.id = s.tournament_id"
                " WHERE s.scoring_rule_id IS NULL ORDER BY s.id"
            )
        )
        .mappings()
        .all()
    )
    for stage in stages:
        rule = scoring_rule_for_stage(
            stage["stage_type"], stage["ffa_columns"], stage["ffa_formula"], stage["ffa_placement_points"]
        )
        rule_id = bind.execute(sa.text(_INSERT_RULE), _rule_params(stage["workspace_id"], rule)).scalar_one()
        bind.execute(
            sa.text("UPDATE tournament.stage SET scoring_rule_id = :rule_id WHERE id = :stage_id"),
            {"rule_id": rule_id, "stage_id": stage["id"]},
        )

    stageless = (
        bind.execute(
            sa.text(
                "SELECT DISTINCT t.id, t.workspace_id FROM encounter.encounter e"
                " JOIN tournament.tournament t ON t.id = e.tournament_id"
                " WHERE e.stage_id IS NULL AND e.scoring_rule_id IS NULL ORDER BY 1"
            )
        )
        .mappings()
        .all()
    )
    for tournament in stageless:
        rule_id = bind.execute(
            sa.text(_INSERT_RULE), _rule_params(tournament["workspace_id"], wins_rule())
        ).scalar_one()
        bind.execute(
            sa.text(
                "UPDATE encounter.encounter SET scoring_rule_id = :rule_id"
                " WHERE tournament_id = :tournament_id AND stage_id IS NULL AND scoring_rule_id IS NULL"
            ),
            {"rule_id": rule_id, "tournament_id": tournament["id"]},
        )


def _participations(bind) -> None:
    """The two sides of a duel become seats 1 and 2; a lobby's participants keep
    their slots. An empty seat (TBD) gets no row at all."""
    duels = (
        bind.execute(
            sa.text(
                "SELECT e.id, e.tournament_id, e.home_team_id, e.away_team_id, e.home_score, e.away_score,"
                " e.status::text = 'COMPLETED' AS completed,"
                " left(home.name, 255) AS home_name, left(away.name, 255) AS away_name"
                " FROM encounter.encounter e"
                " LEFT JOIN tournament.team home ON home.id = e.home_team_id"
                " LEFT JOIN tournament.team away ON away.id = e.away_team_id"
                " WHERE e.format = 'duel' AND (e.home_team_id IS NOT NULL OR e.away_team_id IS NOT NULL)"
                "   AND NOT EXISTS (SELECT 1 FROM encounter.team t WHERE t.encounter_id = e.id)"
                " ORDER BY e.id"
            )
        )
        .mappings()
        .all()
    )
    rows: list[dict] = []
    for duel in duels:
        places = duel_placements(duel["home_score"] or 0, duel["away_score"] or 0, duel["completed"])
        seats = (
            (1, duel["home_team_id"], duel["home_name"], duel["home_score"], places[0]),
            (2, duel["away_team_id"], duel["away_name"], duel["away_score"], places[1]),
        )
        for slot, team_id, name, score, placement in seats:
            if team_id is None:
                continue
            rows.append(
                {
                    "encounter_id": duel["id"],
                    "tournament_id": duel["tournament_id"],
                    "slot": slot,
                    "team_id": team_id,
                    "name": name,
                    "score": float(score or 0),
                    "placement": placement,
                }
            )
    _write_many(
        bind,
        "INSERT INTO encounter.team (encounter_id, tournament_id, slot, team_id, name, score, placement)"
        " VALUES (:encounter_id, :tournament_id, :slot, :team_id, :name, :score, :placement)",
        rows,
    )
    # Lobby scores and placements are the level-2 calculator's answer, which runs
    # in Python after the migration (backend/scripts/enclayer01_recompute_lobbies.py).
    op.execute(_FFA_PARTICIPATIONS)


def _game_results(bind) -> None:
    """Accepted game results, per participation."""
    op.execute(_GAME_TEAM_ROWS)
    games = (
        bind.execute(
            sa.text(
                "SELECT g.id AS game_id, g.accepted_home_score AS home_score, g.accepted_away_score AS away_score,"
                " first.id AS first_team_id, second.id AS second_team_id"
                " FROM encounter.game g"
                " JOIN encounter.team first ON first.encounter_id = g.encounter_id AND first.slot = 1"
                " JOIN encounter.team second ON second.encounter_id = g.encounter_id AND second.slot = 2"
                " WHERE g.accepted_home_score IS NOT NULL AND g.accepted_away_score IS NOT NULL"
                " ORDER BY g.id"
            )
        )
        .mappings()
        .all()
    )
    rows: list[dict] = []
    for game in games:
        places = duel_placements(game["home_score"], game["away_score"], True)
        rows.append(
            {
                "game_id": game["game_id"],
                "encounter_team_id": game["first_team_id"],
                "score": game["home_score"],
                "placement": places[0],
            }
        )
        rows.append(
            {
                "game_id": game["game_id"],
                "encounter_team_id": game["second_team_id"],
                "score": game["away_score"],
                "placement": places[1],
            }
        )
    _write_many(
        bind,
        "UPDATE encounter.game_team SET score = :score, placement = :placement"
        " WHERE game_id = :game_id AND encounter_team_id = :encounter_team_id",
        rows,
    )
    for statement in _GAME_RESULTS:
        op.execute(statement)


def _rulesets(bind) -> None:
    """``home``/``away`` actors become slots, in the configs and in the snapshot
    every running room took of its config (§13.7)."""
    for table in ("tournament.pick_ban_config", "encounter.pick_ban_session"):
        documents = (
            bind.execute(
                sa.text(
                    f"SELECT id, ruleset_json FROM {table}"
                    """ WHERE ruleset_json::text ~ '"actors"\\s*:\\s*"(home|away)"' ORDER BY id"""
                )
            )
            .mappings()
            .all()
        )
        _write_many(
            bind,
            f"UPDATE {table} SET ruleset_json = CAST(:ruleset AS JSON) WHERE id = :id",
            [{"id": row["id"], "ruleset": json.dumps(rewrite_ruleset(row["ruleset_json"]))} for row in documents],
        )


def _pools(bind) -> None:
    """Every room opened before the cutover gets the pool snapshot the V1 room
    reads, built off its config as it stands now (D6)."""
    sessions = (
        bind.execute(
            sa.text(
                "SELECT s.id, s.kind::text AS kind, s.config_id, e.best_of,"
                " c.mode::text AS mode, c.first_ban_rotation::text AS rotation"
                " FROM encounter.pick_ban_session s"
                " JOIN encounter.encounter e ON e.id = s.encounter_id"
                " LEFT JOIN tournament.pick_ban_config c ON c.id = s.config_id"
                " WHERE s.pool_json IS NULL ORDER BY s.id"
            )
        )
        .mappings()
        .all()
    )
    config_ids = sorted({row["config_id"] for row in sessions if row["config_id"] is not None})
    items: dict[int, list[int]] = {}
    slots: dict[int, dict[int, list[int]]] = {}
    if config_ids:
        for row in bind.execute(
            sa.text(
                "SELECT pick_ban_config_id, item_id FROM tournament.pick_ban_config_item"
                " WHERE pick_ban_config_id = ANY(:ids) ORDER BY pick_ban_config_id, sort_order, item_id"
            ),
            {"ids": config_ids},
        ).mappings():
            items.setdefault(row["pick_ban_config_id"], []).append(row["item_id"])
        # LEFT JOIN: a slot with no items is still a slot, and the room indexes
        # slots by round.
        for row in bind.execute(
            sa.text(
                "SELECT sl.pick_ban_config_id, sl.position, si.item_id"
                " FROM tournament.pick_ban_config_slot sl"
                " LEFT JOIN tournament.pick_ban_config_slot_item si ON si.pick_ban_config_slot_id = sl.id"
                " WHERE sl.pick_ban_config_id = ANY(:ids)"
                " ORDER BY sl.pick_ban_config_id, sl.position, si.sort_order, si.item_id"
            ),
            {"ids": config_ids},
        ).mappings():
            by_position = slots.setdefault(row["pick_ban_config_id"], {})
            by_position.setdefault(row["position"], [])
            if row["item_id"] is not None:
                by_position[row["position"]].append(row["item_id"])
    rows: list[dict] = []
    for row in sessions:
        by_position = slots.get(row["config_id"], {})
        pool = pool_snapshot(
            row["mode"],
            row["rotation"],
            row["kind"],
            row["best_of"],
            items.get(row["config_id"], []),
            [by_position[position] for position in sorted(by_position)],
        )
        rows.append({"id": row["id"], "pool": json.dumps(pool)})
    _write_many(bind, "UPDATE encounter.pick_ban_session SET pool_json = CAST(:pool AS JSON) WHERE id = :id", rows)


def _notifications(bind) -> None:
    """Stored ``encounter.scheduled``/``encounter.dispute_review`` rows say
    ``team_names``, not home/away (§13.7): the inbox renders nothing else."""
    rows = (
        bind.execute(
            sa.text(
                "SELECT id, payload_json FROM notification WHERE kind = ANY(:kinds)"
                " AND jsonb_exists_any(payload_json, ARRAY['home_team_name', 'away_team_name']) ORDER BY id"
            ),
            {"kinds": list(_NOTIFICATION_KINDS)},
        )
        .mappings()
        .all()
    )
    _write_many(
        bind,
        "UPDATE notification SET payload_json = CAST(:payload AS JSONB) WHERE id = :id",
        [{"id": row["id"], "payload": json.dumps(notification_payload(row["payload_json"]))} for row in rows],
    )


def _audit(bind) -> None:
    """The journal's score pairs and lobby blobs become one shape over
    participations, and the rows get the versions they never had."""
    participations = (
        bind.execute(
            sa.text(
                "SELECT t.encounter_id, t.id, t.slot, t.team_id FROM encounter.team t"
                " WHERE EXISTS (SELECT 1 FROM encounter.result_audit a WHERE a.encounter_id = t.encounter_id)"
            )
        )
        .mappings()
        .all()
    )
    by_slot: dict[int, dict[int, int]] = {}
    by_team: dict[int, dict[int, int]] = {}
    for row in participations:
        by_slot.setdefault(row["encounter_id"], {})[row["slot"]] = row["id"]
        if row["team_id"] is not None:
            by_team.setdefault(row["encounter_id"], {})[row["team_id"]] = row["id"]

    rows: list[dict] = []
    orphans: list[tuple[int, int, int]] = []
    audit = bind.execute(
        sa.text(
            "SELECT id, encounter_id, home_score_before, away_score_before, home_score_after, away_score_after,"
            ' ffa_results_json, game_id, adopted_team_id FROM encounter.result_audit WHERE "after" IS NULL'
            " ORDER BY id"
        )
    ).mappings()
    for row in audit:
        teams = by_team.get(row["encounter_id"], {})
        snapshot = audit_snapshot(dict(row), by_slot.get(row["encounter_id"], {}), teams)
        adopted = row["adopted_team_id"]
        # ``adopted_team_id`` is the SAME column changing meaning, not a copy:
        # writing NULL over an id that resolves to no seat would destroy the
        # only record of whose report was taken as truth. The guard above means
        # this cannot happen; if it ever does, the cutover stops with the rows.
        if adopted is not None and adopted not in teams:
            orphans.append((row["id"], row["encounter_id"], adopted))
            continue
        rows.append(
            {
                "id": row["id"],
                "before": None if snapshot["before"] is None else json.dumps(snapshot["before"]),
                "after": json.dumps(snapshot["after"]),
                "snapshot_scope": snapshot["snapshot_scope"],
                "adopted_team_id": None if adopted is None else teams[adopted],
            }
        )
    if orphans:
        listed = "; ".join(
            f"result_audit {audit_id} (encounter {encounter_id}) adopted team {team_id}"
            for audit_id, encounter_id, team_id in orphans[:PREFLIGHT_SAMPLE]
        )
        rest = len(orphans) - PREFLIGHT_SAMPLE
        raise RuntimeError(
            f"enclayer01 cannot remap {len(orphans)} adopted team(s) to a participation: {listed}"
            + (f"; … {rest} more" if rest > 0 else "")
        )
    _write_many(
        bind,
        'UPDATE encounter.result_audit SET "before" = CAST(:before AS JSONB), "after" = CAST(:after AS JSONB),'
        " snapshot_scope = :snapshot_scope, adopted_team_id = :adopted_team_id WHERE id = :id",
        rows,
    )
    for statement in _AUDIT_VERSIONS:
        op.execute(statement)


def _result_source(bind) -> None:
    """Where each confirmed encounter's official result came from (D57)."""
    encounters = (
        bind.execute(
            sa.text(
                "SELECT e.id, e.home_score, e.away_score, e.format = 'ffa' AS lobby,"
                " agg.first_wins, agg.second_wins, agg.scored_games, agg.confirmed_games"
                " FROM encounter.encounter e"
                " LEFT JOIN LATERAL ("
                "   SELECT count(*) FILTER (WHERE g.accepted_home_score > g.accepted_away_score) AS first_wins,"
                "          count(*) FILTER (WHERE g.accepted_away_score > g.accepted_home_score) AS second_wins,"
                "          count(*) FILTER (WHERE g.accepted_home_score IS NOT NULL"
                "                             AND g.accepted_away_score IS NOT NULL) AS scored_games,"
                "          count(*) AS confirmed_games"
                "     FROM encounter.game g"
                "    WHERE g.encounter_id = e.id AND g.state::text = 'confirmed') agg ON TRUE"
                " WHERE e.result_status::text = 'confirmed' AND e.result_source IS NULL"
                " ORDER BY e.id"
            )
        )
        .mappings()
        .all()
    )
    rows = [
        {
            "id": row["id"],
            "result_source": result_source_for(
                True,
                (row["home_score"] or 0, row["away_score"] or 0),
                (row["first_wins"], row["second_wins"]) if row["scored_games"] else None,
                lobby_with_games=bool(row["lobby"]) and row["confirmed_games"] > 0,
            ),
        }
        for row in encounters
    ]
    _write_many(bind, "UPDATE encounter.encounter SET result_source = :result_source WHERE id = :id", rows)


def _backfill() -> None:
    """§13.8, row by row: owner keys, rules, seats, rosters, results, journal."""
    bind = op.get_bind()
    for statement in _DISCIPLINE:
        op.execute(statement)
    # FIRST of everything that touches an encounter row: ``ck_encounter_confirmed_source``
    # was added NOT VALID, which still binds every row an UPDATE rewrites, and a
    # confirmed encounter without a source fails it. Nothing here needs the
    # participations -- the answer comes from the stored score and the games.
    _result_source(bind)
    _scoring_rules(bind)
    for statement in _ENCOUNTER_COLUMNS:
        op.execute(statement)
    _participations(bind)
    for statement in _ROSTERS:
        op.execute(statement)
    _game_results(bind)
    for statement in (*_CLAIMS_AND_REPORTS, *_PICK_BAN, _LINKS):
        op.execute(statement)
    _pools(bind)
    _rulesets(bind)
    _notifications(bind)
    _audit(bind)
    for statement in _FINALIZE:
        op.execute(statement)


def upgrade() -> None:
    _take_locks()
    _preflight()
    for statement in (*_SCHEMAS_AND_TYPES, *_MOVE_TABLES, *_OWNER_KEYS, *_NEW_TABLES, *_RESHAPE, *_EXTERNAL):
        op.execute(statement)
    _backfill()


def downgrade() -> None:
    # Forward-fix only, as ffa0001. A downgrade would have to move seven tables
    # and nine types back and throw away every participation, roster snapshot,
    # claim and report written since -- there is no safe automatic answer.
    raise RuntimeError("enclayer01 is forward-fix only; restore from a backup to go back")
