"""``tournament.encounter_game``: the series position is the unit of result.

Revision ID: encgame01
Revises: draftot01
Create Date: 2026-09-22 00:00:00.000000

Creates ``encounter_game`` (one row per position of an encounter's series, with
the accepted score and who accepted it), hangs the per-game decision columns off
``encounter_result_audit``, and re-keys ``encounter_map_report`` from
``(encounter_id, map_id, map_index, team_id)`` onto ``(game_id, side)`` — a
series can play the same map twice, so the map was never a key.

**This migration is ONLINE-ONLY.** It SELECTs the legacy per-map rows out of the
database and converts them; it cannot run against an empty schema plan or be
reasoned about from the DDL alone. The conversion itself is a pure function,
``plan_games`` at the foot of this file: it reads shapes that only exist before
this revision runs, so it lives with the revision that applies it.

What it converts
----------------
* ``encounter_map_report`` rows, where no captain match covers the position: two
  agreeing sides become a ``confirmed`` game, two disagreeing sides a
  ``disputed`` one, a lone claim ``awaiting_result``.
* ``matches.match`` rows with ``source='captain_report'``: these were written by
  the old ``submit_map_report`` reconciliation purely to carry a score, i.e.
  only once both captains had agreed, so one IS an accepted result (spec §13B)
  and confirms its position whatever reports survived beside it. They are not
  observations of a log, so they become games and are **deleted** (spec §5.1: a
  Match is what a log observed, never what the tournament decided). The deleted
  ids are logged — that log is the dev manifest; production Stage A produces its
  own.
* ``pick_ban_entry.status='played'`` → ``'picked'``. "Played" is now the game's
  state, not the pick's. The ``played`` label stays on the PostgreSQL type
  ``tournament.pickbanentrystatus``: PostgreSQL cannot drop an enum label, and
  rebuilding the type would need an exclusive lock on every table using it.
* Live encounter scores are re-materialised from the confirmed games, for
  encounters that are not yet ``COMPLETED``. A finalized encounter keeps its
  official score — nothing here re-decides one.

Ambiguity aborts, it never guesses. A position claimed by two different maps, or
legacy ``map_index=0`` rows that play one map twice with no position to separate
them, raises ``RuntimeError`` and rolls the whole transaction back; an operator
sets ``map_index`` by hand and re-runs (spec §13B).

Downgrade rebuilds the four legacy report columns from ``encounter_game`` (and
the encounter's sides, for ``team_id``) and drops everything this revision
added. It does **not** restore the deleted ``captain_report`` matches, and it
does not restore ``pick_ban_entry.status='played'`` — both are information this
revision deliberately dropped. Per spec §13D there is no lossy automatic
downgrade after cutover; this is the pre-cutover dev path.
"""

# NB: deliberately NO ``from __future__ import annotations``. Alembic loads a
# revision by path without registering it in ``sys.modules``, and ``dataclasses``
# resolves STRING annotations through that missing entry -- the plan's types at
# the foot of this file would die on import. Real annotation objects skip that
# lookup entirely, and every form used here is valid at runtime.
import logging
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "encgame01"
down_revision: str | Sequence[str] | None = "draftot01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

log = logging.getLogger("alembic.runtime.migration")

GAME_STATES = ("planned", "awaiting_result", "disputed", "confirmed", "cancelled")
RESULT_SOURCES = ("captain_agreement", "admin", "admin_log")
AUDIT_GAME_ACTIONS = ("game_confirm", "game_correct", "game_cancel")

_LOAD_REPORTS = """
SELECT id, encounter_id, map_id, map_index, team_id, home_score, away_score, created_at
FROM tournament.encounter_map_report
"""

_LOAD_MATCHES = """
SELECT id, encounter_id, map_id, map_index, home_score, away_score, created_at
FROM matches.match
WHERE source = 'captain_report'
"""


