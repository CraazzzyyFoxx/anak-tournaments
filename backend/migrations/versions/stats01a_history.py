"""Preserve independent observation ownership on an original stats01 database.

Writers must be drained. Lock waits are bounded; a refused upgrade rolls back.
The retained source and original initial oracle must prove every old row before
DDL. No receipt or audit is replaced, and no raw availability is inferred.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import sqlalchemy as sa
from alembic import op

from scripts.stats01_reconcile import _projection_digest
from shared.services.stats_evidence import encode_value

revision = "stats01a"
down_revision = "stats01"
branch_labels = None
depends_on = None


def transfer_revision():
    spec = importlib.util.spec_from_file_location(
        "stats01_history_source", Path(__file__).with_name("stats01_stats.py")
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def original_mv_projection(source, query):
    """Retain an old winner only when its entire metadata is source-proven co-best."""
    return f"""WITH e AS MATERIALIZED ({query}),
      holders AS MATERIALIZED ({source.EXPECTED_MV_TIED_HOLDERS_SELECT})
      SELECT e.discipline,e.stat_id,e.entity_id,e.best_value,e.avg,
        CASE WHEN EXISTS (
          SELECT 1 FROM holders h WHERE h.discipline=e.discipline AND h.stat_id=e.stat_id
            AND h.entity_id=e.entity_id AND float8send(h.best_value)=float8send(e.best_value)
            AND h.metadata=a.metadata
        ) THEN a.metadata ELSE e.metadata END AS metadata
      FROM e LEFT JOIN ({source.RESIDENT_MV_SELECT}) a USING(discipline,stat_id,entity_id)"""


def original_classes(source):
    """The original schema's exact projections; added history fields cannot mask loss."""
    jobs = source.JOB_COLUMNS.replace(",raw_status", "")
    matches = source.MATCH_COLUMNS.replace(",encounter_id,source_map_index", "")
    old_jobs = f"SELECT {jobs} FROM ({source.EXPECTED_JOBS}) j WHERE source_kind<>'historical_reference'"
    old_matches = f"SELECT {matches} FROM ({source.EXPECTED_MATCHES}) m"
    old_teams = f"""SELECT t.match_id,x.game_id AS encounter_game_id,t.encounter_team_id,t.source_position
        FROM ({source.EXPECTED_TEAMS}) t JOIN stats01_match x ON x.match_id=t.match_id"""
    old_mv = source.NATIVE_MV_SELECT.replace("m.encounter_id", "g.encounter_id").replace(
        "JOIN encounter.encounter enc ON enc.id=g.encounter_id",
        "JOIN encounter.game g ON g.id=m.encounter_game_id JOIN encounter.encounter enc ON enc.id=g.encounter_id",
    )
    replacements = {
        "job_owners": ("SELECT id FROM log_processing.record", "SELECT id FROM stats.ingest_job"),
        "jobs": (old_jobs, f"SELECT {jobs} FROM stats.ingest_job"),
        "matches": (old_matches, f"SELECT {matches} FROM stats.match"),
        "teams": (
            old_teams,
            "SELECT match_id,encounter_game_id,encounter_team_id,source_position FROM stats.match_team",
        ),
        "mv": (original_mv_projection(source, source.EXPECTED_MV_SELECT), source.RESIDENT_MV_SELECT),
        "mv_derivation": (
            source._mv_bits(original_mv_projection(source, old_mv)),
            source._mv_bits(source.RESIDENT_MV_SELECT),
        ),
    }
    return tuple(
        (name, *replacements.get(name, (expected, actual))) for name, expected, actual in source.RECONCILE_CLASSES
    )


