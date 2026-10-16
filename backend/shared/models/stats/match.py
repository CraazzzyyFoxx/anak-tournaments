"""Native observation tables (§14.4). Fact identity is natural and nullable, never a physical PK."""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, column_property, mapped_column

from shared.core import db
from shared.models.encounter.encounter import Encounter
from shared.models.encounter.game import EncounterGame

__all__ = (
    "StatsMatch",
    "StatsMatchTeam",
    "StatsMatchPlayer",
    "StatsSegment",
    "StatsFact",
    "StatsEvent",
    "StatsBaseline",
    "mv_entity_global_stats",
)

# A selectable, not ORM/DDL metadata: Alembic alone creates this materialized view.
mv_entity_global_stats = sa.table(
    "mv_entity_global_stats",
    sa.column("discipline", sa.String(32)),
    sa.column("stat_id", sa.SmallInteger()),
    sa.column("entity_id", sa.BigInteger()),
    sa.column("best_value", sa.Double()),
    sa.column("avg", sa.Double()),
    sa.column("metadata", JSONB()),
    schema="stats",
)


class StatsMatch(db.TimeStampIntegerMixin):
    __tablename__ = "match"
    __table_args__ = (
        sa.UniqueConstraint("encounter_game_id", name="uq_stats_match_game"),
        sa.CheckConstraint("map_kind = 'map'", name="ck_stats_match_map_kind"),
        sa.ForeignKeyConstraint(
            ["map_entity_id", "discipline", "map_kind"],
            ["catalog.entity.id", "catalog.entity.discipline", "catalog.entity.kind"],
            name="fk_match_map",
            ondelete="RESTRICT",
        ),
        sa.Index("ix_stats_match_ingest_job", "ingest_job_id"),
        sa.Index("ix_stats_match_workspace", "workspace_id"),
        {"schema": "stats"},
    )

    workspace_id: Mapped[int] = mapped_column(
        sa.ForeignKey(
            "workspace.id", name="fk_stats_match_workspace", ondelete="CASCADE", deferrable=True, initially="DEFERRED"
        )
    )
    discipline: Mapped[str] = mapped_column(sa.String(32))
    encounter_game_id: Mapped[int] = mapped_column(
        sa.ForeignKey(
            "encounter.game.id", name="fk_stats_match_game", ondelete="CASCADE", deferrable=True, initially="DEFERRED"
        )
    )
    ingest_job_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey(
            "stats.ingest_job.id",
            name="fk_stats_match_ingest_job",
            ondelete="SET NULL",
            deferrable=True,
            initially="DEFERRED",
        ),
        nullable=True,
    )
    revision: Mapped[int] = mapped_column(sa.Integer(), default=1, server_default="1")
    played_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    duration_s: Mapped[float | None] = mapped_column(sa.Double(), nullable=True)
    map_entity_id: Mapped[int] = mapped_column(sa.BigInteger())
    map_kind: Mapped[str] = mapped_column(sa.String(16), default="map", server_default="map")


# Computed in the encounter SELECT: deleting its last observed game clears the badge.
Encounter.has_logs = column_property(
    sa.exists(
        sa.select(1)
        .select_from(StatsMatch)
        .join(EncounterGame, EncounterGame.id == StatsMatch.encounter_game_id)
        .where(
            EncounterGame.encounter_id == Encounter.id,
            StatsMatch.workspace_id == Encounter.workspace_id,
            StatsMatch.discipline == Encounter.discipline,
        )
        .correlate_except(StatsMatch, EncounterGame)
    )
)