def _plan(conn) -> BackfillPlan:
    reports = [
        LegacyReport(
            id=row.id,
            encounter_id=row.encounter_id,
            map_id=row.map_id,
            map_index=row.map_index or 0,
            team_id=row.team_id,
            home_score=row.home_score,
            away_score=row.away_score,
            created_at=row.created_at,
        )
        for row in conn.execute(sa.text(_LOAD_REPORTS))
    ]
    matches = [
        LegacyCaptainMatch(
            id=row.id,
            encounter_id=row.encounter_id,
            map_id=row.map_id,
            map_index=row.map_index,
            home_score=row.home_score,
            away_score=row.away_score,
            created_at=row.created_at,
        )
        for row in conn.execute(sa.text(_LOAD_MATCHES))
    ]
    encounter_ids = sorted({row.encounter_id for row in reports} | {match.encounter_id for match in matches})
    sides: dict[int, EncounterSides] = {}
    if encounter_ids:
        rows = conn.execute(
            sa.text("SELECT id, home_team_id, away_team_id FROM tournament.encounter WHERE id IN :ids").bindparams(
                sa.bindparam("ids", expanding=True)
            ),
            {"ids": encounter_ids},
        )
        sides = {row.id: EncounterSides(home_team_id=row.home_team_id, away_team_id=row.away_team_id) for row in rows}
    return plan_games(reports, matches, sides)


def _insert_games(conn, plan: BackfillPlan) -> dict[tuple[int, int], int]:
    """Insert the planned games; return ``planner key -> new id``."""
    if not plan.games:
        return {}
    conn.execute(
        sa.text(
            """
            INSERT INTO tournament.encounter_game
                (encounter_id, position, map_id, state, accepted_home_score, accepted_away_score,
                 result_source, confirmed_at)
            VALUES
                (:encounter_id, :position, :map_id, CAST(:state AS tournament.encountergamestate),
                 :accepted_home_score, :accepted_away_score,
                 CAST(:result_source AS tournament.encountergameresultsource), :confirmed_at)
            """
        ),
        [
            {
                "encounter_id": game.encounter_id,
                "position": game.position,
                "map_id": game.map_id,
                "state": game.state,
                "accepted_home_score": game.accepted_home_score,
                "accepted_away_score": game.accepted_away_score,
                # Every accepted score here came from the two captains agreeing,
                # directly or through the match row that agreement wrote.
                "result_source": "captain_agreement" if game.state == "confirmed" else None,
                "confirmed_at": game.confirmed_at,
            }
            for game in plan.games
        ],
    )
    # The table was created empty two statements ago, so reading it back is the
    # whole mapping — cheaper and less dialect-dependent than executemany
    # RETURNING.
    return {
        (row.encounter_id, row.position): row.id
        for row in conn.execute(sa.text("SELECT id, encounter_id, position FROM tournament.encounter_game"))
    }