def assert_proof(bind, source, classes):
    proof = []
    for name, expected, actual in classes:
        difference = source._reconcile_class(name, expected, actual)
        count = bind.scalar(sa.text(f"SELECT count(*) FROM ({difference}) d"))
        if count:
            sample = bind.execute(sa.text(f"SELECT * FROM ({difference}) d LIMIT 20")).all()
            raise RuntimeError(f"stats01a refuses unexplained {name} differences: count={count}, sample={sample!r}")
        # Use the receipt's typed, ordered codec: EXCEPT ALL equates signed zero.
        scope = ("migration", ("stats01a",), name)
        expected_digest, actual_digest = (_projection_digest(bind, query, scope) for query in (expected, actual))
        if expected_digest != actual_digest:
            raise RuntimeError(f"stats01a refuses unexplained {name} semantic differences")
        proof.append(
            {
                "class": name,
                "legacy": expected_digest[0],
                "migrated": actual_digest[0],
                "semantic_sha256": expected_digest[1],
                "status": "ok",
            }
        )
    return proof


def upgrade():
    bind = op.get_bind()
    fields = set(
        bind.execute(
            sa.text("""SELECT table_name,column_name FROM information_schema.columns
        WHERE table_schema='stats' AND (table_name,column_name) IN
        (('match','encounter_id'),('match','source_map_index'),('match_team','encounter_id'),('ingest_job','raw_status'))""")
        ).all()
    )
    if len(fields) == 4:
        # Revised stats01 already transferred the complete history and oracle.
        return
    if fields:
        raise RuntimeError("stats01a refuses a partially changed history schema; restore or forward-fix explicitly")
    source = transfer_revision()
    bind.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
    bind.execute(sa.text("SET LOCAL lock_timeout='5s'"))
    bind.execute(
        sa.text("""LOCK TABLE stats.match,stats.match_team,stats.match_player,stats.fact,stats.event,
        stats.segment,stats.ingest_job,stats.stat_baseline,stats.discord_channel,
        matches.match,matches.statistics,matches.kill_feed,matches.event,matches.stat_baselines,log_processing.record,
        encounter.encounter,encounter.game,encounter.team,encounter.game_team,tournament.tournament,tournament.player,
        workspace_member,players.\"user\",players.social_account,catalog.entity,catalog.role,catalog.role_dimension,
        achievements.rule,achievements.evaluation_result,achievements.override,event_outbox,catalog.alias_miss,audit_log
        IN SHARE ROW EXCLUSIVE MODE""")
    )
    for statement in source.RECONCILE_SETUP:
        bind.execute(sa.text(statement))
    before = assert_proof(bind, source, original_classes(source))
    old_mv = {tuple(row[:3]): encode_value(tuple(row)) for row in bind.execute(sa.text(source.RESIDENT_MV_SELECT))}
    # Record a real creation time for native provenance, not an invented old upload.
    audit_id = bind.scalar(
        sa.text("""INSERT INTO audit_log(source,action,entity_type,before_json,after_json)
        VALUES('system','stats.history_upgrade','stats01a',CAST(:before AS jsonb),CAST(:after AS jsonb)) RETURNING id"""),
        {
            "before": json.dumps({"revision": "stats01", "proof": before}),
            "after": json.dumps(
                {
                    "revision": "stats01a",
                    "raw_status": "unverified",
                    "mapping": "encounter.game owner; matches.match source_map_index",
                }
            ),
        },
    )
    bind.execute(sa.text("ALTER TABLE stats.match ADD COLUMN encounter_id BIGINT, ADD COLUMN source_map_index INTEGER"))
    bind.execute(
        sa.text("""UPDATE stats.match n SET encounter_id=g.encounter_id,source_map_index=m.map_index
        FROM encounter.game g,matches.match m WHERE g.id=n.encounter_game_id AND m.id=n.id""")
    )
    bind.execute(sa.text("ALTER TABLE stats.match_team ADD COLUMN encounter_id BIGINT"))
    bind.execute(
        sa.text("UPDATE stats.match_team t SET encounter_id=m.encounter_id FROM stats.match m WHERE m.id=t.match_id")
    )
    game_fk = source._one_fk("stats.match", "encounter_game_id", "encounter.game")
    quote = bind.dialect.identifier_preparer.quote
    bind.execute(sa.text(f"ALTER TABLE stats.match DROP CONSTRAINT {quote(game_fk)}"))
    team_fks = (
        bind.execute(
            sa.text("""SELECT conname FROM pg_constraint WHERE conrelid='stats.match_team'::regclass
        AND contype='f' AND confrelid IN ('stats.match'::regclass,'encounter.game_team'::regclass)""")
        )
        .scalars()
        .all()
    )
    if len(team_fks) != 2:
        raise RuntimeError("stats01a expected original match-team owner constraints")
    for name in team_fks:
        bind.execute(sa.text(f"ALTER TABLE stats.match_team DROP CONSTRAINT {quote(name)}"))
    for statement in (
        "ALTER TABLE stats.match ALTER COLUMN encounter_id SET NOT NULL, ALTER COLUMN encounter_game_id DROP NOT NULL",
        """ALTER TABLE stats.match ADD CONSTRAINT fk_stats_match_encounter FOREIGN KEY(encounter_id)
            REFERENCES encounter.encounter(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
            ADD CONSTRAINT fk_stats_match_game FOREIGN KEY(encounter_game_id) REFERENCES encounter.game(id)
            ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
            ADD CONSTRAINT uq_stats_match_owner UNIQUE(id,encounter_id)""",
        "ALTER TABLE stats.match_team ALTER COLUMN encounter_id SET NOT NULL, DROP COLUMN encounter_game_id",
        """ALTER TABLE stats.match_team ADD CONSTRAINT fk_match_team_match FOREIGN KEY(match_id,encounter_id)
            REFERENCES stats.match(id,encounter_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
            ADD CONSTRAINT fk_match_team_encounter_team FOREIGN KEY(encounter_team_id,encounter_id)
            REFERENCES encounter.team(id,encounter_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED""",
        "CREATE INDEX ix_stats_match_encounter ON stats.match(encounter_id)",
        "CREATE INDEX ix_match_team_encounter_team ON stats.match_team(encounter_team_id,encounter_id)",
        """ALTER TABLE stats.ingest_job ALTER COLUMN content_hash DROP NOT NULL,
            ADD COLUMN raw_status VARCHAR(16) NOT NULL DEFAULT 'unverified'
            CONSTRAINT ck_ingest_job_raw_status CHECK(raw_status IN ('available','missing','conflict','unverified'))""",
        "ALTER TABLE stats.ingest_job ALTER COLUMN raw_status SET DEFAULT 'available'",
        "ALTER TABLE stats.ingest_job ADD CONSTRAINT ck_ingest_job_available_hash CHECK(raw_status<>'available' OR content_hash IS NOT NULL)",
    ):
        bind.execute(sa.text(statement))
    bind.execute(sa.text("DROP MATERIALIZED VIEW stats.mv_entity_global_stats"))
    bind.execute(sa.text(f"CREATE MATERIALIZED VIEW stats.mv_entity_global_stats AS {source.NATIVE_MV_SELECT}"))
    bind.execute(
        sa.text(
            "CREATE UNIQUE INDEX uq_mv_entity_global_stats ON stats.mv_entity_global_stats(discipline,stat_id,entity_id)"
        )
    )
    bind.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
    after = assert_proof(bind, source, source.RECONCILE_CLASSES)
    mv_changes = []
    for row in bind.execute(sa.text(source.RESIDENT_MV_SELECT + " ORDER BY discipline,stat_id,entity_id")):
        prior, current = old_mv[tuple(row[:3])], encode_value(tuple(row))
        if prior != current:
            mv_changes.append({"owner_key": list(row[:3]), "before": prior, "after": current})
    bind.execute(
        sa.text("UPDATE audit_log SET after_json=after_json||CAST(:proof AS jsonb) WHERE id=:id"),
        {
            "id": audit_id,
            "proof": json.dumps(
                {
                    "proof": after,
                    "original_oracle_retained": True,
                    "mv_best_tie_policy": "best_value_latest_match_min_member",
                    "mv_changes": mv_changes,
                    "avg_comparison": {
                        "policy": "canonical_source_bit_exact",
                        **dict(bind.execute(sa.text(source.MV_AVG_DIFFERENCES)).mappings().one()),
                    },
                }
            ),
        },
    )
    bind.execute(sa.text("SET CONSTRAINTS ALL DEFERRED"))


def downgrade():
    raise RuntimeError("stats01a is forward-fix-only; restore the pre-upgrade backup to reverse it")