class StatsMatchTeam(db.Base):
    __tablename__ = "match_team"
    __table_args__ = (
        sa.PrimaryKeyConstraint("match_id", "encounter_team_id", name="pk_stats_match_team"),
        sa.CheckConstraint("source_position >= 1", name="ck_match_team_source_position"),
        sa.UniqueConstraint("match_id", "source_position", name="uq_match_team_source_position"),
        sa.ForeignKeyConstraint(
            ["encounter_game_id", "encounter_team_id"],
            ["encounter.game_team.game_id", "encounter.game_team.encounter_team_id"],
            name="fk_match_team_game_team",
            ondelete="CASCADE",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.Index("ix_match_team_game_team", "encounter_game_id", "encounter_team_id"),
        {"schema": "stats"},
    )

    match_id: Mapped[int] = mapped_column(
        sa.ForeignKey(
            "stats.match.id", name="fk_match_team_match", ondelete="CASCADE", deferrable=True, initially="DEFERRED"
        )
    )
    encounter_game_id: Mapped[int] = mapped_column(sa.BigInteger())
    encounter_team_id: Mapped[int] = mapped_column(sa.BigInteger())
    source_position: Mapped[int] = mapped_column(sa.Integer())


class StatsMatchPlayer(db.Base):
    __tablename__ = "match_player"
    __table_args__ = (
        sa.PrimaryKeyConstraint("match_id", "workspace_member_id", name="pk_stats_match_player"),
        sa.ForeignKeyConstraint(
            ["match_id", "encounter_team_id"],
            ["stats.match_team.match_id", "stats.match_team.encounter_team_id"],
            name="fk_match_player_team",
            ondelete="CASCADE",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.Index("ix_match_player_member", "workspace_member_id"),
        sa.Index("ix_match_player_observed_role", "observed_role_id"),
        {"schema": "stats"},
    )

    match_id: Mapped[int] = mapped_column(sa.BigInteger())
    encounter_team_id: Mapped[int] = mapped_column(sa.BigInteger())
    workspace_member_id: Mapped[int] = mapped_column(
        sa.ForeignKey("workspace_member.id", name="fk_match_player_member", deferrable=True, initially="DEFERRED")
    )
    handle_snapshot: Mapped[str] = mapped_column(sa.String(255))
    observed_role_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey("catalog.role.id", name="fk_match_player_role", deferrable=True, initially="DEFERRED"),
        nullable=True,
    )


class StatsSegment(db.Base):
    __tablename__ = "segment"
    __table_args__ = (
        sa.PrimaryKeyConstraint("match_id", "segment", name="pk_stats_segment"),
        sa.CheckConstraint("segment >= 1", name="ck_stats_segment_positive"),
        {"schema": "stats"},
    )

    match_id: Mapped[int] = mapped_column(
        sa.ForeignKey(
            "stats.match.id", name="fk_segment_match", ondelete="CASCADE", deferrable=True, initially="DEFERRED"
        )
    )
    segment: Mapped[int] = mapped_column(sa.SmallInteger())
    kind: Mapped[str] = mapped_column(sa.String(16))
    attrs: Mapped[dict] = mapped_column(JSONB(), default=dict, server_default=sa.text("'{}'::jsonb"))


class StatsFact(db.Base):
    __tablename__ = "fact"
    __table_args__ = (
        sa.CheckConstraint("entity_kind = 'character'", name="ck_fact_entity_kind"),
        sa.ForeignKeyConstraint(
            ["match_id", "encounter_team_id"],
            ["stats.match_team.match_id", "stats.match_team.encounter_team_id"],
            name="fk_fact_team",
            ondelete="CASCADE",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.ForeignKeyConstraint(
            ["match_id", "workspace_member_id"],
            ["stats.match_player.match_id", "stats.match_player.workspace_member_id"],
            name="fk_fact_player",
            ondelete="CASCADE",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.ForeignKeyConstraint(
            ["entity_id", "entity_kind"],
            ["catalog.entity.id", "catalog.entity.kind"],
            name="fk_fact_entity",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "match_id",
            "segment",
            "encounter_team_id",
            "workspace_member_id",
            "entity_id",
            "stat_id",
            name="uq_fact",
            postgresql_nulls_not_distinct=True,
        ),
        sa.Index(
            "ix_fact_member_stat_total",
            "workspace_member_id",
            "stat_id",
            postgresql_where=sa.text("segment = 0 AND entity_id IS NULL"),
        ),
        sa.Index(
            "ix_fact_member_entity_total",
            "workspace_member_id",
            "entity_id",
            "stat_id",
            postgresql_where=sa.text("segment = 0 AND entity_id IS NOT NULL"),
        ),
        sa.Index("ix_fact_match_member", "match_id", "workspace_member_id", "segment"),
        {"schema": "stats"},
    )
    # SQLAlchemy needs an identity; PostgreSQL has ONLY the null-equal natural unique key. Core writes/read aggregates
    # must not use Session.get or the identity map for this nullable tuple.
    __mapper_args__ = {
        "primary_key": ["match_id", "segment", "encounter_team_id", "workspace_member_id", "entity_id", "stat_id"]
    }

    match_id: Mapped[int] = mapped_column(sa.BigInteger())
    segment: Mapped[int] = mapped_column(sa.SmallInteger(), default=0, server_default="0")
    encounter_team_id: Mapped[int] = mapped_column(sa.BigInteger())
    workspace_member_id: Mapped[int | None] = mapped_column(sa.BigInteger(), nullable=True)
    entity_id: Mapped[int | None] = mapped_column(sa.BigInteger(), nullable=True)
    entity_kind: Mapped[str] = mapped_column(sa.String(16), default="character", server_default="character")
    stat_id: Mapped[int] = mapped_column(sa.SmallInteger(), sa.ForeignKey("stats.stat_def.id", name="fk_fact_stat"))
    value: Mapped[float] = mapped_column(sa.Double())


class StatsEvent(db.Base):
    __tablename__ = "event"
    __table_args__ = (
        sa.CheckConstraint("entity_kind = 'character'", name="ck_event_entity_kind"),
        sa.ForeignKeyConstraint(
            ["match_id", "actor_member_id"],
            ["stats.match_player.match_id", "stats.match_player.workspace_member_id"],
            name="fk_event_actor",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.ForeignKeyConstraint(
            ["match_id", "target_member_id"],
            ["stats.match_player.match_id", "stats.match_player.workspace_member_id"],
            name="fk_event_target",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.ForeignKeyConstraint(
            ["match_id", "actor_team_id"],
            ["stats.match_team.match_id", "stats.match_team.encounter_team_id"],
            name="fk_event_actor_team",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.ForeignKeyConstraint(
            ["match_id", "target_team_id"],
            ["stats.match_team.match_id", "stats.match_team.encounter_team_id"],
            name="fk_event_target_team",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.ForeignKeyConstraint(
            ["entity_id", "entity_kind"],
            ["catalog.entity.id", "catalog.entity.kind"],
            name="fk_event_entity",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.ForeignKeyConstraint(
            ["related_entity_id", "entity_kind"],
            ["catalog.entity.id", "catalog.entity.kind"],
            name="fk_event_related_entity",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.Index("ix_event_match", "match_id", "t"),
        {"schema": "stats"},
    )

    id: Mapped[int] = mapped_column(sa.BigInteger(), primary_key=True)
    match_id: Mapped[int] = mapped_column(
        sa.ForeignKey(
            "stats.match.id", name="fk_event_match", ondelete="CASCADE", deferrable=True, initially="DEFERRED"
        )
    )
    segment: Mapped[int] = mapped_column(sa.SmallInteger(), default=0, server_default="0")
    t: Mapped[float] = mapped_column(sa.Double())
    type_id: Mapped[int] = mapped_column(sa.SmallInteger(), sa.ForeignKey("stats.event_type.id", name="fk_event_type"))
    actor_member_id: Mapped[int | None] = mapped_column(sa.BigInteger(), nullable=True)
    actor_team_id: Mapped[int | None] = mapped_column(sa.BigInteger(), nullable=True)
    target_member_id: Mapped[int | None] = mapped_column(sa.BigInteger(), nullable=True)
    target_team_id: Mapped[int | None] = mapped_column(sa.BigInteger(), nullable=True)
    entity_id: Mapped[int | None] = mapped_column(sa.BigInteger(), nullable=True)
    related_entity_id: Mapped[int | None] = mapped_column(sa.BigInteger(), nullable=True)
    entity_kind: Mapped[str] = mapped_column(sa.String(16), default="character", server_default="character")
    data: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True), nullable=True)


class StatsBaseline(db.Base):
    __tablename__ = "stat_baseline"
    __table_args__ = (
        sa.UniqueConstraint("formula_version", "role_id", "rank_bucket", "stat_id", name="uq_stat_baseline"),
        sa.Index("ix_stat_baseline_role", "role_id"),
        {"schema": "stats"},
    )

    id: Mapped[int] = mapped_column(sa.BigInteger(), primary_key=True)
    formula_version: Mapped[str] = mapped_column(sa.String(64))
    role_id: Mapped[int] = mapped_column(
        sa.ForeignKey("catalog.role.id", name="fk_stat_baseline_role", deferrable=True, initially="DEFERRED")
    )
    rank_bucket: Mapped[int] = mapped_column(sa.SmallInteger(), default=-1, server_default="-1")
    stat_id: Mapped[int] = mapped_column(
        sa.SmallInteger(), sa.ForeignKey("stats.stat_def.id", name="fk_stat_baseline_stat")
    )
    mean: Mapped[float] = mapped_column(sa.Double())
    std: Mapped[float] = mapped_column(sa.Double())
    meta: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True), nullable=True)
    computed_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=sa.func.now())