def upgrade() -> None:
    conn = op.get_bind()

    op.execute(
        "CREATE TYPE tournament.encountergamestate AS ENUM (" + ", ".join(f"'{value}'" for value in GAME_STATES) + ")"
    )
    op.execute(
        "CREATE TYPE tournament.encountergameresultsource AS ENUM ("
        + ", ".join(f"'{value}'" for value in RESULT_SOURCES)
        + ")"
    )
    # Labels only — PostgreSQL forbids USING a value added to a pre-existing
    # enum inside the transaction that added it, and nothing here writes one.
    for action in AUDIT_GAME_ACTIONS:
        op.execute(f"ALTER TYPE tournament.encounterresultauditaction ADD VALUE IF NOT EXISTS '{action}'")

    op.create_table(
        "encounter_game",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("map_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "state",
            postgresql.ENUM(*GAME_STATES, name="encountergamestate", schema="tournament", create_type=False),
            server_default="planned",
            nullable=False,
        ),
        sa.Column("accepted_home_score", sa.Integer(), nullable=True),
        sa.Column("accepted_away_score", sa.Integer(), nullable=True),
        sa.Column(
            "result_source",
            postgresql.ENUM(*RESULT_SOURCES, name="encountergameresultsource", schema="tournament", create_type=False),
            nullable=True,
        ),
        sa.Column("result_version", sa.Integer(), server_default="0", nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("position >= 1", name="ck_encounter_game_position"),
        sa.CheckConstraint(
            "accepted_home_score IS NULL OR accepted_home_score >= 0", name="ck_encounter_game_home_score"
        ),
        sa.CheckConstraint(
            "accepted_away_score IS NULL OR accepted_away_score >= 0", name="ck_encounter_game_away_score"
        ),
        sa.CheckConstraint(
            "state != 'confirmed' OR (accepted_home_score IS NOT NULL AND accepted_away_score IS NOT NULL "
            "AND result_source IS NOT NULL AND confirmed_at IS NOT NULL)",
            name="ck_encounter_game_confirmed_shape",
        ),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        # RESTRICT: deleting a catalog map must not erase a played position's identity.
        sa.ForeignKeyConstraint(["map_id"], ["overwatch.map.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_game_encounter_id"),
        "encounter_game",
        ["encounter_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_game_map_id"),
        "encounter_game",
        ["map_id"],
        unique=False,
        schema="tournament",
    )
    # A cancelled game keeps its position as history; the live series has at
    # most one game per position.
    op.create_index(
        "uq_encounter_game_encounter_position",
        "encounter_game",
        ["encounter_id", "position"],
        unique=True,
        schema="tournament",
        postgresql_where=sa.text("state != 'cancelled'"),
    )

    op.add_column("encounter_result_audit", sa.Column("game_id", sa.BigInteger(), nullable=True), schema="tournament")
    op.add_column(
        "encounter_result_audit", sa.Column("game_result_version", sa.Integer(), nullable=True), schema="tournament"
    )
    op.add_column("encounter_result_audit", sa.Column("reason", sa.Text(), nullable=True), schema="tournament")
    op.create_index(
        op.f("ix_tournament_encounter_result_audit_game_id"),
        "encounter_result_audit",
        ["game_id"],
        unique=False,
        schema="tournament",
    )
    op.create_foreign_key(
        "fk_tournament_encounter_result_audit_game_id",
        "encounter_result_audit",
        "encounter_game",
        ["game_id"],
        ["id"],
        source_schema="tournament",
        referent_schema="tournament",
        ondelete="CASCADE",
    )

    plan = _plan(conn)
    if plan.conflicts:
        raise RuntimeError("encgame01 cannot map legacy results unambiguously:\n" + "\n".join(plan.conflicts))
    game_ids = _insert_games(conn, plan)
    log.info("encgame01: planned %d games from legacy per-map results", len(plan.games))

    op.add_column("encounter_map_report", sa.Column("game_id", sa.BigInteger(), nullable=True), schema="tournament")
    op.add_column("encounter_map_report", sa.Column("side", sa.String(length=16), nullable=True), schema="tournament")
    if plan.report_keys:
        conn.execute(
            sa.text("UPDATE tournament.encounter_map_report SET game_id = :game_id, side = :side WHERE id = :id"),
            [
                {"id": report_id, "game_id": game_ids[key], "side": side}
                for report_id, (key, side) in plan.report_keys.items()
            ],
        )
    if plan.orphan_report_ids:
        # Their team is no longer either side of the encounter, so there is no
        # game and no side they could belong to.
        log.info("encgame01: dropping %d orphaned map reports", len(plan.orphan_report_ids))
        conn.execute(
            sa.text("DELETE FROM tournament.encounter_map_report WHERE id IN :ids").bindparams(
                sa.bindparam("ids", expanding=True)
            ),
            {"ids": plan.orphan_report_ids},
        )

    op.alter_column("encounter_map_report", "game_id", nullable=False, schema="tournament")
    op.alter_column("encounter_map_report", "side", nullable=False, schema="tournament")
    op.create_foreign_key(
        "fk_tournament_encounter_map_report_game_id",
        "encounter_map_report",
        "encounter_game",
        ["game_id"],
        ["id"],
        source_schema="tournament",
        referent_schema="tournament",
        ondelete="CASCADE",
    )
    op.create_index(
        op.f("ix_tournament_encounter_map_report_game_id"),
        "encounter_map_report",
        ["game_id"],
        unique=False,
        schema="tournament",
    )
    op.create_unique_constraint(
        "uq_encounter_map_report_game_side", "encounter_map_report", ["game_id", "side"], schema="tournament"
    )
    op.create_check_constraint(
        "ck_encounter_map_report_side", "encounter_map_report", "side IN ('home', 'away')", schema="tournament"
    )

    # DROP COLUMN takes every index and constraint on the dropped columns with
    # it. Naming them would fail on the long-lived databases, whose index names
    # predate ``initial_v6``'s ``op.f()`` spelling (see ``statdrop01``).
    for name in ("encounter_id", "map_id", "map_index", "team_id"):
        op.drop_column("encounter_map_report", name, schema="tournament")

    if plan.deleted_match_ids:
        # The manifest for dev: these rows never observed a log, they only
        # carried a score that now lives on the game.
        log.info(
            "encgame01: deleting %d captain_report matches: %s",
            len(plan.deleted_match_ids),
            plan.deleted_match_ids,
        )
        conn.execute(
            sa.text("DELETE FROM matches.match WHERE id IN :ids").bindparams(sa.bindparam("ids", expanding=True)),
            {"ids": plan.deleted_match_ids},
        )

    op.execute("UPDATE tournament.pick_ban_entry SET status = 'picked' WHERE status = 'played'")

    # Live series scores now come from the games. A COMPLETED encounter keeps
    # its official score; this revision never re-decides one.
    op.execute(
        """
        UPDATE tournament.encounter e
        SET home_score = s.home_wins, away_score = s.away_wins
        FROM (
          SELECT encounter_id,
                 COUNT(*) FILTER (WHERE accepted_home_score > accepted_away_score) AS home_wins,
                 COUNT(*) FILTER (WHERE accepted_away_score > accepted_home_score) AS away_wins
          FROM tournament.encounter_game WHERE state = 'confirmed' GROUP BY encounter_id
        ) s
        WHERE s.encounter_id = e.id AND e.status <> 'COMPLETED'
        """
    )


def downgrade() -> None:
    """Rebuild the legacy report key from the games, then drop the new objects.

    Deleted ``captain_report`` matches are NOT restored, and pick/ban entries
    that were ``played`` stay ``picked``: both were dropped on purpose going up.
    """
    op.add_column(
        "encounter_map_report", sa.Column("encounter_id", sa.BigInteger(), nullable=True), schema="tournament"
    )
    op.add_column("encounter_map_report", sa.Column("map_id", sa.BigInteger(), nullable=True), schema="tournament")
    op.add_column(
        "encounter_map_report",
        sa.Column("map_index", sa.Integer(), server_default="0", nullable=True),
        schema="tournament",
    )
    op.add_column("encounter_map_report", sa.Column("team_id", sa.BigInteger(), nullable=True), schema="tournament")
    op.execute(
        """
        UPDATE tournament.encounter_map_report r
        SET encounter_id = g.encounter_id,
            map_id = g.map_id,
            map_index = g.position,
            team_id = CASE WHEN r.side = 'home' THEN e.home_team_id ELSE e.away_team_id END
        FROM tournament.encounter_game g
        JOIN tournament.encounter e ON e.id = g.encounter_id
        WHERE g.id = r.game_id
        """
    )
    # A report on a map-less (``planned``) game, or on an encounter whose side
    # is empty, has no legacy shape to go back to.
    op.execute(
        "DELETE FROM tournament.encounter_map_report WHERE encounter_id IS NULL OR map_id IS NULL OR team_id IS NULL"
    )
    for name in ("encounter_id", "map_id", "map_index", "team_id"):
        op.alter_column("encounter_map_report", name, nullable=False, schema="tournament")

    op.create_foreign_key(
        None,
        "encounter_map_report",
        "encounter",
        ["encounter_id"],
        ["id"],
        source_schema="tournament",
        referent_schema="tournament",
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        None,
        "encounter_map_report",
        "map",
        ["map_id"],
        ["id"],
        source_schema="tournament",
        referent_schema="overwatch",
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        None,
        "encounter_map_report",
        "team",
        ["team_id"],
        ["id"],
        source_schema="tournament",
        referent_schema="tournament",
        ondelete="CASCADE",
    )
    op.create_check_constraint(
        "ck_encounter_map_report_index", "encounter_map_report", "map_index >= 0", schema="tournament"
    )
    op.create_unique_constraint(
        "uq_encounter_map_report_encounter_map_index_team",
        "encounter_map_report",
        ["encounter_id", "map_id", "map_index", "team_id"],
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_map_report_encounter_id"),
        "encounter_map_report",
        ["encounter_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_map_report_map_id"),
        "encounter_map_report",
        ["map_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_map_report_team_id"),
        "encounter_map_report",
        ["team_id"],
        unique=False,
        schema="tournament",
    )

    op.drop_constraint("ck_encounter_map_report_side", "encounter_map_report", schema="tournament", type_="check")
    op.drop_constraint("uq_encounter_map_report_game_side", "encounter_map_report", schema="tournament", type_="unique")
    op.drop_constraint(
        "fk_tournament_encounter_map_report_game_id",
        "encounter_map_report",
        schema="tournament",
        type_="foreignkey",
    )
    op.drop_index(
        op.f("ix_tournament_encounter_map_report_game_id"), table_name="encounter_map_report", schema="tournament"
    )
    op.drop_column("encounter_map_report", "side", schema="tournament")
    op.drop_column("encounter_map_report", "game_id", schema="tournament")

    op.drop_constraint(
        "fk_tournament_encounter_result_audit_game_id",
        "encounter_result_audit",
        schema="tournament",
        type_="foreignkey",
    )
    op.drop_index(
        op.f("ix_tournament_encounter_result_audit_game_id"),
        table_name="encounter_result_audit",
        schema="tournament",
    )
    op.drop_column("encounter_result_audit", "reason", schema="tournament")
    op.drop_column("encounter_result_audit", "game_result_version", schema="tournament")
    op.drop_column("encounter_result_audit", "game_id", schema="tournament")

    op.drop_index("uq_encounter_game_encounter_position", table_name="encounter_game", schema="tournament")
    op.drop_index(op.f("ix_tournament_encounter_game_map_id"), table_name="encounter_game", schema="tournament")
    op.drop_index(op.f("ix_tournament_encounter_game_encounter_id"), table_name="encounter_game", schema="tournament")
    op.drop_table("encounter_game", schema="tournament")
    # The three ``game_*`` labels stay on ``encounterresultauditaction``:
    # PostgreSQL cannot drop an enum label.
    op.execute("DROP TYPE tournament.encountergameresultsource")
    op.execute("DROP TYPE tournament.encountergamestate")


# ── the one-time plan ────────────────────────────────────────────────────────
#
# Lives in the revision that applies it, not in ``shared``: the shapes below
# are the legacy tables as they exist BEFORE this migration
# (``encounter_map_report``, ``matches.match`` rows with
# ``source='captain_report'``), and nothing outside this file may read them
# again. Rules (spec §13B): an explicit ``map_index > 0`` IS the position;
# legacy index 0/NULL rows are ordered by creation time after every explicit
# position, one game per distinct map; the same map twice without a position
# is a conflict that aborts the migration; a ``captain_report`` match is an
# accepted result, so it confirms its position whatever the surviving reports
# say. Nothing is guessed.


@dataclass(frozen=True)
class EncounterSides:
    home_team_id: int | None
    away_team_id: int | None


@dataclass(frozen=True)
class LegacyReport:
    id: int
    encounter_id: int
    map_id: int
    map_index: int
    team_id: int
    home_score: int
    away_score: int
    created_at: datetime


@dataclass(frozen=True)
class LegacyCaptainMatch:
    id: int
    encounter_id: int
    map_id: int
    map_index: int | None
    home_score: int
    away_score: int
    created_at: datetime


@dataclass
class PlannedGame:
    key: tuple[int, int]  # (encounter_id, position) — the migration maps it to the new id
    encounter_id: int
    position: int
    map_id: int
    state: str
    accepted_home_score: int | None = None
    accepted_away_score: int | None = None
    confirmed_at: datetime | None = None


@dataclass
class BackfillPlan:
    games: list[PlannedGame] = field(default_factory=list)
    report_keys: dict[int, tuple[tuple[int, int], str]] = field(default_factory=dict)
    orphan_report_ids: list[int] = field(default_factory=list)
    deleted_match_ids: list[int] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)


@dataclass
class _Group:
    """Everything the legacy data says about one series position."""

    map_id: int
    reports: dict[str, LegacyReport] = field(default_factory=dict)  # side -> report
    matches: list[LegacyCaptainMatch] = field(default_factory=list)


def plan_games(
    reports: Sequence[LegacyReport],
    captain_matches: Sequence[LegacyCaptainMatch],
    encounters: Mapping[int, EncounterSides],
) -> BackfillPlan:
    """Map legacy per-map rows onto ``encounter_game`` positions.

    Ambiguity is never resolved by guessing: it lands in ``conflicts`` and the
    migration aborts so an operator can set ``map_index`` by hand.
    """
    plan = BackfillPlan()

    # 1. Side resolution. A report whose team is no longer either side of its
    #    encounter (or whose encounter is gone) has no game to belong to.
    sided: dict[int, list[tuple[LegacyReport, str]]] = defaultdict(list)
    for report in reports:
        side = _side_of(report, encounters.get(report.encounter_id))
        if side is None:
            plan.orphan_report_ids.append(report.id)
            continue
        sided[report.encounter_id].append((report, side))

    matches_by_encounter: dict[int, list[LegacyCaptainMatch]] = defaultdict(list)
    for match in captain_matches:
        matches_by_encounter[match.encounter_id].append(match)

    for encounter_id in sorted(set(sided) | set(matches_by_encounter)):
        groups = _group_encounter(
            encounter_id,
            sided.get(encounter_id, ()),
            matches_by_encounter.get(encounter_id, ()),
            plan.conflicts,
        )
        for position in sorted(groups):
            group = groups[position]
            game = _plan_game(encounter_id, position, group, plan.conflicts)
            plan.games.append(game)
            for side, report in group.reports.items():
                plan.report_keys[report.id] = (game.key, side)
            plan.deleted_match_ids.extend(match.id for match in group.matches)

    plan.orphan_report_ids.sort()
    plan.deleted_match_ids.sort()
    return plan


def _side_of(report: LegacyReport, sides: EncounterSides | None) -> str | None:
    if sides is None:
        return None
    if report.team_id == sides.home_team_id:
        return "home"
    if report.team_id == sides.away_team_id:
        return "away"
    return None


def _group_encounter(
    encounter_id: int,
    sided_reports: Sequence[tuple[LegacyReport, str]],
    matches: Sequence[LegacyCaptainMatch],
    conflicts: list[str],
) -> dict[int, _Group]:
    """One ``_Group`` per series position of this encounter."""
    groups: dict[int, _Group] = {}

    # 2. Explicit positions: map_index is the position, verbatim.
    position_maps: dict[int, set[int]] = defaultdict(set)
    for report, _side in sided_reports:
        if report.map_index > 0:
            position_maps[report.map_index].add(report.map_id)
    for match in matches:
        if match.map_index is not None and match.map_index > 0:
            position_maps[match.map_index].add(match.map_id)
    for position in sorted(position_maps):
        map_ids = position_maps[position]
        if len(map_ids) > 1:
            conflicts.append(f"encounter {encounter_id}: position {position} names maps {sorted(map_ids)}")
            continue
        groups[position] = _Group(map_id=next(iter(map_ids)))

    explicit_maps = {group.map_id for group in groups.values()}
    max_explicit = max(groups, default=0)

    for report, side in sided_reports:
        if report.map_index > 0 and report.map_index in groups:
            _add_report(encounter_id, report.map_index, groups[report.map_index], report, side, conflicts)
    for match in matches:
        if match.map_index is not None and match.map_index > 0 and match.map_index in groups:
            groups[match.map_index].matches.append(match)

    # 3. Legacy rows: no position of their own, so creation order is the only
    #    evidence. One game per distinct map, in first-seen order, after every
    #    explicit position. A map that reappears once another map has started —
    #    or that an explicit position already claimed — is not orderable.
    legacy: list[tuple[datetime, int, LegacyReport | None, str | None, LegacyCaptainMatch | None]] = []
    for report, side in sided_reports:
        if report.map_index <= 0:
            legacy.append((report.created_at, report.id, report, side, None))
    for match in matches:
        if match.map_index is None or match.map_index <= 0:
            legacy.append((match.created_at, match.id, None, None, match))
    legacy.sort(key=lambda item: (item[0], item[1]))

    legacy_groups: dict[int, _Group] = {}
    order: list[int] = []
    current_map: int | None = None
    twice: set[int] = set()
    for _created, _row_id, report, side, match in legacy:
        map_id = report.map_id if report is not None else match.map_id  # type: ignore[union-attr]
        if map_id in explicit_maps or (map_id != current_map and map_id in legacy_groups):
            if map_id not in twice:
                twice.add(map_id)
                conflicts.append(
                    f"encounter {encounter_id}: legacy rows play map {map_id} twice; set map_index by hand"
                )
            continue
        if map_id not in legacy_groups:
            legacy_groups[map_id] = _Group(map_id=map_id)
            order.append(map_id)
        current_map = map_id
        group = legacy_groups[map_id]
        if report is not None and side is not None:
            if side in group.reports:
                # Two claims from one side for one map with nothing to separate
                # them: the same map was played twice, unpositioned.
                if map_id not in twice:
                    twice.add(map_id)
                    conflicts.append(
                        f"encounter {encounter_id}: legacy rows play map {map_id} twice; set map_index by hand"
                    )
                continue
            group.reports[side] = report
        elif match is not None:
            group.matches.append(match)

    for offset, map_id in enumerate(order, start=1):
        groups[max_explicit + offset] = legacy_groups[map_id]
    return groups


def _add_report(
    encounter_id: int,
    position: int,
    group: _Group,
    report: LegacyReport,
    side: str,
    conflicts: list[str],
) -> None:
    if side in group.reports:
        conflicts.append(f"encounter {encounter_id}: position {position} has two {side} reports")
        return
    group.reports[side] = report


def _plan_game(encounter_id: int, position: int, group: _Group, conflicts: list[str]) -> PlannedGame:
    """4. State from the evidence.

    A ``captain_report`` match IS an accepted result (spec §13B) -- the old
    reconciliation only ever wrote one once a result was agreed -- so wherever
    one exists it confirms the game, whatever the surviving reports say. A lone
    report that disagrees stays attached as that side's claim and changes
    nothing; only BOTH sides agreeing on a different score is a contradiction
    worth aborting for. With no match: agreement confirms, disagreement
    disputes, a lone claim waits.
    """
    game = PlannedGame(
        key=(encounter_id, position),
        encounter_id=encounter_id,
        position=position,
        map_id=group.map_id,
        state="awaiting_result",
    )
    home = group.reports.get("home")
    away = group.reports.get("away")
    agreed: tuple[int, int] | None = None
    if (
        home is not None
        and away is not None
        and (home.home_score, home.away_score)
        == (
            away.home_score,
            away.away_score,
        )
    ):
        agreed = (home.home_score, home.away_score)

    if group.matches:
        match = min(group.matches, key=lambda m: (m.created_at, m.id))
        for other in group.matches:
            if (other.home_score, other.away_score) != (match.home_score, match.away_score):
                conflicts.append(
                    f"encounter {encounter_id}: position {position} has captain matches {match.id} and "
                    f"{other.id} with different scores"
                )
        if agreed is not None and agreed != (match.home_score, match.away_score):
            conflicts.append(
                f"encounter {encounter_id}: position {position} captain match {match.id} says "
                f"{match.home_score}-{match.away_score} but both captains agreed {agreed[0]}-{agreed[1]}"
            )
        game.state = "confirmed"
        game.accepted_home_score = match.home_score
        game.accepted_away_score = match.away_score
        game.confirmed_at = match.created_at
    elif agreed is not None:
        game.state = "confirmed"
        game.accepted_home_score = agreed[0]
        game.accepted_away_score = agreed[1]
        game.confirmed_at = max(home.created_at, away.created_at)  # type: ignore[union-attr]
    elif home is not None and away is not None:
        game.state = "disputed"
    return game
