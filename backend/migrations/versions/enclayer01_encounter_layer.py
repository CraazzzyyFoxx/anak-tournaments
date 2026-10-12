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

Revision ID: enclayer01
Revises: apikeysu01
"""

from __future__ import annotations

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
#: ``NOT VALID`` so re-adding them does not scan 27M statistics rows under an
#: ACCESS EXCLUSIVE lock -- the data half validates them.
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


def upgrade() -> None:
    _take_locks()
    for statement in (*_SCHEMAS_AND_TYPES, *_MOVE_TABLES, *_OWNER_KEYS, *_NEW_TABLES, *_RESHAPE, *_EXTERNAL):
        op.execute(statement)

    # The data half of this revision follows here. It backfills every column
    # added above, then SET NOT NULL / VALIDATE CONSTRAINT, and creates
    # ``uq_pick_ban_submission_step_team_attempt`` (session_id, step_index,
    # encounter_team_id, attempt) NULLS NOT DISTINCT -- which cannot be built
    # before ``encounter_team_id`` is filled, since every existing row would
    # collide on NULL.


def downgrade() -> None:
    # Forward-fix only, as ffa0001. A downgrade would have to move seven tables
    # and nine types back and throw away every participation, roster snapshot,
    # claim and report written since -- there is no safe automatic answer.
    raise RuntimeError("enclayer01 is forward-fix only; restore from a backup to go back")
