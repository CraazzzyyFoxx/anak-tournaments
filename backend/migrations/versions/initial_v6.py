"""initial_v6

Squashed baseline: everything the v5 chain built, generated from the models as
one revision. Databases that already ran the v5 chain are stamped with this
revision instead of running it.

Revision ID: initial_v6
Revises:
Create Date: 2026-08-13 13:57:29.107242

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "initial_v6"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Autogenerate never emits these: the models only reference the schemas, and the
# trigram/crypto extensions are used by hand-written indexes and defaults.
SCHEMAS = (
    "achievements",
    "analytics",
    "auth",
    "balancer",
    "log_processing",
    "matches",
    "overwatch",
    "overwatch_rank",
    "players",
    "realtime",
    "subscriptions",
    "tournament",
)
EXTENSIONS = ("pg_trgm", "pgcrypto")

# matches.mv_hero_global_stats is not a model: it precomputes the global
# best/average per (hero, stat) behind GET /users/{id}/heroes. Created WITH NO
# DATA; the app-worker refreshes it CONCURRENTLY, which needs the unique index.
HERO_GLOBAL_STATS_MATVIEW = """
CREATE MATERIALIZED VIEW matches.mv_hero_global_stats AS
WITH qualified AS (
    SELECT DISTINCT s.match_id, s.user_id, s.hero_id
    FROM matches.statistics s
    WHERE s.round = 0 AND s.name = 'HeroTimePlayed' AND s.value > 60
),
eligible AS (
    SELECT st.match_id, st.user_id, st.hero_id, st.name, st.value
    FROM matches.statistics st
    JOIN qualified q
      ON q.match_id = st.match_id AND q.user_id = st.user_id AND q.hero_id = st.hero_id
    WHERE st.round = 0 AND st.hero_id IS NOT NULL
),
agg AS (
    SELECT e.hero_id, e.name,
           sum(e.value) AS sum_value,
           sum(m."time") AS sum_time
    FROM eligible e
    JOIN matches.match m ON m.id = e.match_id
    GROUP BY e.hero_id, e.name
),
ranked AS (
    SELECT e.hero_id, e.name, e.match_id, e.user_id, e.value,
           row_number() OVER (
             PARTITION BY e.hero_id, e.name
             ORDER BY e.value * CASE WHEN e.name IN (
                          'Deaths', 'DamageTaken', 'EnvironmentalDeaths',
                          'ShotsMissed', 'DamageFB', 'Performance'
                      ) THEN -1.0 ELSE 1.0 END DESC,
                      e.match_id DESC
           ) AS rn
    FROM eligible e
),
best AS (
    SELECT r.hero_id, r.name, r.value AS best_value,
           m.encounter_id,
           mp.name AS map_name, mp.image_path AS map_image_path,
           t.name AS tournament_name,
           u.name AS username
    FROM ranked r
    JOIN matches.match m         ON m.id = r.match_id
    JOIN overwatch.map mp        ON mp.id = m.map_id
    JOIN tournament.encounter enc ON enc.id = m.encounter_id
    JOIN tournament.tournament t  ON t.id = enc.tournament_id
    JOIN players."user" u        ON u.id = r.user_id
    WHERE r.rn = 1
)
SELECT
    a.name AS name,
    a.hero_id AS hero_id,
    b.best_value AS best_value,
    (a.sum_value / nullif(a.sum_time, 0)) * 600 AS avg,
    jsonb_build_object(
        'encounter_id', b.encounter_id,
        'map_name', b.map_name,
        'map_image_path', b.map_image_path,
        'tournament_name', b.tournament_name,
        'username', b.username
    ) AS metadata
FROM agg a
JOIN best b ON b.hero_id = a.hero_id AND b.name = a.name
WITH NO DATA
"""

HANDWRITTEN_OBJECTS = (
    # Invariants: 'flex' is a registration-only role, never a hero class or a
    # baseline row; a confirmed result and a COMPLETED encounter imply each other.
    "ALTER TABLE overwatch.hero ADD CONSTRAINT ck_hero_type_not_flex CHECK (type::text <> 'flex')",
    "ALTER TABLE matches.stat_baselines ADD CONSTRAINT ck_stat_baselines_role_not_flex CHECK (role::text <> 'flex')",
    "ALTER TABLE tournament.encounter ADD CONSTRAINT ck_encounter_result_status_matches_status"
    " CHECK ((result_status = 'confirmed') = (status = 'COMPLETED'))",
    # draft_session.current_pick_id -> draft_pick is a cycle the model leaves undeclared.
    "ALTER TABLE balancer.draft_session ADD CONSTRAINT fk_draft_session_current_pick"
    " FOREIGN KEY (current_pick_id) REFERENCES balancer.draft_pick(id) ON DELETE SET NULL",
    # Uniqueness that needs COALESCE or a predicate, which a model column cannot express.
    "CREATE UNIQUE INDEX uq_eval_result_dedup_coalesced ON achievements.evaluation_result"
    " (achievement_rule_id, workspace_member_id, COALESCE(tournament_id, 0), COALESCE(match_id, 0))",
    "CREATE UNIQUE INDEX uq_standing_tournament_stage_item_team ON tournament.standing"
    " (tournament_id, stage_id, COALESCE(stage_item_id, 0), team_id)",
    "CREATE UNIQUE INDEX uq_division_grid_workspace_source_key_active ON public.division_grid"
    " (workspace_id, source_key) WHERE source_key IS NOT NULL AND archived_at IS NULL",
    "CREATE UNIQUE INDEX uq_subscription_requirement_one_default ON subscriptions.requirement"
    " (workspace_id) WHERE is_default",
    # Case-insensitive user search (initcap) and the read-path/FK indexes.
    'CREATE INDEX ix_user_name_initcap ON players."user" (initcap(name))',
    "CREATE INDEX ix_auth_refresh_token_user_id ON auth.refresh_token (user_id)",
    "CREATE INDEX ix_balancer_registration_tournament_status ON balancer.registration (tournament_id, status)",
    "CREATE INDEX ix_division_grid_import_job_status ON public.division_grid_import_job (status)",
    "CREATE INDEX ix_encounter_link_source ON tournament.encounter_link (source_encounter_id)",
    "CREATE INDEX ix_encounter_link_target ON tournament.encounter_link (target_encounter_id)",
    "CREATE INDEX ix_encounter_scheduled_at ON tournament.encounter (scheduled_at)",
    "CREATE INDEX ix_encounter_started_at ON tournament.encounter (started_at)",
    "CREATE INDEX ix_encounter_ended_at ON tournament.encounter (ended_at)",
    "CREATE INDEX ix_encounter_stage_item_round ON tournament.encounter (stage_item_id, round)",
    "CREATE INDEX ix_tournament_tournament_status ON tournament.tournament (status)",
)


def upgrade() -> None:
    for schema in SCHEMAS:
        op.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")
    for extension in EXTENSIONS:
        op.execute(f"CREATE EXTENSION IF NOT EXISTS {extension}")
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table(
        "algorithms",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("produces_shifts", sa.Boolean(), server_default="true", nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
        schema="analytics",
    )
    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("actor_auth_user_id", sa.BigInteger(), nullable=True),
        sa.Column("actor_label", sa.String(length=255), nullable=True),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=True),
        sa.Column("entity_id", sa.BigInteger(), nullable=True),
        sa.Column("entity_label", sa.String(length=255), nullable=True),
        sa.Column("before_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("after_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("correlation_id", sa.String(length=64), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_log_actor_created", "audit_log", ["actor_auth_user_id", "created_at"], unique=False)
    op.create_index(
        "ix_audit_log_entity_created", "audit_log", ["entity_type", "entity_id", "created_at"], unique=False
    )
    op.create_index("ix_audit_log_workspace_created", "audit_log", ["workspace_id", "created_at"], unique=False)
    op.create_table(
        "permissions",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("resource", sa.String(length=100), nullable=False),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="auth",
    )
    op.create_index(op.f("ix_auth_permissions_action"), "permissions", ["action"], unique=False, schema="auth")
    op.create_index(op.f("ix_auth_permissions_name"), "permissions", ["name"], unique=True, schema="auth")
    op.create_index(op.f("ix_auth_permissions_resource"), "permissions", ["resource"], unique=False, schema="auth")
    op.create_table(
        "user",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("username", sa.String(length=100), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("is_superuser", sa.Boolean(), nullable=False),
        sa.Column("is_verified", sa.Boolean(), nullable=False),
        sa.Column("first_name", sa.String(length=100), nullable=True),
        sa.Column("last_name", sa.String(length=100), nullable=True),
        sa.Column("avatar_url", sa.String(length=500), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="auth",
    )
    op.create_index(op.f("ix_auth_user_email"), "user", ["email"], unique=True, schema="auth")
    op.create_index(op.f("ix_auth_user_username"), "user", ["username"], unique=True, schema="auth")
    op.create_table(
        "division_grid",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("source_workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("source_grid_id", sa.BigInteger(), nullable=True),
        sa.Column("source_key", sa.String(length=255), nullable=True),
        sa.Column("source_fingerprint", sa.String(length=64), nullable=True),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["source_grid_id"], ["division_grid.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "slug"),
    )
    op.create_index(op.f("ix_division_grid_source_fingerprint"), "division_grid", ["source_fingerprint"], unique=False)
    op.create_index(op.f("ix_division_grid_source_grid_id"), "division_grid", ["source_grid_id"], unique=False)
    op.create_index(op.f("ix_division_grid_source_key"), "division_grid", ["source_key"], unique=False)
    op.create_index(
        op.f("ix_division_grid_source_workspace_id"), "division_grid", ["source_workspace_id"], unique=False
    )
    op.create_index(op.f("ix_division_grid_workspace_id"), "division_grid", ["workspace_id"], unique=False)
    op.create_table(
        "division_grid_version",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("grid_id", sa.BigInteger(), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="draft", nullable=False),
        sa.Column("created_from_version_id", sa.BigInteger(), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_from_version_id"], ["division_grid_version.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["grid_id"], ["division_grid.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("grid_id", "version"),
    )
    op.create_index(
        op.f("ix_division_grid_version_created_from_version_id"),
        "division_grid_version",
        ["created_from_version_id"],
        unique=False,
    )
    op.create_index(op.f("ix_division_grid_version_grid_id"), "division_grid_version", ["grid_id"], unique=False)
    op.create_table(
        "event_outbox",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("event_type", sa.String(length=128), nullable=False),
        sa.Column("exchange", sa.String(length=255), nullable=True),
        sa.Column("routing_key", sa.String(length=255), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id"),
    )
    op.create_index("ix_event_outbox_status_next_attempt", "event_outbox", ["status", "next_attempt_at"], unique=False)
    op.create_table(
        "stat_baselines",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("formula_version", sa.String(length=64), nullable=False),
        sa.Column("role", sa.Enum("tank", "damage", "support", "flex", name="heroclass"), nullable=False),
        sa.Column("rank_bucket", sa.SmallInteger(), server_default="-1", nullable=False),
        sa.Column(
            "stat",
            sa.Enum(
                "Eliminations",
                "FinalBlows",
                "Deaths",
                "AllDamageDealt",
                "BarrierDamageDealt",
                "HeroDamageDealt",
                "HealingDealt",
                "HealingReceived",
                "SelfHealing",
                "DamageTaken",
                "DamageBlocked",
                "DefensiveAssists",
                "OffensiveAssists",
                "UltimatesEarned",
                "UltimatesUsed",
                "MultikillBest",
                "Multikills",
                "SoloKills",
                "ObjectiveKills",
                "EnvironmentalKills",
                "EnvironmentalDeaths",
                "CriticalHits",
                "CriticalHitAccuracy",
                "ScopedAccuracy",
                "ScopedCriticalHitAccuracy",
                "ScopedCriticalHitKills",
                "ShotsFired",
                "ShotsHit",
                "ShotsMissed",
                "ScopedShotsFired",
                "ScopedShotsHit",
                "WeaponAccuracy",
                "HeroTimePlayed",
                "FirstPicks",
                "FirstDeaths",
                "UltimateKills",
                "SupportKills",
                "Performance",
                "PerformancePoints",
                "KD",
                "KDA",
                "DamageDelta",
                "FBE",
                "DamageFB",
                "Assists",
                "ImpactPoints",
                "ImpactRank",
                "OverperformanceScore",
                name="logstatsname",
            ),
            nullable=False,
        ),
        sa.Column("mean", sa.Float(), nullable=False),
        sa.Column("std", sa.Float(), nullable=False),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("formula_version", "role", "rank_bucket", "stat", name="uq_stat_baselines_key"),
        schema="matches",
    )
    op.create_index("ix_stat_baselines_version", "stat_baselines", ["formula_version"], unique=False, schema="matches")
    op.create_table(
        "gamemode",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("image_path", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column(
            "aliases", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
        sa.UniqueConstraint("slug"),
        schema="overwatch",
    )
    op.create_table(
        "hero",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("image_path", sa.String(), nullable=False),
        sa.Column("type", sa.Enum("tank", "damage", "support", "flex", name="heroclass"), nullable=False),
        sa.Column("color", sa.String(), server_default="#ffffff", nullable=False),
        sa.Column(
            "aliases", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
        sa.UniqueConstraint("slug"),
        schema="overwatch",
    )
    op.create_table(
        "workspace_event",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("topic", sa.Text(), nullable=False),
        sa.Column("event_type", sa.String(length=128), nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=True),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column("schema_version", sa.SmallInteger(), server_default="1", nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema="realtime",
    )
    op.create_index(
        op.f("ix_realtime_workspace_event_actor_user_id"),
        "workspace_event",
        ["actor_user_id"],
        unique=False,
        schema="realtime",
    )
    op.create_index(
        "ix_realtime_workspace_event_occurred_at", "workspace_event", ["occurred_at"], unique=False, schema="realtime"
    )
    op.create_index(
        "ix_realtime_workspace_event_topic_id", "workspace_event", ["topic", "id"], unique=False, schema="realtime"
    )
    op.create_index(
        op.f("ix_realtime_workspace_event_tournament_id"),
        "workspace_event",
        ["tournament_id"],
        unique=False,
        schema="realtime",
    )
    op.create_index(
        op.f("ix_realtime_workspace_event_workspace_id"),
        "workspace_event",
        ["workspace_id"],
        unique=False,
        schema="realtime",
    )
    op.create_table(
        "workspace",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("icon_url", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("timezone", sa.String(length=64), server_default="Europe/Moscow", nullable=False),
        sa.Column("branding_enabled", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("brand_primary", sa.String(), nullable=True),
        sa.Column("brand_secondary", sa.String(), nullable=True),
        sa.Column("brand_background", sa.String(), nullable=True),
        sa.Column("brand_surface", sa.String(), nullable=True),
        sa.Column("brand_accent", sa.String(), nullable=True),
        sa.Column("brand_foreground", sa.String(), nullable=True),
        sa.Column("brand_muted", sa.String(), nullable=True),
        sa.Column("brand_border", sa.String(), nullable=True),
        sa.Column("brand_ring", sa.String(), nullable=True),
        sa.Column("brand_destructive", sa.String(), nullable=True),
        sa.Column("subdomain", sa.String(length=63), nullable=True),
        sa.Column("seo_title", sa.String(), nullable=True),
        sa.Column("seo_description", sa.String(), nullable=True),
        sa.Column("custom_domain", sa.String(length=255), nullable=True),
        sa.Column("custom_domain_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("custom_domain_verification_token", sa.String(length=64), nullable=True),
        sa.Column("discord_guild_id", sa.String(length=32), nullable=True),
        sa.Column("default_division_grid_version_id", sa.BigInteger(), nullable=True),
        sa.Column("default_roster_slots_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(
            ["default_division_grid_version_id"], ["division_grid_version.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_workspace_custom_domain"), "workspace", ["custom_domain"], unique=True)
    op.create_index(
        op.f("ix_workspace_default_division_grid_version_id"),
        "workspace",
        ["default_division_grid_version_id"],
        unique=False,
    )
    op.create_index(op.f("ix_workspace_slug"), "workspace", ["slug"], unique=True)
    op.create_index(op.f("ix_workspace_subdomain"), "workspace", ["subdomain"], unique=True)
    # division_grid ↔ workspace is a cycle (workspace.default_division_grid_version_id
    # points back at a grid version), so these two land after `workspace` exists.
    op.create_foreign_key(None, "division_grid", "workspace", ["workspace_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key(
        "fk_division_grid_source_workspace",
        "division_grid",
        "workspace",
        ["source_workspace_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "rule",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description_ru", sa.String(), nullable=False),
        sa.Column("description_en", sa.String(), nullable=False),
        sa.Column("image_url", sa.String(), nullable=True),
        sa.Column("hero_id", sa.BigInteger(), nullable=True),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("scope", sa.String(), nullable=False),
        sa.Column("grain", sa.String(), nullable=False),
        sa.Column("condition_tree", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("depends_on", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("rule_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("min_tournament_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["hero_id"], ["overwatch.hero.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "slug", name="uq_achievement_rule_workspace_slug"),
        schema="achievements",
    )
    op.create_index(op.f("ix_achievements_rule_slug"), "rule", ["slug"], unique=False, schema="achievements")
    op.create_index(
        op.f("ix_achievements_rule_workspace_id"), "rule", ["workspace_id"], unique=False, schema="achievements"
    )
    op.create_table(
        "api_key",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("auth_user_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("public_id", sa.String(length=32), nullable=False),
        sa.Column("secret_hash", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("scopes_json", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("limits_json", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("config_policy_json", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["auth_user_id"], ["auth.user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="auth",
    )
    op.create_index(
        "ix_api_key_owner_workspace", "api_key", ["auth_user_id", "workspace_id"], unique=False, schema="auth"
    )
    op.create_index("ix_api_key_public_id_active", "api_key", ["public_id", "revoked_at"], unique=False, schema="auth")
    op.create_index(op.f("ix_auth_api_key_auth_user_id"), "api_key", ["auth_user_id"], unique=False, schema="auth")
    op.create_index(op.f("ix_auth_api_key_public_id"), "api_key", ["public_id"], unique=True, schema="auth")
    op.create_index(op.f("ix_auth_api_key_workspace_id"), "api_key", ["workspace_id"], unique=False, schema="auth")
    op.create_table(
        "oauth_connections",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("auth_user_id", sa.BigInteger(), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("provider_user_id", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("username", sa.String(length=100), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=True),
        sa.Column("avatar_url", sa.String(length=500), nullable=True),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("provider_data", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["auth_user_id"], ["auth.user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "provider_user_id", name="uq_provider_user"),
        schema="auth",
    )
    op.create_index(
        op.f("ix_auth_oauth_connections_provider"), "oauth_connections", ["provider"], unique=False, schema="auth"
    )
    op.create_index(
        op.f("ix_auth_oauth_connections_provider_user_id"),
        "oauth_connections",
        ["provider_user_id"],
        unique=False,
        schema="auth",
    )
    op.create_table(
        "refresh_token",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("token", sa.Text(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("session_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_revoked", sa.Boolean(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("user_agent", sa.String(length=500), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["auth.user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="auth",
    )
    op.create_index(
        op.f("ix_auth_refresh_token_session_id"), "refresh_token", ["session_id"], unique=False, schema="auth"
    )
    op.create_index(op.f("ix_auth_refresh_token_token"), "refresh_token", ["token"], unique=True, schema="auth")
    op.create_table(
        "roles",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_system", sa.Boolean(), nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="auth",
    )
    op.create_index(op.f("ix_auth_roles_name"), "roles", ["name"], unique=False, schema="auth")
    op.create_index(op.f("ix_auth_roles_workspace_id"), "roles", ["workspace_id"], unique=False, schema="auth")
    op.create_index(
        "uq_roles_name_global",
        "roles",
        ["name"],
        unique=True,
        schema="auth",
        postgresql_where=sa.text("workspace_id IS NULL"),
    )
    op.create_index(
        "uq_roles_name_workspace",
        "roles",
        ["name", "workspace_id"],
        unique=True,
        schema="auth",
        postgresql_where=sa.text("workspace_id IS NOT NULL"),
    )
    op.create_table(
        "user_permission_deny",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("permission_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["permission_id"], ["auth.permissions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["auth.user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="auth",
    )
    op.create_index(
        op.f("ix_auth_user_permission_deny_workspace_id"),
        "user_permission_deny",
        ["workspace_id"],
        unique=False,
        schema="auth",
    )
    op.create_index("ix_user_permission_deny_user_id", "user_permission_deny", ["user_id"], unique=False, schema="auth")
    op.create_index(
        "uq_user_permission_deny_user_perm_workspace",
        "user_permission_deny",
        ["user_id", "permission_id", sa.literal_column("COALESCE(workspace_id, 0)")],
        unique=True,
        schema="auth",
    )
    op.create_table(
        "registration_status",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("scope", sa.String(length=32), nullable=False),
        sa.Column("slug", sa.String(length=32), nullable=False),
        sa.Column("kind", sa.String(length=16), server_default="custom", nullable=False),
        sa.Column("icon_slug", sa.String(length=128), nullable=True),
        sa.Column("icon_color", sa.String(length=32), nullable=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("excludes_from_balancer", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("excludes_from_ready", sa.Boolean(), server_default="false", nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id", "scope", "slug", "kind", name="uq_balancer_registration_status_workspace_scope_slug"
        ),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_registration_status_workspace_id"),
        "registration_status",
        ["workspace_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        "ix_balancer_registration_status_workspace_scope",
        "registration_status",
        ["workspace_id", "scope"],
        unique=False,
        schema="balancer",
    )
    op.create_table(
        "workspace_config",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("config_json", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["updated_by"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", name="uq_balancer_workspace_config_workspace"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_workspace_config_workspace_id"),
        "workspace_config",
        ["workspace_id"],
        unique=False,
        schema="balancer",
    )
    op.create_table(
        "division_grid_import_job",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("source_workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("requested_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("progress", sa.Integer(), server_default="0", nullable=False),
        sa.Column("request_json", sa.JSON(), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["source_workspace_id"], ["workspace.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "idempotency_key"),
    )
    op.create_index(
        op.f("ix_division_grid_import_job_requested_by_user_id"),
        "division_grid_import_job",
        ["requested_by_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_division_grid_import_job_source_workspace_id"),
        "division_grid_import_job",
        ["source_workspace_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_division_grid_import_job_workspace_id"), "division_grid_import_job", ["workspace_id"], unique=False
    )
    op.create_table(
        "division_grid_mapping",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_version_id", sa.BigInteger(), nullable=False),
        sa.Column("target_version_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("is_complete", sa.Boolean(), server_default="false", nullable=False),
        sa.ForeignKeyConstraint(["source_version_id"], ["division_grid_version.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_version_id"], ["division_grid_version.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_version_id", "target_version_id"),
    )
    op.create_index(
        op.f("ix_division_grid_mapping_source_version_id"), "division_grid_mapping", ["source_version_id"], unique=False
    )
    op.create_index(
        op.f("ix_division_grid_mapping_target_version_id"), "division_grid_mapping", ["target_version_id"], unique=False
    )
    op.create_table(
        "division_grid_tier",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version_id", sa.BigInteger(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("number", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("sort_order", sa.BigInteger(), nullable=False),
        sa.Column("rank_min", sa.BigInteger(), nullable=False),
        sa.Column("rank_max", sa.BigInteger(), nullable=True),
        sa.Column("icon_url", sa.String(), nullable=False),
        sa.Column("ow_rank_min", sa.BigInteger(), nullable=True),
        sa.Column("ow_rank_max", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["version_id"], ["division_grid_version.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("version_id", "slug"),
        sa.UniqueConstraint("version_id", "sort_order"),
    )
    op.create_index(op.f("ix_division_grid_tier_version_id"), "division_grid_tier", ["version_id"], unique=False)
    op.create_table(
        "map",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("gamemode_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("image_path", sa.String(), nullable=False),
        sa.Column("in_competitive", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "aliases", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["gamemode_id"],
            ["overwatch.gamemode.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
        schema="overwatch",
    )
    op.create_table(
        "user",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("avatar_url", sa.String(length=500), nullable=True),
        sa.Column("auth_user_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["auth_user_id"], ["auth.user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
        schema="players",
    )
    op.create_index(op.f("ix_players_user_auth_user_id"), "user", ["auth_user_id"], unique=True, schema="players")
    op.create_index(
        "ix_user_name_trgm",
        "user",
        ["name"],
        unique=False,
        schema="players",
        postgresql_using="gin",
        postgresql_ops={"name": "gin_trgm_ops"},
    )
    op.create_table(
        "settings",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["updated_by"], ["auth.user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_settings_key"), "settings", ["key"], unique=True)
    op.create_table(
        "check_log",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("auth_user_id", sa.BigInteger(), nullable=True),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("tier_rank", sa.Integer(), nullable=True),
        sa.Column("tier_label", sa.String(length=64), nullable=True),
        sa.Column("source", sa.String(length=32), server_default="scheduled", nullable=False),
        sa.Column("mechanism", sa.String(length=32), nullable=True),
        sa.Column("reason", sa.String(length=64), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["auth_user_id"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema="subscriptions",
    )
    op.create_index(
        "ix_subscription_check_log_created_at", "check_log", ["created_at"], unique=False, schema="subscriptions"
    )
    op.create_index(
        "ix_subscription_check_log_state_created",
        "check_log",
        ["state", "created_at"],
        unique=False,
        schema="subscriptions",
    )
    op.create_index(
        "ix_subscription_check_log_user_created",
        "check_log",
        ["auth_user_id", "created_at"],
        unique=False,
        schema="subscriptions",
    )
    op.create_index(
        op.f("ix_subscriptions_check_log_workspace_id"),
        "check_log",
        ["workspace_id"],
        unique=False,
        schema="subscriptions",
    )
    op.create_table(
        "entitlement",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("auth_user_id", sa.BigInteger(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("state", sa.String(length=16), server_default="unknown", nullable=False),
        sa.Column("tier_rank", sa.Integer(), nullable=True),
        sa.Column("tier_label", sa.String(length=64), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("evidence_json", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["auth_user_id"], ["auth.user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "auth_user_id", "provider", name="uq_subscription_entitlement_scope"),
        schema="subscriptions",
    )
    op.create_index(
        "ix_subscription_entitlement_workspace_provider",
        "entitlement",
        ["workspace_id", "provider"],
        unique=False,
        schema="subscriptions",
    )
    op.create_index(
        op.f("ix_subscriptions_entitlement_auth_user_id"),
        "entitlement",
        ["auth_user_id"],
        unique=False,
        schema="subscriptions",
    )
    op.create_index(
        op.f("ix_subscriptions_entitlement_workspace_id"),
        "entitlement",
        ["workspace_id"],
        unique=False,
        schema="subscriptions",
    )
    op.create_table(
        "provider_config",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("config_json", sa.JSON(), server_default="{}", nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "provider", name="uq_subscription_config_workspace_provider"),
        schema="subscriptions",
    )
    op.create_index(
        op.f("ix_subscriptions_provider_config_workspace_id"),
        "provider_config",
        ["workspace_id"],
        unique=False,
        schema="subscriptions",
    )
    op.create_table(
        "requirement",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=64), server_default="default", nullable=False),
        sa.Column("requirement_json", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("is_default", sa.Boolean(), server_default="false", nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "name", name="uq_subscription_requirement_workspace_name"),
        schema="subscriptions",
    )
    op.create_index(
        op.f("ix_subscriptions_requirement_workspace_id"),
        "requirement",
        ["workspace_id"],
        unique=False,
        schema="subscriptions",
    )
    op.create_table(
        "encounter_saved_view",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("auth_user_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("filters_json", sa.JSON(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["auth_user_id"], ["auth.user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "auth_user_id", "name", name="uq_encounter_saved_view_workspace_user_name"),
        schema="tournament",
    )
    op.create_index(
        "ix_encounter_saved_view_workspace_user",
        "encounter_saved_view",
        ["workspace_id", "auth_user_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_saved_view_auth_user_id"),
        "encounter_saved_view",
        ["auth_user_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_saved_view_workspace_id"),
        "encounter_saved_view",
        ["workspace_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "player_sub_role",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("role", sa.String(length=64), nullable=False),
        sa.Column("slug", sa.String(length=128), nullable=False),
        sa.Column("label", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "role", "slug", name="uq_player_sub_role_workspace_role_slug"),
        schema="tournament",
    )
    op.create_index(
        "ix_player_sub_role_workspace_id", "player_sub_role", ["workspace_id"], unique=False, schema="tournament"
    )
    op.create_index(
        "ix_player_sub_role_workspace_role_active",
        "player_sub_role",
        ["workspace_id", "role", "is_active"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "tournament",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("is_league", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("is_finished", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("is_hidden", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("team_formation", sa.String(), server_default="balancer", nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "registration",
                "draft",
                "check_in",
                "live",
                "playoffs",
                "completed",
                "archived",
                name="tournamentstatus",
                schema="tournament",
            ),
            server_default="registration",
            nullable=False,
        ),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("auto_transitions_enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("allow_late_registration", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("win_points", sa.Float(), server_default="1.0", nullable=False),
        sa.Column("draw_points", sa.Float(), server_default="0.5", nullable=False),
        sa.Column("loss_points", sa.Float(), server_default="0.0", nullable=False),
        sa.Column("division_grid_version_id", sa.BigInteger(), nullable=True),
        sa.Column("roster_slots_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(["division_grid_version_id"], ["division_grid_version.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_tournament_division_grid_version_id"),
        "tournament",
        ["division_grid_version_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_tournament_is_hidden"), "tournament", ["is_hidden"], unique=False, schema="tournament"
    )
    op.create_index(
        op.f("ix_tournament_tournament_workspace_id"), "tournament", ["workspace_id"], unique=False, schema="tournament"
    )
    op.create_table(
        "evaluation_run",
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("trigger", sa.String(), nullable=False),
        sa.Column("tournament_id", sa.BigInteger(), nullable=True),
        sa.Column("rules_evaluated", sa.Integer(), server_default="0", nullable=False),
        sa.Column("results_created", sa.Integer(), server_default="0", nullable=False),
        sa.Column("results_removed", sa.Integer(), server_default="0", nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(), server_default="running", nullable=False),
        sa.Column("error_message", sa.String(), nullable=True),
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="achievements",
    )
    op.create_index(
        op.f("ix_achievements_evaluation_run_id"), "evaluation_run", ["id"], unique=False, schema="achievements"
    )
    op.create_index(
        op.f("ix_achievements_evaluation_run_workspace_id"),
        "evaluation_run",
        ["workspace_id"],
        unique=False,
        schema="achievements",
    )
    op.create_table(
        "explanation",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("algorithm_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("entity_kind", sa.String(length=16), nullable=False),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("base_value", sa.Float(), nullable=False),
        sa.Column("contributions", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["algorithm_id"], ["analytics.algorithms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_explanation_algorithm_id"), "explanation", ["algorithm_id"], unique=False, schema="analytics"
    )
    op.create_index(
        op.f("ix_analytics_explanation_entity_id"), "explanation", ["entity_id"], unique=False, schema="analytics"
    )
    op.create_index(
        op.f("ix_analytics_explanation_entity_kind"), "explanation", ["entity_kind"], unique=False, schema="analytics"
    )
    op.create_index(
        op.f("ix_analytics_explanation_tournament_id"),
        "explanation",
        ["tournament_id"],
        unique=False,
        schema="analytics",
    )
    op.create_table(
        "job",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("requested_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("algorithms", sa.JSON(), nullable=True),
        sa.Column("training_workspace_ids", sa.JSON(), nullable=True),
        sa.Column("progress", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_job_requested_by_user_id"), "job", ["requested_by_user_id"], unique=False, schema="analytics"
    )
    op.create_index("ix_analytics_job_status", "job", ["status"], unique=False, schema="analytics")
    op.create_index(op.f("ix_analytics_job_tournament_id"), "job", ["tournament_id"], unique=False, schema="analytics")
    op.create_index(op.f("ix_analytics_job_workspace_id"), "job", ["workspace_id"], unique=False, schema="analytics")
    op.create_index(
        "uq_analytics_job_one_running_per_workspace",
        "job",
        ["workspace_id"],
        unique=True,
        schema="analytics",
        postgresql_where=sa.text("status IN ('pending', 'running')"),
    )
    op.create_table(
        "ml_features",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("granularity", sa.String(length=16), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("feature_version", sa.String(length=32), nullable=False),
        sa.Column("features", sa.JSON(), nullable=False),
        sa.Column("log_coverage", sa.Float(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tournament_id", "granularity", "entity_id", "feature_version", name="uq_analytics_ml_features"
        ),
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_ml_features_entity_id"), "ml_features", ["entity_id"], unique=False, schema="analytics"
    )
    op.create_index(
        op.f("ix_analytics_ml_features_granularity"), "ml_features", ["granularity"], unique=False, schema="analytics"
    )
    op.create_index(
        op.f("ix_analytics_ml_features_tournament_id"),
        "ml_features",
        ["tournament_id"],
        unique=False,
        schema="analytics",
    )
    op.create_table(
        "ml_model_artifact",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("algorithm_id", sa.BigInteger(), nullable=False),
        sa.Column("model_kind", sa.String(length=32), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=True),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.Column("storage_uri", sa.Text(), nullable=False),
        sa.Column("feature_version", sa.String(length=32), nullable=False),
        sa.Column("training_cutoff_tournament_id", sa.BigInteger(), nullable=True),
        sa.Column("metrics", sa.JSON(), nullable=True),
        sa.Column("feature_importance", sa.JSON(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="false", nullable=False),
        sa.ForeignKeyConstraint(["algorithm_id"], ["analytics.algorithms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["training_cutoff_tournament_id"], ["tournament.tournament.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("algorithm_id", "model_kind", "role", "version", name="uq_analytics_ml_model_artifact"),
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_ml_model_artifact_algorithm_id"),
        "ml_model_artifact",
        ["algorithm_id"],
        unique=False,
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_ml_model_artifact_is_active"),
        "ml_model_artifact",
        ["is_active"],
        unique=False,
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_ml_model_artifact_model_kind"),
        "ml_model_artifact",
        ["model_kind"],
        unique=False,
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_ml_model_artifact_training_cutoff_tournament_id"),
        "ml_model_artifact",
        ["training_cutoff_tournament_id"],
        unique=False,
        schema="analytics",
    )
    op.create_table(
        "role_permissions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.Column("permission_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["permission_id"], ["auth.permissions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["auth.roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="auth",
    )
    op.create_index(
        "ix_role_permissions_permission_id", "role_permissions", ["permission_id"], unique=False, schema="auth"
    )
    op.create_index("ix_role_permissions_role_id", "role_permissions", ["role_id"], unique=False, schema="auth")
    op.create_table(
        "user_roles",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["auth.roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["auth.user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="auth",
    )
    op.create_index("ix_user_roles_role_id", "user_roles", ["role_id"], unique=False, schema="auth")
    op.create_index("ix_user_roles_user_id", "user_roles", ["user_id"], unique=False, schema="auth")
    op.create_table(
        "balance",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("algorithm", sa.String(length=32), nullable=True),
        sa.Column("division_grid_json", sa.JSON(), nullable=True),
        sa.Column("division_scope", sa.String(length=32), nullable=True),
        sa.Column("config_json", sa.JSON(), nullable=True),
        sa.Column("result_json", sa.JSON(), nullable=False),
        sa.Column("saved_by", sa.BigInteger(), nullable=True),
        sa.Column("saved_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("exported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("export_status", sa.String(length=32), nullable=True),
        sa.Column("export_error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["saved_by"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", name="uq_balancer_balance_tournament"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_balance_tournament_id"), "balance", ["tournament_id"], unique=False, schema="balancer"
    )
    op.create_index(
        op.f("ix_balancer_balance_workspace_id"), "balance", ["workspace_id"], unique=False, schema="balancer"
    )
    op.create_table(
        "registration_form",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("is_open", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("auto_approve", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("built_in_fields_json", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("custom_fields_json", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("require_open_profile", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("open_profile_scope", sa.String(length=8), server_default="main", nullable=False),
        sa.Column("show_ranks", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("require_subscription", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("subscription_stage", sa.String(length=16), server_default="check_in", nullable=False),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", name="uq_balancer_registration_form_tournament"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_registration_form_tournament_id"),
        "registration_form",
        ["tournament_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_registration_form_workspace_id"),
        "registration_form",
        ["workspace_id"],
        unique=False,
        schema="balancer",
    )
    op.create_table(
        "registration_google_sheet_feed",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("sheet_id", sa.String(length=255), nullable=False),
        sa.Column("gid", sa.String(length=64), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("auto_sync_enabled", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("auto_sync_interval_seconds", sa.Integer(), server_default="300", nullable=False),
        sa.Column("header_row_json", sa.JSON(), nullable=True),
        sa.Column("mapping_config_json", sa.JSON(), nullable=True),
        sa.Column("value_mapping_json", sa.JSON(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_status", sa.String(length=32), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", name="uq_balancer_registration_google_sheet_feed_tournament"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_registration_google_sheet_feed_tournament_id"),
        "registration_google_sheet_feed",
        ["tournament_id"],
        unique=False,
        schema="balancer",
    )
    op.create_table(
        "tournament_config",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("config_json", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", name="uq_balancer_tournament_config_tournament"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_tournament_config_tournament_id"),
        "tournament_config",
        ["tournament_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_tournament_config_workspace_id"),
        "tournament_config",
        ["workspace_id"],
        unique=False,
        schema="balancer",
    )
    op.create_table(
        "division_grid_mapping_rule",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("mapping_id", sa.BigInteger(), nullable=False),
        sa.Column("source_tier_id", sa.BigInteger(), nullable=False),
        sa.Column("target_tier_id", sa.BigInteger(), nullable=False),
        sa.Column("weight", sa.Float(), server_default="1.0", nullable=False),
        sa.Column("is_primary", sa.Boolean(), server_default="false", nullable=False),
        sa.ForeignKeyConstraint(["mapping_id"], ["division_grid_mapping.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_tier_id"], ["division_grid_tier.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_tier_id"], ["division_grid_tier.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_division_grid_mapping_rule_mapping_id"), "division_grid_mapping_rule", ["mapping_id"], unique=False
    )
    op.create_index(
        op.f("ix_division_grid_mapping_rule_source_tier_id"),
        "division_grid_mapping_rule",
        ["source_tier_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_division_grid_mapping_rule_target_tier_id"),
        "division_grid_mapping_rule",
        ["target_tier_id"],
        unique=False,
    )
    op.create_table(
        "discord_channel",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("channel_id", sa.BigInteger(), nullable=False),
        sa.Column("channel_name", sa.String(length=100), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id"),
        schema="log_processing",
    )
    op.create_index(
        op.f("ix_log_processing_discord_channel_channel_id"),
        "discord_channel",
        ["channel_id"],
        unique=True,
        schema="log_processing",
    )
    op.create_table(
        "social_account",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("username_normalized", sa.String(length=255), nullable=True),
        sa.Column("url", sa.String(length=500), nullable=True),
        sa.Column("provider_user_id", sa.String(length=255), nullable=True),
        sa.Column("is_verified", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("is_primary", sa.Boolean(), server_default="false", nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["players.user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "provider", "username_normalized", name="uq_social_account_user_provider_handle"
        ),
        schema="players",
    )
    op.create_index("ix_social_account_provider", "social_account", ["provider"], unique=False, schema="players")
    op.create_index(
        "ix_social_account_provider_user_id", "social_account", ["provider_user_id"], unique=False, schema="players"
    )
    op.create_index("ix_social_account_user_id", "social_account", ["user_id"], unique=False, schema="players")
    op.create_index(
        "ix_social_account_username_normalized",
        "social_account",
        ["username_normalized"],
        unique=False,
        schema="players",
    )
    op.create_index(
        "uq_social_account_provider_subject",
        "social_account",
        ["provider", "provider_user_id"],
        unique=True,
        schema="players",
        postgresql_where=sa.text("provider_user_id IS NOT NULL"),
    )
    op.create_index(
        "uq_social_account_user_provider_handle_nullnorm",
        "social_account",
        ["user_id", "provider", sa.literal_column("lower(btrim(username))")],
        unique=True,
        schema="players",
        postgresql_where=sa.text("username_normalized IS NULL"),
    )
    op.create_table(
        "user_merge_audit",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_user_id", sa.BigInteger(), nullable=True),
        sa.Column("target_user_id", sa.BigInteger(), nullable=True),
        sa.Column("operator_auth_user_id", sa.BigInteger(), nullable=True),
        sa.Column("field_policy_json", sa.JSON(), nullable=False),
        sa.Column("moved_identity_ids_json", sa.JSON(), nullable=False),
        sa.Column("deduped_identity_ids_json", sa.JSON(), nullable=False),
        sa.Column("affected_counts_json", sa.JSON(), nullable=False),
        sa.Column("preview_snapshot_json", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["operator_auth_user_id"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["source_user_id"], ["players.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["target_user_id"], ["players.user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema="players",
    )
    op.create_index(
        op.f("ix_players_user_merge_audit_operator_auth_user_id"),
        "user_merge_audit",
        ["operator_auth_user_id"],
        unique=False,
        schema="players",
    )
    op.create_index(
        op.f("ix_players_user_merge_audit_source_user_id"),
        "user_merge_audit",
        ["source_user_id"],
        unique=False,
        schema="players",
    )
    op.create_index(
        op.f("ix_players_user_merge_audit_target_user_id"),
        "user_merge_audit",
        ["target_user_id"],
        unique=False,
        schema="players",
    )
    op.create_table(
        "encounter_report_form",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("built_in_fields_json", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("custom_fields_json", sa.JSON(), server_default="[]", nullable=False),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", name="uq_encounter_report_form_tournament"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_report_form_tournament_id"),
        "encounter_report_form",
        ["tournament_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "recalculation_state",
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("requested_generation", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("completed_generation", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("tournament_id"),
        schema="tournament",
    )
    op.create_table(
        "stage",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column(
            "stage_type",
            sa.Enum(
                "round_robin",
                "single_elimination",
                "double_elimination",
                "swiss",
                name="stagetype",
                schema="tournament",
            ),
            nullable=False,
        ),
        sa.Column("max_rounds", sa.Integer(), server_default="5", nullable=False),
        sa.Column("advance_count", sa.Integer(), nullable=True),
        sa.Column("split_lower_bracket", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("is_completed", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("settings_json", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_stage_tournament_id"), "stage", ["tournament_id"], unique=False, schema="tournament"
    )
    op.create_table(
        "team",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("balancer_name", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("captain_id", sa.BigInteger(), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["captain_id"], ["players.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(op.f("ix_tournament_team_captain_id"), "team", ["captain_id"], unique=False, schema="tournament")
    op.create_index(
        op.f("ix_tournament_team_tournament_id"), "team", ["tournament_id"], unique=False, schema="tournament"
    )
    op.create_table(
        "tournament_phase_schedule",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "registration",
                "draft",
                "check_in",
                "live",
                "playoffs",
                "completed",
                "archived",
                name="tournamentstatus",
                schema="tournament",
            ),
            nullable=False,
        ),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("ends_at IS NULL OR ends_at > starts_at", name="ck_tournament_phase_schedule_window"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", "status", name="uq_tournament_phase_schedule_phase"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_tournament_phase_schedule_starts_at"),
        "tournament_phase_schedule",
        ["starts_at"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_tournament_phase_schedule_tournament_id"),
        "tournament_phase_schedule",
        ["tournament_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "tournament_preview_access",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("auth_user_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["auth_user_id"], ["auth.user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", "auth_user_id", name="uq_tournament_preview_access_tournament_user"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_tournament_preview_access_auth_user_id"),
        "tournament_preview_access",
        ["auth_user_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_tournament_preview_access_tournament_id"),
        "tournament_preview_access",
        ["tournament_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "workspace_member",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("player_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["player_id"], ["players.user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "workspace_id", name="uq_workspace_member_id_workspace"),
        sa.UniqueConstraint("workspace_id", "player_id", name="uq_workspace_member_workspace_player"),
    )
    op.create_index(op.f("ix_workspace_member_player_id"), "workspace_member", ["player_id"], unique=False)
    op.create_index(op.f("ix_workspace_member_workspace_id"), "workspace_member", ["workspace_id"], unique=False)
    op.create_table(
        "standings_distribution",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("team_id", sa.BigInteger(), nullable=False),
        sa.Column("algorithm_id", sa.BigInteger(), nullable=False),
        sa.Column("mean_position", sa.Float(), nullable=False),
        sa.Column("median_position", sa.Float(), nullable=False),
        sa.Column("p10_position", sa.Float(), nullable=False),
        sa.Column("p90_position", sa.Float(), nullable=False),
        sa.Column("prob_top1", sa.Float(), server_default="0", nullable=False),
        sa.Column("prob_top3", sa.Float(), server_default="0", nullable=False),
        sa.Column("prob_top8", sa.Float(), server_default="0", nullable=False),
        sa.Column("position_histogram", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["algorithm_id"], ["analytics.algorithms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["team_id"], ["tournament.team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", "team_id", "algorithm_id", name="uq_analytics_standings_distribution"),
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_standings_distribution_algorithm_id"),
        "standings_distribution",
        ["algorithm_id"],
        unique=False,
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_standings_distribution_team_id"),
        "standings_distribution",
        ["team_id"],
        unique=False,
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_standings_distribution_tournament_id"),
        "standings_distribution",
        ["tournament_id"],
        unique=False,
        schema="analytics",
    )
    op.create_table(
        "balance_variant",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("balance_id", sa.BigInteger(), nullable=False),
        sa.Column("variant_number", sa.Integer(), nullable=False),
        sa.Column("algorithm", sa.String(length=32), nullable=False),
        sa.Column("objective_score", sa.Float(), nullable=True),
        sa.Column("statistics_json", sa.JSON(), nullable=True),
        sa.Column("is_selected", sa.Boolean(), server_default="false", nullable=False),
        sa.ForeignKeyConstraint(["balance_id"], ["balancer.balance.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("balance_id", "variant_number", name="uq_balancer_balance_variant"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_balance_variant_balance_id"),
        "balance_variant",
        ["balance_id"],
        unique=False,
        schema="balancer",
    )
    op.create_table(
        "draft_session",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="setup", nullable=False),
        sa.Column("blocked_reason", sa.String(length=64), nullable=True),
        sa.Column("format", sa.String(length=16), server_default="snake", nullable=False),
        sa.Column("rounds", sa.Integer(), server_default="4", nullable=False),
        sa.Column("pick_time_seconds", sa.Integer(), server_default="45", nullable=False),
        sa.Column("current_pick_id", sa.BigInteger(), nullable=True),
        sa.Column("pool_source", sa.String(length=32), server_default="balancer_balance", nullable=False),
        sa.Column("source_balance_id", sa.BigInteger(), nullable=True),
        sa.Column("autopick_strategy", sa.String(length=16), server_default="best_fit", nullable=False),
        sa.Column("allow_admin_override", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("exported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("export_status", sa.String(length=32), nullable=True),
        sa.Column("settings_json", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("version", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["current_pick_id"],
            ["balancer.draft_pick.id"],
            name="fk_draft_session_current_pick",
            ondelete="SET NULL",
            use_alter=True,
        ),
        sa.ForeignKeyConstraint(["source_balance_id"], ["balancer.balance.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_draft_session_source_balance_id"),
        "draft_session",
        ["source_balance_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_draft_session_workspace_id"),
        "draft_session",
        ["workspace_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        "ix_draft_session_status_created", "draft_session", ["status", "created_at"], unique=False, schema="balancer"
    )
    op.create_index(
        "ix_draft_session_tournament_status",
        "draft_session",
        ["tournament_id", "status"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        "uq_draft_session_active_tournament",
        "draft_session",
        ["tournament_id"],
        unique=True,
        schema="balancer",
        postgresql_where=sa.text("status IN ('setup','ready','live','paused')"),
    )
    op.create_table(
        "registration",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_member_id", sa.BigInteger(), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("battle_tag", sa.String(length=255), nullable=True),
        sa.Column("battle_tag_normalized", sa.String(length=255), nullable=True),
        sa.Column("smurf_tags_json", sa.JSON(), nullable=True),
        sa.Column("discord_nick", sa.String(length=255), nullable=True),
        sa.Column("twitch_nick", sa.String(length=255), nullable=True),
        sa.Column("boosty_nick", sa.String(length=255), nullable=True),
        sa.Column("stream_pov", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("exclude_reason", sa.String(length=64), nullable=True),
        sa.Column("admin_notes", sa.Text(), nullable=True),
        sa.Column("custom_fields_json", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="pending", nullable=False),
        sa.Column("balancer_status", sa.String(length=32), server_default="not_in_balancer", nullable=False),
        sa.Column("checked_in", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("checked_in_by", sa.BigInteger(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("balancer_profile_overridden_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["checked_in_by"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["deleted_by"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_member_id"], ["workspace_member.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema="balancer",
    )
    op.create_index(
        "ix_balancer_registration_tournament_balancer_status",
        "registration",
        ["tournament_id", "status", "balancer_status"],
        unique=False,
        schema="balancer",
        postgresql_where="deleted_at IS NULL",
    )
    op.create_index(
        op.f("ix_balancer_registration_tournament_id"),
        "registration",
        ["tournament_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_registration_workspace_member_id"),
        "registration",
        ["workspace_member_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        "uq_balancer_registration_tournament_tag_active",
        "registration",
        ["tournament_id", "battle_tag_normalized"],
        unique=True,
        schema="balancer",
        postgresql_where="battle_tag_normalized IS NOT NULL AND deleted_at IS NULL",
    )
    op.create_index(
        "uq_balancer_registration_user",
        "registration",
        ["tournament_id", "workspace_member_id"],
        unique=True,
        schema="balancer",
        postgresql_where="deleted_at IS NULL",
    )
    op.create_table(
        "fetch_log",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("social_account_id", sa.BigInteger(), nullable=True),
        sa.Column("battle_tag", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("snapshots_written", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["social_account_id"], ["players.social_account.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema="overwatch_rank",
    )
    op.create_index("ix_fetch_log_created_at", "fetch_log", ["created_at"], unique=False, schema="overwatch_rank")
    op.create_index(
        "ix_fetch_log_status_created", "fetch_log", ["status", "created_at"], unique=False, schema="overwatch_rank"
    )
    op.create_table(
        "rank_snapshot",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("social_account_id", sa.BigInteger(), nullable=False),
        sa.Column("battle_tag", sa.String(length=255), nullable=False),
        sa.Column("platform", sa.String(length=16), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("division", sa.String(length=32), nullable=True),
        sa.Column("tier", sa.SmallInteger(), nullable=True),
        sa.Column("season", sa.Integer(), nullable=True),
        sa.Column("rank_value", sa.Integer(), nullable=True),
        sa.Column("mapping_version", sa.String(length=64), nullable=True),
        sa.Column("is_ranked", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("raw_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("source", sa.String(length=32), server_default="scheduled", nullable=False),
        sa.ForeignKeyConstraint(["social_account_id"], ["players.social_account.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["players.user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="overwatch_rank",
    )
    op.create_index(
        op.f("ix_overwatch_rank_rank_snapshot_captured_at"),
        "rank_snapshot",
        ["captured_at"],
        unique=False,
        schema="overwatch_rank",
    )
    op.create_index(
        "ix_rank_snapshot_series_captured",
        "rank_snapshot",
        ["social_account_id", "role", "platform", "captured_at"],
        unique=False,
        schema="overwatch_rank",
    )
    op.create_index(
        "ix_rank_snapshot_user_captured",
        "rank_snapshot",
        ["user_id", "captured_at"],
        unique=False,
        schema="overwatch_rank",
    )
    op.create_table(
        "social_account_visibility",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["account_id"], ["players.social_account.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="players",
    )
    op.create_index(
        "ix_social_account_visibility_account_id",
        "social_account_visibility",
        ["account_id"],
        unique=False,
        schema="players",
    )
    op.create_index(
        "ix_social_account_visibility_workspace_id",
        "social_account_visibility",
        ["workspace_id"],
        unique=False,
        schema="players",
    )
    op.create_index(
        "uq_social_visibility_global",
        "social_account_visibility",
        ["account_id"],
        unique=True,
        schema="players",
        postgresql_where=sa.text("workspace_id IS NULL"),
    )
    op.create_index(
        "uq_social_visibility_workspace",
        "social_account_visibility",
        ["account_id", "workspace_id"],
        unique=True,
        schema="players",
        postgresql_where=sa.text("workspace_id IS NOT NULL"),
    )
    op.create_table(
        "group",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("is_groups", sa.Boolean(), nullable=False),
        sa.Column("challonge_id", sa.Integer(), nullable=True),
        sa.Column("challonge_slug", sa.String(), nullable=True),
        sa.Column("stage_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["stage_id"], ["tournament.stage.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_group_tournament_id"), "group", ["tournament_id"], unique=False, schema="tournament"
    )
    op.create_table(
        "map_veto_config",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("stage_id", sa.BigInteger(), nullable=True),
        sa.Column("round", sa.Integer(), nullable=True),
        sa.Column(
            "mode",
            sa.Enum("pool", "slots", name="mapvetomode", schema="tournament"),
            server_default="pool",
            nullable=False,
        ),
        sa.Column(
            "first_pick_rule",
            sa.Enum("higher_seed", name="firstpickrule", schema="tournament"),
            server_default="higher_seed",
            nullable=False,
        ),
        sa.Column(
            "first_ban_rotation",
            sa.Enum(
                "fixed",
                "alternate",
                "result_winner_first",
                "result_loser_first",
                "result_loser_choice",
                name="firstbanrotation",
                schema="tournament",
            ),
            server_default="fixed",
            nullable=False,
        ),
        sa.Column("turn_timer_seconds", sa.Integer(), nullable=True),
        sa.Column("preset", sa.String(length=32), nullable=True),
        sa.Column("veto_sequence_json", sa.JSON(), nullable=False),
        sa.CheckConstraint("NOT (mode = 'slots' AND preset = 'custom')", name="ck_map_veto_config_slots_not_custom"),
        sa.CheckConstraint("round IS NULL OR stage_id IS NOT NULL", name="ck_map_veto_config_round_requires_stage"),
        sa.ForeignKeyConstraint(["stage_id"], ["tournament.stage.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_map_veto_config_tournament_id"),
        "map_veto_config",
        ["tournament_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        "uq_map_veto_config_level",
        "map_veto_config",
        ["tournament_id", "stage_id", "round"],
        unique=True,
        schema="tournament",
        postgresql_nulls_not_distinct=True,
    )
    op.create_table(
        "pick_ban_config",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.Enum("map", "hero", name="pickbankind", schema="tournament"), nullable=False),
        sa.Column("stage_id", sa.BigInteger(), nullable=True),
        sa.Column("round", sa.Integer(), nullable=True),
        sa.Column(
            "mode",
            sa.Enum("pool", "slots", name="pickbanmode", schema="tournament"),
            server_default="pool",
            nullable=False,
        ),
        sa.Column(
            "first_pick_rule",
            sa.Enum("higher_seed", name="pickbanfirstpickrule", schema="tournament"),
            server_default="higher_seed",
            nullable=False,
        ),
        sa.Column(
            "first_ban_rotation",
            sa.Enum(
                "fixed",
                "alternate",
                "result_winner_first",
                "result_loser_first",
                "result_loser_choice",
                name="pickbanrotation",
                schema="tournament",
            ),
            server_default="fixed",
            nullable=False,
        ),
        sa.Column("turn_timer_seconds", sa.Integer(), nullable=True),
        sa.Column("preset", sa.String(length=32), nullable=True),
        sa.Column("sequence_json", sa.JSON(), nullable=False),
        sa.Column(
            "no_repeat_scope",
            sa.Enum("none", "encounter", "encounter_same_side", name="pickbannorepeatscope", schema="tournament"),
            server_default="none",
            nullable=False,
        ),
        sa.Column("unique_attribute_per_side_per_round", sa.String(length=32), nullable=True),
        sa.Column("allow_protect", sa.Boolean(), server_default="false", nullable=False),
        sa.CheckConstraint("NOT (mode = 'slots' AND preset = 'custom')", name="ck_pick_ban_config_slots_not_custom"),
        sa.CheckConstraint("round IS NULL OR stage_id IS NOT NULL", name="ck_pick_ban_config_round_requires_stage"),
        sa.ForeignKeyConstraint(["stage_id"], ["tournament.stage.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_pick_ban_config_tournament_id"),
        "pick_ban_config",
        ["tournament_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        "uq_pick_ban_config_level",
        "pick_ban_config",
        ["tournament_id", "kind", "stage_id", "round"],
        unique=True,
        schema="tournament",
        postgresql_nulls_not_distinct=True,
    )
    op.create_table(
        "player",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("sub_role", sa.String(length=128), nullable=True),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("role", sa.Enum("tank", "damage", "support", "flex", name="heroclass"), nullable=True),
        sa.Column("is_substitution", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("related_player_id", sa.BigInteger(), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("is_newcomer", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("is_newcomer_role", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("workspace_member_id", sa.BigInteger(), nullable=False),
        sa.Column("team_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["related_player_id"], ["tournament.player.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["team_id"], ["tournament.team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_member_id"], ["workspace_member.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(
        "ix_player_member_not_sub",
        "player",
        ["workspace_member_id", "tournament_id"],
        unique=False,
        schema="tournament",
        postgresql_where=sa.text("is_substitution = false"),
    )
    op.create_index("ix_player_related_player_id", "player", ["related_player_id"], unique=False, schema="tournament")
    op.create_index(
        "ix_player_team_workspace_member",
        "player",
        ["team_id", "workspace_member_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        "ix_player_tournament_role_sub_role",
        "player",
        ["tournament_id", "role", "sub_role"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        "ix_player_workspace_member_tournament",
        "player",
        ["workspace_member_id", "tournament_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_player_tournament_id"), "player", ["tournament_id"], unique=False, schema="tournament"
    )
    op.create_table(
        "stage_item",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stage_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column(
            "type",
            sa.Enum(
                "group", "bracket_upper", "bracket_lower", "single_bracket", name="stageitemtype", schema="tournament"
            ),
            nullable=False,
        ),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["stage_id"], ["tournament.stage.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_stage_item_stage_id"), "stage_item", ["stage_id"], unique=False, schema="tournament"
    )
    op.create_table(
        "anomaly_feedback",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("player_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("verdict", sa.String(length=16), nullable=False),
        sa.Column("reviewer_user_id", sa.BigInteger(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["player_id"], ["tournament.player.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewer_user_id"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", "player_id", "kind", name="uq_analytics_anomaly_feedback"),
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_anomaly_feedback_kind"), "anomaly_feedback", ["kind"], unique=False, schema="analytics"
    )
    op.create_index(
        op.f("ix_analytics_anomaly_feedback_player_id"),
        "anomaly_feedback",
        ["player_id"],
        unique=False,
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_anomaly_feedback_reviewer_user_id"),
        "anomaly_feedback",
        ["reviewer_user_id"],
        unique=False,
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_anomaly_feedback_tournament_id"),
        "anomaly_feedback",
        ["tournament_id"],
        unique=False,
        schema="analytics",
    )
    op.create_table(
        "balance_snapshot",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("balance_id", sa.BigInteger(), nullable=False),
        sa.Column("variant_id", sa.BigInteger(), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("algorithm", sa.String(length=32), nullable=False),
        sa.Column("division_scope", sa.String(length=32), nullable=True),
        sa.Column("division_grid_json", sa.JSON(), nullable=True),
        sa.Column("team_count", sa.Integer(), nullable=False),
        sa.Column("player_count", sa.Integer(), nullable=False),
        sa.Column("avg_sr_overall", sa.Float(), nullable=False),
        sa.Column("sr_std_dev", sa.Float(), nullable=False),
        sa.Column("sr_range", sa.Float(), nullable=False),
        sa.Column("total_discomfort", sa.Integer(), server_default="0", nullable=False),
        sa.Column("off_role_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("objective_score", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(["balance_id"], ["balancer.balance.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["variant_id"], ["balancer.balance_variant.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", "balance_id", name="uq_analytics_balance_snapshot"),
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_balance_snapshot_balance_id"),
        "balance_snapshot",
        ["balance_id"],
        unique=False,
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_balance_snapshot_tournament_id"),
        "balance_snapshot",
        ["tournament_id"],
        unique=False,
        schema="analytics",
    )
    op.create_table(
        "performance",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("player_id", sa.BigInteger(), nullable=False),
        sa.Column("algorithm_id", sa.BigInteger(), nullable=False),
        sa.Column("impact_score", sa.Float(), nullable=False),
        sa.Column("raw_value", sa.Float(), nullable=False),
        sa.Column("confidence", sa.Float(), server_default="0", nullable=False),
        sa.Column("log_coverage", sa.Float(), server_default="0", nullable=False),
        sa.Column("local_mean", sa.Float(), server_default="0", nullable=False),
        sa.Column("local_std", sa.Float(), server_default="1", nullable=False),
        sa.Column("local_residual", sa.Float(), server_default="0", nullable=False),
        sa.Column("local_zscore", sa.Float(), server_default="0", nullable=False),
        sa.Column("local_percentile", sa.Float(), server_default="50", nullable=False),
        sa.Column("local_reference_n", sa.Integer(), server_default="0", nullable=False),
        sa.Column("local_band_min_div", sa.Integer(), nullable=True),
        sa.Column("local_band_max_div", sa.Integer(), nullable=True),
        sa.Column("top_features", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["algorithm_id"], ["analytics.algorithms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["player_id"], ["tournament.player.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", "player_id", "algorithm_id", name="uq_analytics_performance"),
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_performance_algorithm_id"), "performance", ["algorithm_id"], unique=False, schema="analytics"
    )
    op.create_index(
        op.f("ix_analytics_performance_player_id"), "performance", ["player_id"], unique=False, schema="analytics"
    )
    op.create_index(
        op.f("ix_analytics_performance_tournament_id"),
        "performance",
        ["tournament_id"],
        unique=False,
        schema="analytics",
    )
    op.create_table(
        "shifts",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("algorithm_id", sa.BigInteger(), nullable=False),
        sa.Column("player_id", sa.BigInteger(), nullable=False),
        sa.Column("shift", sa.Float(), nullable=False),
        sa.Column("confidence", sa.Float(), server_default="0", nullable=False),
        sa.Column("effective_evidence", sa.Float(), server_default="0", nullable=False),
        sa.Column("sample_tournaments", sa.Integer(), server_default="0", nullable=False),
        sa.Column("sample_matches", sa.Integer(), server_default="0", nullable=False),
        sa.Column("log_coverage", sa.Float(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["algorithm_id"], ["analytics.algorithms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["player_id"], ["tournament.player.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_shifts_algorithm_id"), "shifts", ["algorithm_id"], unique=False, schema="analytics"
    )
    op.create_index(op.f("ix_analytics_shifts_player_id"), "shifts", ["player_id"], unique=False, schema="analytics")
    op.create_index(
        op.f("ix_analytics_shifts_tournament_id"), "shifts", ["tournament_id"], unique=False, schema="analytics"
    )
    op.create_table(
        "tournament",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("player_id", sa.BigInteger(), nullable=False),
        sa.Column("wins", sa.Integer(), nullable=False),
        sa.Column("losses", sa.Integer(), nullable=False),
        sa.Column("shift_one", sa.Integer(), nullable=True),
        sa.Column("shift_two", sa.Integer(), nullable=True),
        sa.Column("shift", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["player_id"], ["tournament.player.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_tournament_player_id"), "tournament", ["player_id"], unique=False, schema="analytics"
    )
    op.create_index(
        op.f("ix_analytics_tournament_tournament_id"), "tournament", ["tournament_id"], unique=False, schema="analytics"
    )
    op.create_table(
        "draft_audit_event",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("session_id", sa.BigInteger(), nullable=False),
        sa.Column("actor_auth_user_id", sa.BigInteger(), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("before_json", sa.JSON(), nullable=False),
        sa.Column("after_json", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["actor_auth_user_id"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["session_id"], ["balancer.draft_session.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_draft_audit_event_actor_auth_user_id"),
        "draft_audit_event",
        ["actor_auth_user_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        "ix_draft_audit_session_created",
        "draft_audit_event",
        ["session_id", "created_at"],
        unique=False,
        schema="balancer",
    )
    op.create_table(
        "draft_team",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("session_id", sa.BigInteger(), nullable=False),
        sa.Column("captain_workspace_member_id", sa.BigInteger(), nullable=True),
        sa.Column("captain_auth_user_id", sa.BigInteger(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("draft_position", sa.Integer(), nullable=False),
        sa.Column("exported_team_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["captain_auth_user_id"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["captain_workspace_member_id"], ["workspace_member.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["exported_team_id"], ["tournament.team.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["session_id"], ["balancer.draft_session.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "draft_position", name="uq_draft_team_session_position"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_draft_team_captain_auth_user_id"),
        "draft_team",
        ["captain_auth_user_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_draft_team_captain_workspace_member_id"),
        "draft_team",
        ["captain_workspace_member_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_draft_team_exported_team_id"),
        "draft_team",
        ["exported_team_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_draft_team_session_id"), "draft_team", ["session_id"], unique=False, schema="balancer"
    )
    op.create_table(
        "registration_google_sheet_binding",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("feed_id", sa.BigInteger(), nullable=False),
        sa.Column("registration_id", sa.BigInteger(), nullable=False),
        sa.Column("source_record_key", sa.String(length=255), nullable=False),
        sa.Column("raw_row_json", sa.JSON(), nullable=True),
        sa.Column("parsed_fields_json", sa.JSON(), nullable=True),
        sa.Column("row_hash", sa.String(length=128), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["feed_id"], ["balancer.registration_google_sheet_feed.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["registration_id"], ["balancer.registration.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("feed_id", "source_record_key", name="uq_balancer_registration_google_sheet_binding_key"),
        sa.UniqueConstraint("registration_id", name="uq_balancer_registration_google_sheet_binding_registration"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_registration_google_sheet_binding_feed_id"),
        "registration_google_sheet_binding",
        ["feed_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_registration_google_sheet_binding_registration_id"),
        "registration_google_sheet_binding",
        ["registration_id"],
        unique=False,
        schema="balancer",
    )
    op.create_table(
        "registration_role",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("registration_id", sa.BigInteger(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("subrole", sa.String(length=128), nullable=True),
        sa.Column("is_primary", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("priority", sa.Integer(), server_default="0", nullable=False),
        sa.Column("rank_value", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.ForeignKeyConstraint(["registration_id"], ["balancer.registration.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("registration_id", "role", name="uq_balancer_registration_role"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_registration_role_registration_id"),
        "registration_role",
        ["registration_id"],
        unique=False,
        schema="balancer",
    )
    op.create_table(
        "team",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("balance_id", sa.BigInteger(), nullable=False),
        sa.Column("variant_id", sa.BigInteger(), nullable=True),
        sa.Column("exported_team_id", sa.BigInteger(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("balancer_name", sa.String(length=255), nullable=False),
        sa.Column("captain_battle_tag", sa.String(length=255), nullable=True),
        sa.Column("avg_sr", sa.Float(), nullable=False),
        sa.Column("total_sr", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["balance_id"], ["balancer.balance.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["exported_team_id"], ["tournament.team.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["variant_id"], ["balancer.balance_variant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="balancer",
    )
    op.create_index(op.f("ix_balancer_team_balance_id"), "team", ["balance_id"], unique=False, schema="balancer")
    op.create_index(
        op.f("ix_balancer_team_exported_team_id"), "team", ["exported_team_id"], unique=False, schema="balancer"
    )
    op.create_index(op.f("ix_balancer_team_variant_id"), "team", ["variant_id"], unique=False, schema="balancer")
    op.create_table(
        "battle_tag_state",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("social_account_id", sa.BigInteger(), nullable=False),
        sa.Column("battle_tag", sa.String(length=255), nullable=False),
        sa.Column("player_id_slug", sa.String(length=255), nullable=False),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_snapshot_id", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="pending", nullable=False),
        sa.Column("consecutive_failures", sa.Integer(), server_default="0", nullable=False),
        sa.Column("next_eligible_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("priority_tier", sa.SmallInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["last_snapshot_id"], ["overwatch_rank.rank_snapshot.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["social_account_id"], ["players.social_account.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("social_account_id"),
        schema="overwatch_rank",
    )
    op.create_index(
        "ix_battle_tag_state_due",
        "battle_tag_state",
        ["status", "next_eligible_at", "last_checked_at"],
        unique=False,
        schema="overwatch_rank",
    )
    op.create_index(
        "ix_battle_tag_state_priority",
        "battle_tag_state",
        ["priority_tier", "last_checked_at"],
        unique=False,
        schema="overwatch_rank",
    )
    op.create_table(
        "challonge_source",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("stage_id", sa.BigInteger(), nullable=True),
        sa.Column("stage_item_id", sa.BigInteger(), nullable=True),
        sa.Column("challonge_tournament_id", sa.Integer(), nullable=False),
        sa.Column("slug", sa.String(), nullable=True),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(["stage_id"], ["tournament.stage.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["stage_item_id"], ["tournament.stage_item.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tournament_id", "challonge_tournament_id", name="uq_challonge_source_tournament_challonge"
        ),
        schema="tournament",
    )
    op.create_index("ix_challonge_source_stage", "challonge_source", ["stage_id"], unique=False, schema="tournament")
    op.create_index(
        "ix_challonge_source_stage_item", "challonge_source", ["stage_item_id"], unique=False, schema="tournament"
    )
    op.create_index(
        "ix_challonge_source_tournament", "challonge_source", ["tournament_id"], unique=False, schema="tournament"
    )
    op.create_table(
        "computation_job",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("operation", sa.String(length=48), nullable=False),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("stage_id", sa.BigInteger(), nullable=True),
        sa.Column("stage_item_id", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("payload_json", sa.JSON(), server_default=sa.text("'{}'::json"), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("requested_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["stage_id"], ["tournament.stage.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stage_item_id"], ["tournament.stage_item.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_computation_job_requested_by_user_id"),
        "computation_job",
        ["requested_by_user_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_computation_job_stage_id"),
        "computation_job",
        ["stage_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_computation_job_stage_item_id"),
        "computation_job",
        ["stage_item_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        "ix_tournament_computation_job_status", "computation_job", ["status"], unique=False, schema="tournament"
    )
    op.create_index(
        op.f("ix_tournament_computation_job_tournament_id"),
        "computation_job",
        ["tournament_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        "ix_tournament_computation_job_tournament_kind",
        "computation_job",
        ["tournament_id", "kind"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        "uq_tournament_computation_job_active_key",
        "computation_job",
        ["idempotency_key"],
        unique=True,
        schema="tournament",
        postgresql_where=sa.text("status IN ('pending', 'running')"),
    )
    op.create_table(
        "encounter",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("home_team_id", sa.BigInteger(), nullable=True),
        sa.Column("away_team_id", sa.BigInteger(), nullable=True),
        sa.Column("home_score", sa.Integer(), nullable=False),
        sa.Column("away_score", sa.Integer(), nullable=False),
        sa.Column("round", sa.Integer(), nullable=False),
        sa.Column("closeness", sa.Float(), nullable=True),
        sa.Column("best_of", sa.Integer(), server_default="3", nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_map_index", sa.Integer(), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("tournament_group_id", sa.BigInteger(), nullable=True),
        sa.Column("stage_id", sa.BigInteger(), nullable=True),
        sa.Column("stage_item_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("COMPLETED", "PENDING", "OPEN", name="encounterstatus", schema="tournament"),
            nullable=False,
        ),
        sa.Column("has_logs", sa.Boolean(), nullable=False),
        sa.Column(
            "result_status",
            sa.Enum(
                "none",
                "pending_confirmation",
                "confirmed",
                "disputed",
                name="encounterresultstatus",
                schema="tournament",
            ),
            server_default="none",
            nullable=False,
        ),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["away_team_id"], ["tournament.team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["home_team_id"], ["tournament.team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stage_id"], ["tournament.stage.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["stage_item_id"], ["tournament.stage_item.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_group_id"], ["tournament.group.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(
        "ix_encounter_status_live_upcoming",
        "encounter",
        ["tournament_id", "status"],
        unique=False,
        schema="tournament",
        postgresql_where=sa.text(
            "status IN ('PENDING'::tournament.encounterstatus, 'OPEN'::tournament.encounterstatus)"
        ),
    )
    op.create_index(
        "ix_encounter_tournament_group",
        "encounter",
        ["tournament_id", "tournament_group_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        "ix_encounter_tournament_status", "encounter", ["tournament_id", "status"], unique=False, schema="tournament"
    )
    op.create_index(
        op.f("ix_tournament_encounter_away_team_id"), "encounter", ["away_team_id"], unique=False, schema="tournament"
    )
    op.create_index(
        op.f("ix_tournament_encounter_home_team_id"), "encounter", ["home_team_id"], unique=False, schema="tournament"
    )
    op.create_index(op.f("ix_tournament_encounter_round"), "encounter", ["round"], unique=False, schema="tournament")
    op.create_index(
        op.f("ix_tournament_encounter_stage_id"), "encounter", ["stage_id"], unique=False, schema="tournament"
    )
    op.create_index(
        op.f("ix_tournament_encounter_stage_item_id"), "encounter", ["stage_item_id"], unique=False, schema="tournament"
    )
    op.create_index(
        op.f("ix_tournament_encounter_tournament_group_id"),
        "encounter",
        ["tournament_group_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_tournament_id"), "encounter", ["tournament_id"], unique=False, schema="tournament"
    )
    op.create_table(
        "map_veto_config_map",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("map_veto_config_id", sa.BigInteger(), nullable=False),
        sa.Column("map_id", sa.BigInteger(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["map_id"], ["overwatch.map.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["map_veto_config_id"], ["tournament.map_veto_config.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("map_veto_config_id", "map_id", name="uq_map_veto_config_map_config_map"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_map_veto_config_map_map_id"),
        "map_veto_config_map",
        ["map_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_map_veto_config_map_map_veto_config_id"),
        "map_veto_config_map",
        ["map_veto_config_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "map_veto_config_slot",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("map_veto_config_id", sa.BigInteger(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("reserve_map_id", sa.BigInteger(), nullable=True),
        sa.CheckConstraint("position >= 1", name="ck_map_veto_config_slot_position_positive"),
        sa.ForeignKeyConstraint(["map_veto_config_id"], ["tournament.map_veto_config.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reserve_map_id"], ["overwatch.map.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("map_veto_config_id", "position", name="uq_map_veto_config_slot_position"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_map_veto_config_slot_map_veto_config_id"),
        "map_veto_config_slot",
        ["map_veto_config_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_map_veto_config_slot_reserve_map_id"),
        "map_veto_config_slot",
        ["reserve_map_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "pick_ban_config_item",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pick_ban_config_id", sa.BigInteger(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["pick_ban_config_id"], ["tournament.pick_ban_config.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pick_ban_config_id", "item_id", name="uq_pick_ban_config_item"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_pick_ban_config_item_item_id"),
        "pick_ban_config_item",
        ["item_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_pick_ban_config_item_pick_ban_config_id"),
        "pick_ban_config_item",
        ["pick_ban_config_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "pick_ban_config_slot",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pick_ban_config_id", sa.BigInteger(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("reserve_item_id", sa.Integer(), nullable=True),
        sa.CheckConstraint("position >= 1", name="ck_pick_ban_config_slot_position_positive"),
        sa.ForeignKeyConstraint(["pick_ban_config_id"], ["tournament.pick_ban_config.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pick_ban_config_id", "position", name="uq_pick_ban_config_slot_position"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_pick_ban_config_slot_pick_ban_config_id"),
        "pick_ban_config_slot",
        ["pick_ban_config_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "stage_item_input",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stage_item_id", sa.BigInteger(), nullable=False),
        sa.Column("slot", sa.Integer(), nullable=False),
        sa.Column(
            "input_type",
            sa.Enum("final", "tentative", "empty", name="stageiteminputtype", schema="tournament"),
            nullable=False,
        ),
        sa.Column("team_id", sa.BigInteger(), nullable=True),
        sa.Column("source_stage_item_id", sa.BigInteger(), nullable=True),
        sa.Column("source_position", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["source_stage_item_id"], ["tournament.stage_item.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["stage_item_id"], ["tournament.stage_item.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["team_id"], ["tournament.team.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_stage_item_input_stage_item_id"),
        "stage_item_input",
        ["stage_item_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_stage_item_input_team_id"),
        "stage_item_input",
        ["team_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "standing",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=True),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("stage_id", sa.Integer(), nullable=True),
        sa.Column("stage_item_id", sa.Integer(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("overall_position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("matches", sa.Integer(), nullable=False),
        sa.Column("win", sa.Integer(), nullable=False),
        sa.Column("draw", sa.Integer(), nullable=False),
        sa.Column("lose", sa.Integer(), nullable=False),
        sa.Column("points", sa.Float(), nullable=False),
        sa.Column("buchholz", sa.Float(), nullable=True),
        sa.Column("tb", sa.Integer(), nullable=True),
        sa.Column("score_differential", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["group_id"], ["tournament.group.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stage_id"], ["tournament.stage.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["stage_item_id"], ["tournament.stage_item.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["team_id"], ["tournament.team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(
        "ix_standing_stage_stage_item_team",
        "standing",
        ["stage_id", "stage_item_id", "team_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        "ix_standing_tournament_position",
        "standing",
        ["tournament_id", "overall_position"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_standing_group_id"), "standing", ["group_id"], unique=False, schema="tournament"
    )
    op.create_index(
        op.f("ix_tournament_standing_stage_id"), "standing", ["stage_id"], unique=False, schema="tournament"
    )
    op.create_index(
        op.f("ix_tournament_standing_stage_item_id"), "standing", ["stage_item_id"], unique=False, schema="tournament"
    )
    op.create_index(op.f("ix_tournament_standing_team_id"), "standing", ["team_id"], unique=False, schema="tournament")
    op.create_index(
        op.f("ix_tournament_standing_tournament_id"), "standing", ["tournament_id"], unique=False, schema="tournament"
    )
    op.create_table(
        "balance_player_snapshot",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("balance_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("team_id", sa.BigInteger(), nullable=True),
        sa.Column("assigned_role", sa.String(length=16), nullable=False),
        sa.Column("preferred_role", sa.String(length=16), nullable=True),
        sa.Column("assigned_rank", sa.Integer(), nullable=False),
        sa.Column("discomfort", sa.Integer(), server_default="0", nullable=False),
        sa.Column("division_number", sa.Integer(), nullable=True),
        sa.Column("is_captain", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("was_off_role", sa.Boolean(), server_default="false", nullable=False),
        sa.ForeignKeyConstraint(["balance_snapshot_id"], ["analytics.balance_snapshot.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["team_id"], ["tournament.team.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["players.user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_balance_player_snapshot_balance_snapshot_id"),
        "balance_player_snapshot",
        ["balance_snapshot_id"],
        unique=False,
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_balance_player_snapshot_tournament_id"),
        "balance_player_snapshot",
        ["tournament_id"],
        unique=False,
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_balance_player_snapshot_user_id"),
        "balance_player_snapshot",
        ["user_id"],
        unique=False,
        schema="analytics",
    )
    op.create_index(
        "ix_balance_player_snapshot_team_id", "balance_player_snapshot", ["team_id"], unique=False, schema="analytics"
    )
    op.create_table(
        "match_quality",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("algorithm_id", sa.BigInteger(), nullable=False),
        sa.Column("competitiveness", sa.Float(), nullable=False),
        sa.Column("predictability", sa.Float(), nullable=False),
        sa.Column("skill_balance", sa.Float(), nullable=False),
        sa.Column("quality_score", sa.Float(), nullable=False),
        sa.Column("anomaly_flags", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["algorithm_id"], ["analytics.algorithms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("encounter_id", "algorithm_id", name="uq_analytics_match_quality"),
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_match_quality_algorithm_id"),
        "match_quality",
        ["algorithm_id"],
        unique=False,
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_match_quality_encounter_id"),
        "match_quality",
        ["encounter_id"],
        unique=False,
        schema="analytics",
    )
    op.create_table(
        "player_anomaly",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("player_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("confidence", sa.Float(), server_default="0", nullable=False),
        sa.Column("reasons", sa.JSON(), nullable=False),
        sa.Column("evidence", sa.JSON(), nullable=True),
        sa.Column("source_encounter_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["player_id"], ["tournament.player.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tournament_id", "player_id", "kind", "source_encounter_id", name="uq_analytics_player_anomaly"
        ),
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_player_anomaly_kind"), "player_anomaly", ["kind"], unique=False, schema="analytics"
    )
    op.create_index(
        op.f("ix_analytics_player_anomaly_player_id"), "player_anomaly", ["player_id"], unique=False, schema="analytics"
    )
    op.create_index(
        op.f("ix_analytics_player_anomaly_source_encounter_id"),
        "player_anomaly",
        ["source_encounter_id"],
        unique=False,
        schema="analytics",
    )
    op.create_index(
        op.f("ix_analytics_player_anomaly_tournament_id"),
        "player_anomaly",
        ["tournament_id"],
        unique=False,
        schema="analytics",
    )
    op.create_table(
        "draft_player",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("session_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_member_id", sa.BigInteger(), nullable=True),
        sa.Column("battle_tag", sa.String(length=255), nullable=True),
        sa.Column("primary_role", sa.String(length=16), nullable=False),
        sa.Column("sub_role", sa.String(length=128), nullable=True),
        sa.Column("is_flex", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("division_number", sa.Integer(), nullable=True),
        sa.Column("rank_value", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="available", nullable=False),
        sa.Column("is_captain", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("drafted_by_team_id", sa.BigInteger(), nullable=True),
        sa.Column("additional_info", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("version", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["drafted_by_team_id"], ["balancer.draft_team.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["session_id"], ["balancer.draft_session.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_member_id"], ["workspace_member.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "workspace_member_id", name="uq_draft_player_session_member"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_draft_player_drafted_by_team_id"),
        "draft_player",
        ["drafted_by_team_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_draft_player_workspace_member_id"),
        "draft_player",
        ["workspace_member_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        "ix_draft_player_session_status", "draft_player", ["session_id", "status"], unique=False, schema="balancer"
    )
    op.create_table(
        "registration_role_hero",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("role_id", sa.BigInteger(), nullable=False),
        sa.Column("hero_id", sa.BigInteger(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["hero_id"], ["overwatch.hero.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["balancer.registration_role.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("role_id", "hero_id", name="uq_reg_role_hero_role_hero"),
        sa.UniqueConstraint("role_id", "priority", name="uq_reg_role_hero_role_priority"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_registration_role_hero_role_id"),
        "registration_role_hero",
        ["role_id"],
        unique=False,
        schema="balancer",
    )
    op.create_table(
        "team_slot",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("team_id", sa.BigInteger(), nullable=False),
        sa.Column("battle_tag_normalized", sa.String(length=255), nullable=True),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("assigned_rank", sa.Integer(), nullable=False),
        sa.Column("discomfort", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_captain", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["team_id"], ["balancer.team.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_team_slot_battle_tag_normalized"),
        "team_slot",
        ["battle_tag_normalized"],
        unique=False,
        schema="balancer",
    )
    op.create_index(op.f("ix_balancer_team_slot_team_id"), "team_slot", ["team_id"], unique=False, schema="balancer")
    op.create_table(
        "record",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("filename", sa.String(length=500), nullable=False),
        sa.Column(
            "status", sa.Enum("pending", "processing", "done", "failed", name="log_processing_status"), nullable=False
        ),
        sa.Column("source", sa.Enum("upload", "discord", "manual", name="log_processing_source"), nullable=False),
        sa.Column("uploader_id", sa.BigInteger(), nullable=True),
        sa.Column("attached_encounter_id", sa.BigInteger(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["attached_encounter_id"], ["tournament.encounter.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploader_id"], ["players.user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema="log_processing",
    )
    op.create_index(
        op.f("ix_log_processing_record_attached_encounter_id"),
        "record",
        ["attached_encounter_id"],
        unique=False,
        schema="log_processing",
    )
    op.create_index(
        op.f("ix_log_processing_record_content_hash"), "record", ["content_hash"], unique=False, schema="log_processing"
    )
    op.create_index(
        "ix_log_processing_record_status_created",
        "record",
        ["status", "created_at"],
        unique=False,
        schema="log_processing",
    )
    op.create_index(
        op.f("ix_log_processing_record_tournament_id"),
        "record",
        ["tournament_id"],
        unique=False,
        schema="log_processing",
    )
    op.create_index(
        "ix_log_processing_record_uploader_id", "record", ["uploader_id"], unique=False, schema="log_processing"
    )
    op.create_table(
        "challonge_match_mapping",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_id", sa.BigInteger(), nullable=False),
        sa.Column("challonge_match_id", sa.Integer(), nullable=False),
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_id"], ["tournament.challonge_source.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_id", "challonge_match_id", name="uq_challonge_match_mapping_source_match"),
        sa.UniqueConstraint("source_id", "encounter_id", name="uq_challonge_match_mapping_source_encounter"),
        schema="tournament",
    )
    op.create_index(
        "ix_challonge_match_mapping_encounter",
        "challonge_match_mapping",
        ["encounter_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        "ix_challonge_match_mapping_source", "challonge_match_mapping", ["source_id"], unique=False, schema="tournament"
    )
    op.create_table(
        "challonge_participant_mapping",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_id", sa.BigInteger(), nullable=False),
        sa.Column("challonge_participant_id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["source_id"], ["tournament.challonge_source.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["team_id"], ["tournament.team.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_id", "challonge_participant_id", name="uq_challonge_participant_mapping_source_participant"
        ),
        schema="tournament",
    )
    op.create_index(
        "ix_challonge_participant_mapping_source",
        "challonge_participant_mapping",
        ["source_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        "ix_challonge_participant_mapping_team",
        "challonge_participant_mapping",
        ["team_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "challonge_sync_log",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("source_id", sa.BigInteger(), nullable=True),
        sa.Column("direction", sa.String(length=10), nullable=False),
        sa.Column("operation", sa.String(length=32), nullable=True),
        sa.Column("entity_type", sa.String(length=32), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("challonge_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("conflict_type", sa.String(length=32), nullable=True),
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.Column("before_json", sa.JSON(), nullable=True),
        sa.Column("after_json", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["source_id"], ["tournament.challonge_source.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(
        "ix_challonge_sync_log_tournament_created",
        "challonge_sync_log",
        ["tournament_id", sa.literal_column("created_at DESC")],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_challonge_sync_log_source_id"),
        "challonge_sync_log",
        ["source_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_challonge_sync_log_tournament_id"),
        "challonge_sync_log",
        ["tournament_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "encounter_captain_report",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("team_id", sa.BigInteger(), nullable=False),
        sa.Column("reporter_user_id", sa.BigInteger(), nullable=True),
        sa.Column("home_score", sa.Integer(), nullable=False),
        sa.Column("away_score", sa.Integer(), nullable=False),
        sa.Column("closeness", sa.Integer(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("custom_fields_json", sa.JSON(), server_default="{}", nullable=False),
        sa.CheckConstraint("closeness BETWEEN 1 AND 10", name="ck_encounter_captain_report_closeness"),
        sa.CheckConstraint("home_score >= 0 AND away_score >= 0", name="ck_encounter_captain_report_scores"),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reporter_user_id"], ["players.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["team_id"], ["tournament.team.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("encounter_id", "team_id", name="uq_encounter_captain_report_encounter_team"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_captain_report_encounter_id"),
        "encounter_captain_report",
        ["encounter_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_captain_report_team_id"),
        "encounter_captain_report",
        ["team_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "encounter_link",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_encounter_id", sa.Integer(), nullable=False),
        sa.Column("target_encounter_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.Enum("winner", "loser", name="encounterlinkrole", schema="tournament"), nullable=False),
        sa.Column(
            "target_slot", sa.Enum("home", "away", name="encounterlinkslot", schema="tournament"), nullable=False
        ),
        sa.ForeignKeyConstraint(["source_encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_encounter_id", "role", name="uq_encounter_link_source_role"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_link_source_encounter_id"),
        "encounter_link",
        ["source_encounter_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_link_target_encounter_id"),
        "encounter_link",
        ["target_encounter_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "encounter_map_pool",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("map_id", sa.BigInteger(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("action_index", sa.Integer(), nullable=True),
        sa.Column("slot", sa.Integer(), nullable=True),
        sa.Column(
            "picked_by",
            sa.Enum("home", "away", "decider", "admin", name="mappickside", schema="tournament"),
            nullable=True,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "available", "picked", "banned", "played", "protected", name="mappoolentrystatus", schema="tournament"
            ),
            server_default="available",
            nullable=False,
        ),
        sa.Column("team_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["map_id"], ["overwatch.map.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["team_id"], ["tournament.team.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_map_pool_encounter_id"),
        "encounter_map_pool",
        ["encounter_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_map_pool_map_id"),
        "encounter_map_pool",
        ["map_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_map_pool_team_id"),
        "encounter_map_pool",
        ["team_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "encounter_map_report",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("map_id", sa.BigInteger(), nullable=False),
        sa.Column("map_index", sa.Integer(), server_default="0", nullable=False),
        sa.Column("team_id", sa.BigInteger(), nullable=False),
        sa.Column("reporter_user_id", sa.BigInteger(), nullable=True),
        sa.Column("home_score", sa.Integer(), nullable=False),
        sa.Column("away_score", sa.Integer(), nullable=False),
        sa.CheckConstraint("home_score >= 0 AND away_score >= 0", name="ck_encounter_map_report_scores"),
        sa.CheckConstraint("map_index >= 0", name="ck_encounter_map_report_index"),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["map_id"], ["overwatch.map.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reporter_user_id"], ["players.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["team_id"], ["tournament.team.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "encounter_id", "map_id", "map_index", "team_id", name="uq_encounter_map_report_encounter_map_index_team"
        ),
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
    op.create_table(
        "encounter_pick_ban_ledger",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.Enum("map", "hero", name="pickbankind", schema="tournament"), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column(
            "banned_by_side",
            sa.Enum("home", "away", "decider", "admin", name="pickbanside", schema="tournament"),
            nullable=False,
        ),
        sa.Column("round", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "encounter_id", "kind", "item_id", "banned_by_side", name="uq_encounter_pick_ban_ledger_entry"
        ),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_pick_ban_ledger_encounter_id"),
        "encounter_pick_ban_ledger",
        ["encounter_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_pick_ban_ledger_item_id"),
        "encounter_pick_ban_ledger",
        ["item_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "encounter_readiness",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("side", sa.String(length=16), nullable=False),
        sa.Column("ready_user_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ready_user_id"], ["players.user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("encounter_id", "side", name="uq_encounter_readiness_encounter_side"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_readiness_encounter_id"),
        "encounter_readiness",
        ["encounter_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "encounter_result_audit",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "action",
            sa.Enum(
                "confirm",
                "reopen",
                "auto_confirm",
                "auto_dispute",
                "import",
                "cascade_reset",
                name="encounterresultauditaction",
                schema="tournament",
            ),
            nullable=False,
        ),
        sa.Column(
            "from_result_status",
            sa.Enum(
                "none",
                "pending_confirmation",
                "confirmed",
                "disputed",
                name="encounterresultstatus",
                schema="tournament",
            ),
            nullable=True,
        ),
        sa.Column(
            "to_result_status",
            sa.Enum(
                "none",
                "pending_confirmation",
                "confirmed",
                "disputed",
                name="encounterresultstatus",
                schema="tournament",
            ),
            nullable=False,
        ),
        sa.Column("home_score_before", sa.Integer(), nullable=True),
        sa.Column("away_score_before", sa.Integer(), nullable=True),
        sa.Column("home_score_after", sa.Integer(), nullable=False),
        sa.Column("away_score_after", sa.Integer(), nullable=False),
        sa.Column("adopted_team_id", sa.BigInteger(), nullable=True),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["players.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["adopted_team_id"], ["tournament.team.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(
        "ix_encounter_result_audit_encounter_created",
        "encounter_result_audit",
        ["encounter_id", "created_at"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "encounter_veto_session",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("config_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "first_side",
            sa.Enum("home", "away", "decider", "admin", name="mappickside", schema="tournament"),
            nullable=False,
        ),
        sa.Column(
            "seed_source",
            sa.Enum("bracket_slot", "standings", "fallback_home", "admin", name="vetoseedsource", schema="tournament"),
            nullable=False,
        ),
        sa.Column("home_seed", sa.Integer(), nullable=True),
        sa.Column("away_seed", sa.Integer(), nullable=True),
        sa.Column("resolved_sequence_json", sa.JSON(), nullable=False),
        sa.Column("slot_reserves_json", sa.JSON(), nullable=True),
        sa.Column("turn_timer_seconds", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("active", "completed", "cancelled", name="mapvetosessionstatus", schema="tournament"),
            server_default="active",
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_step_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("first_side IN ('home', 'away')", name="ck_encounter_veto_session_first_side"),
        sa.ForeignKeyConstraint(["config_id"], ["tournament.map_veto_config.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("encounter_id", name="uq_encounter_veto_session_encounter"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_veto_session_encounter_id"),
        "encounter_veto_session",
        ["encounter_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "map_veto_config_slot_map",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("map_veto_config_slot_id", sa.BigInteger(), nullable=False),
        sa.Column("map_id", sa.BigInteger(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["map_id"], ["overwatch.map.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["map_veto_config_slot_id"], ["tournament.map_veto_config_slot.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("map_veto_config_slot_id", "map_id", name="uq_map_veto_config_slot_map"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_map_veto_config_slot_map_map_id"),
        "map_veto_config_slot_map",
        ["map_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_map_veto_config_slot_map_map_veto_config_slot_id"),
        "map_veto_config_slot_map",
        ["map_veto_config_slot_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "pick_ban_config_slot_item",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pick_ban_config_slot_id", sa.BigInteger(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["pick_ban_config_slot_id"], ["tournament.pick_ban_config_slot.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pick_ban_config_slot_id", "item_id", name="uq_pick_ban_config_slot_item"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_pick_ban_config_slot_item_item_id"),
        "pick_ban_config_slot_item",
        ["item_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_pick_ban_config_slot_item_pick_ban_config_slot_id"),
        "pick_ban_config_slot_item",
        ["pick_ban_config_slot_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "pick_ban_session",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.Enum("map", "hero", name="pickbankind", schema="tournament"), nullable=False),
        sa.Column("config_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "first_side",
            sa.Enum("home", "away", "decider", "admin", name="pickbanside", schema="tournament"),
            nullable=True,
        ),
        sa.Column(
            "seed_source",
            sa.Enum(
                "bracket_slot", "standings", "fallback_home", "admin", name="pickbanseedsource", schema="tournament"
            ),
            nullable=False,
        ),
        sa.Column("home_seed", sa.Integer(), nullable=True),
        sa.Column("away_seed", sa.Integer(), nullable=True),
        sa.Column("resolved_sequence_json", sa.JSON(), nullable=False),
        sa.Column("slot_reserves_json", sa.JSON(), nullable=True),
        sa.Column("turn_timer_seconds", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("active", "completed", "cancelled", name="pickbansessionstatus", schema="tournament"),
            server_default="active",
            nullable=False,
        ),
        sa.Column("awaiting_choice", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "pending_loser_side",
            sa.Enum("home", "away", "decider", "admin", name="pickbanside", schema="tournament"),
            nullable=True,
        ),
        sa.Column(
            "undo_requested_by",
            sa.Enum("home", "away", "decider", "admin", name="pickbanside", schema="tournament"),
            nullable=True,
        ),
        sa.Column("undo_target_index", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_step_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "first_side IS NULL OR first_side IN ('home', 'away')", name="ck_pick_ban_session_first_side"
        ),
        sa.ForeignKeyConstraint(["config_id"], ["tournament.pick_ban_config.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("encounter_id", "kind", name="uq_pick_ban_session_encounter_kind"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_pick_ban_session_encounter_id"),
        "pick_ban_session",
        ["encounter_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "scrim_room",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("token", sa.String(length=32), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("stage_id", sa.BigInteger(), nullable=False),
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("created_by_auth_user_id", sa.BigInteger(), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_auth_user_id"], ["auth.user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stage_id"], ["tournament.stage.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("encounter_id", name="uq_scrim_room_encounter"),
        sa.UniqueConstraint("token", name="uq_scrim_room_token"),
        schema="tournament",
    )
    op.create_index(
        "ix_scrim_room_open_by_creator",
        "scrim_room",
        ["created_by_auth_user_id"],
        unique=False,
        schema="tournament",
        postgresql_where=sa.text("closed_at IS NULL"),
    )
    op.create_index(
        op.f("ix_tournament_scrim_room_created_by_auth_user_id"),
        "scrim_room",
        ["created_by_auth_user_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_scrim_room_encounter_id"), "scrim_room", ["encounter_id"], unique=False, schema="tournament"
    )
    op.create_index(
        op.f("ix_tournament_scrim_room_stage_id"), "scrim_room", ["stage_id"], unique=False, schema="tournament"
    )
    op.create_index(
        op.f("ix_tournament_scrim_room_tournament_id"),
        "scrim_room",
        ["tournament_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_scrim_room_workspace_id"), "scrim_room", ["workspace_id"], unique=False, schema="tournament"
    )
    op.create_table(
        "draft_pick",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("session_id", sa.BigInteger(), nullable=False),
        sa.Column("overall_no", sa.Integer(), nullable=False),
        sa.Column("round_no", sa.Integer(), nullable=False),
        sa.Column("pick_in_round", sa.Integer(), nullable=False),
        sa.Column("draft_team_id", sa.BigInteger(), nullable=False),
        sa.Column("target_role", sa.String(length=16), nullable=True),
        sa.Column("target_rank_value", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="upcoming", nullable=False),
        sa.Column("picked_player_id", sa.BigInteger(), nullable=True),
        sa.Column("picked_by_workspace_member_id", sa.BigInteger(), nullable=True),
        sa.Column("is_autopick", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("is_admin_override", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("clock_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("clock_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("clock_remaining_ms", sa.Integer(), nullable=True),
        sa.Column("version", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["draft_team_id"], ["balancer.draft_team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["picked_by_workspace_member_id"], ["workspace_member.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["picked_player_id"], ["balancer.draft_player.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["session_id"], ["balancer.draft_session.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "overall_no", name="uq_draft_pick_session_overall"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_draft_pick_draft_team_id"), "draft_pick", ["draft_team_id"], unique=False, schema="balancer"
    )
    op.create_index(
        op.f("ix_balancer_draft_pick_picked_player_id"),
        "draft_pick",
        ["picked_player_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        "ix_draft_pick_session_status", "draft_pick", ["session_id", "status"], unique=False, schema="balancer"
    )
    op.create_table(
        "draft_player_role",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("draft_player_id", sa.BigInteger(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("rank_value", sa.Integer(), nullable=True),
        sa.Column("is_secondary", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("priority", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["draft_player_id"], ["balancer.draft_player.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("draft_player_id", "role", name="uq_draft_player_role"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_draft_player_role_draft_player_id"),
        "draft_player_role",
        ["draft_player_id"],
        unique=False,
        schema="balancer",
    )
    op.create_table(
        "match",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("home_team_id", sa.BigInteger(), nullable=False),
        sa.Column("away_team_id", sa.BigInteger(), nullable=False),
        sa.Column("home_score", sa.Integer(), nullable=False),
        sa.Column("away_score", sa.Integer(), nullable=False),
        sa.Column("time", sa.Float(), nullable=True),
        sa.Column("log_name", sa.String(), nullable=True),
        sa.Column("code", sa.String(), nullable=True),
        sa.Column("log_record_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "source",
            sa.Enum("log_parser", "captain_report", name="matchsource", schema="matches"),
            server_default="log_parser",
            nullable=False,
        ),
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("map_id", sa.BigInteger(), nullable=False),
        sa.Column("map_index", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["away_team_id"], ["tournament.team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["home_team_id"], ["tournament.team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["log_record_id"], ["log_processing.record.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["map_id"], ["overwatch.map.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="matches",
    )
    op.create_index(op.f("ix_matches_match_away_team_id"), "match", ["away_team_id"], unique=False, schema="matches")
    op.create_index(op.f("ix_matches_match_encounter_id"), "match", ["encounter_id"], unique=False, schema="matches")
    op.create_index(op.f("ix_matches_match_home_team_id"), "match", ["home_team_id"], unique=False, schema="matches")
    op.create_index(op.f("ix_matches_match_log_record_id"), "match", ["log_record_id"], unique=False, schema="matches")
    op.create_index(op.f("ix_matches_match_map_id"), "match", ["map_id"], unique=False, schema="matches")
    op.create_table(
        "catalog_alias_miss",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("entity_type", sa.Enum("hero", "map", "gamemode", name="catalogentitytype"), nullable=False),
        sa.Column("raw_name", sa.String(length=128), nullable=False),
        sa.Column("occurrences", sa.Integer(), server_default="1", nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_log_record_id", sa.BigInteger(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["last_log_record_id"], ["log_processing.record.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("entity_type", "raw_name", name="uq_catalog_alias_miss_entity_raw"),
        schema="overwatch",
    )
    op.create_table(
        "encounter_map_code",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("report_id", sa.BigInteger(), nullable=False),
        sa.Column("map_index", sa.Integer(), nullable=False),
        sa.Column("map_id", sa.BigInteger(), nullable=True),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.CheckConstraint("map_index >= 1", name="ck_encounter_map_code_index"),
        sa.ForeignKeyConstraint(["map_id"], ["overwatch.map.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["report_id"], ["tournament.encounter_captain_report.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("report_id", "map_index", name="uq_encounter_map_code_report_index"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_map_code_map_id"),
        "encounter_map_code",
        ["map_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_encounter_map_code_report_id"),
        "encounter_map_code",
        ["report_id"],
        unique=False,
        schema="tournament",
    )
    op.create_table(
        "pick_ban_entry",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("session_id", sa.BigInteger(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("action_index", sa.Integer(), nullable=True),
        sa.Column("round", sa.Integer(), nullable=True),
        sa.Column(
            "picked_by",
            sa.Enum("home", "away", "decider", "admin", name="pickbanside", schema="tournament"),
            nullable=True,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "available", "picked", "banned", "played", "protected", name="pickbanentrystatus", schema="tournament"
            ),
            server_default="available",
            nullable=False,
        ),
        sa.Column("team_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "protected_by",
            sa.Enum("home", "away", "decider", "admin", name="pickbanside", schema="tournament"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["session_id"], ["tournament.pick_ban_session.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["team_id"], ["tournament.team.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_pick_ban_entry_item_id"), "pick_ban_entry", ["item_id"], unique=False, schema="tournament"
    )
    op.create_index(
        op.f("ix_tournament_pick_ban_entry_session_id"),
        "pick_ban_entry",
        ["session_id"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_pick_ban_entry_team_id"), "pick_ban_entry", ["team_id"], unique=False, schema="tournament"
    )
    op.create_table(
        "evaluation_result",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("achievement_rule_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_member_id", sa.BigInteger(), nullable=False),
        sa.Column("tournament_id", sa.BigInteger(), nullable=True),
        sa.Column("match_id", sa.BigInteger(), nullable=True),
        sa.Column("qualified_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("evidence_json", sa.JSON(), nullable=True),
        sa.Column("rule_version", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["achievement_rule_id"], ["achievements.rule.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["match_id"], ["matches.match.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["achievements.evaluation_run.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_member_id"], ["workspace_member.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "achievement_rule_id",
            "workspace_member_id",
            "tournament_id",
            "match_id",
            name="uq_eval_result_rule_user_tournament_match",
        ),
        schema="achievements",
    )
    op.create_index(
        op.f("ix_achievements_evaluation_result_achievement_rule_id"),
        "evaluation_result",
        ["achievement_rule_id"],
        unique=False,
        schema="achievements",
    )
    op.create_index(
        "ix_achievements_evaluation_result_match_id",
        "evaluation_result",
        ["match_id"],
        unique=False,
        schema="achievements",
        postgresql_where=sa.text("match_id IS NOT NULL"),
    )
    op.create_index(
        op.f("ix_achievements_evaluation_result_run_id"),
        "evaluation_result",
        ["run_id"],
        unique=False,
        schema="achievements",
    )
    op.create_index(
        op.f("ix_achievements_evaluation_result_tournament_id"),
        "evaluation_result",
        ["tournament_id"],
        unique=False,
        schema="achievements",
    )
    op.create_index(
        op.f("ix_achievements_evaluation_result_workspace_member_id"),
        "evaluation_result",
        ["workspace_member_id"],
        unique=False,
        schema="achievements",
    )
    op.create_table(
        "override",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("achievement_rule_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_member_id", sa.BigInteger(), nullable=False),
        sa.Column("tournament_id", sa.BigInteger(), nullable=True),
        sa.Column("match_id", sa.BigInteger(), nullable=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("granted_by", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["achievement_rule_id"], ["achievements.rule.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["granted_by"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["match_id"], ["matches.match.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_member_id"], ["workspace_member.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="achievements",
    )
    op.create_index(
        op.f("ix_achievements_override_achievement_rule_id"),
        "override",
        ["achievement_rule_id"],
        unique=False,
        schema="achievements",
    )
    op.create_index("ix_achievements_override_match_id", "override", ["match_id"], unique=False, schema="achievements")
    op.create_index(
        "ix_achievements_override_tournament_id", "override", ["tournament_id"], unique=False, schema="achievements"
    )
    op.create_index(
        op.f("ix_achievements_override_workspace_member_id"),
        "override",
        ["workspace_member_id"],
        unique=False,
        schema="achievements",
    )
    op.create_table(
        "draft_player_role_hero",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("draft_player_role_id", sa.BigInteger(), nullable=False),
        sa.Column("hero_id", sa.BigInteger(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["draft_player_role_id"], ["balancer.draft_player_role.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["hero_id"], ["overwatch.hero.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("draft_player_role_id", "hero_id", name="uq_draft_player_role_hero_hero"),
        sa.UniqueConstraint("draft_player_role_id", "priority", name="uq_draft_player_role_hero_priority"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_draft_player_role_hero_draft_player_role_id"),
        "draft_player_role_hero",
        ["draft_player_role_id"],
        unique=False,
        schema="balancer",
    )
    op.create_table(
        "assists",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("match_id", sa.BigInteger(), nullable=False),
        sa.Column("time", sa.Float(), nullable=False),
        sa.Column("round", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("hero_id", sa.BigInteger(), nullable=True),
        sa.Column("related_team_id", sa.BigInteger(), nullable=True),
        sa.Column("related_user_id", sa.BigInteger(), nullable=True),
        sa.Column("related_hero_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "name",
            sa.Enum(
                "OffensiveAssist",
                "DefensiveAssist",
                "UltimateCharged",
                "UltimateStart",
                "UltimateEnd",
                "HeroSwap",
                "MercyRez",
                "EchoDuplicateStart",
                "EchoDuplicateEnd",
                name="matchevent",
            ),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["hero_id"], ["overwatch.hero.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["match_id"], ["matches.match.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["related_hero_id"], ["overwatch.hero.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["related_team_id"], ["tournament.team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["related_user_id"], ["players.user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["team_id"], ["tournament.team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["players.user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="matches",
    )
    op.create_index("ix_matches_assists_hero_id", "assists", ["hero_id"], unique=False, schema="matches")
    op.create_index(op.f("ix_matches_assists_match_id"), "assists", ["match_id"], unique=False, schema="matches")
    op.create_index(
        "ix_matches_assists_related_hero_id", "assists", ["related_hero_id"], unique=False, schema="matches"
    )
    op.create_index(
        "ix_matches_assists_related_team_id", "assists", ["related_team_id"], unique=False, schema="matches"
    )
    op.create_index(
        "ix_matches_assists_related_user_id", "assists", ["related_user_id"], unique=False, schema="matches"
    )
    op.create_index(op.f("ix_matches_assists_team_id"), "assists", ["team_id"], unique=False, schema="matches")
    op.create_index(op.f("ix_matches_assists_user_id"), "assists", ["user_id"], unique=False, schema="matches")
    op.create_table(
        "kill_feed",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("match_id", sa.BigInteger(), nullable=False),
        sa.Column("time", sa.Float(), nullable=False),
        sa.Column("round", sa.Integer(), nullable=False),
        sa.Column("fight", sa.Integer(), nullable=False),
        sa.Column(
            "ability",
            sa.Enum(
                "PrimaryFire",
                "SecondaryFire",
                "Ability1",
                "Ability2",
                "Ultimate",
                "Melee",
                "Crouch",
                name="abilityevent",
            ),
            nullable=True,
        ),
        sa.Column("killer_id", sa.BigInteger(), nullable=False),
        sa.Column("killer_hero_id", sa.BigInteger(), nullable=False),
        sa.Column("killer_team_id", sa.BigInteger(), nullable=False),
        sa.Column("victim_id", sa.BigInteger(), nullable=False),
        sa.Column("victim_team_id", sa.BigInteger(), nullable=False),
        sa.Column("victim_hero_id", sa.BigInteger(), nullable=False),
        sa.Column("damage", sa.Float(), nullable=False),
        sa.Column("is_critical_hit", sa.Boolean(), nullable=False),
        sa.Column("is_environmental", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["killer_hero_id"], ["overwatch.hero.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["killer_id"], ["players.user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["killer_team_id"], ["tournament.team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["match_id"], ["matches.match.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["victim_hero_id"], ["overwatch.hero.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["victim_id"], ["players.user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["victim_team_id"], ["tournament.team.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="matches",
    )
    op.create_index(
        "ix_matches_kill_feed_killer_hero_id", "kill_feed", ["killer_hero_id"], unique=False, schema="matches"
    )
    op.create_index(op.f("ix_matches_kill_feed_killer_id"), "kill_feed", ["killer_id"], unique=False, schema="matches")
    op.create_index(
        "ix_matches_kill_feed_killer_team_id", "kill_feed", ["killer_team_id"], unique=False, schema="matches"
    )
    op.create_index(op.f("ix_matches_kill_feed_match_id"), "kill_feed", ["match_id"], unique=False, schema="matches")
    op.create_index(
        "ix_matches_kill_feed_victim_hero_id", "kill_feed", ["victim_hero_id"], unique=False, schema="matches"
    )
    op.create_index(op.f("ix_matches_kill_feed_victim_id"), "kill_feed", ["victim_id"], unique=False, schema="matches")
    op.create_index(
        "ix_matches_kill_feed_victim_team_id", "kill_feed", ["victim_team_id"], unique=False, schema="matches"
    )
    op.create_table(
        "statistics",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("match_id", sa.BigInteger(), nullable=False),
        sa.Column("round", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("hero_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "name",
            sa.Enum(
                "Eliminations",
                "FinalBlows",
                "Deaths",
                "AllDamageDealt",
                "BarrierDamageDealt",
                "HeroDamageDealt",
                "HealingDealt",
                "HealingReceived",
                "SelfHealing",
                "DamageTaken",
                "DamageBlocked",
                "DefensiveAssists",
                "OffensiveAssists",
                "UltimatesEarned",
                "UltimatesUsed",
                "MultikillBest",
                "Multikills",
                "SoloKills",
                "ObjectiveKills",
                "EnvironmentalKills",
                "EnvironmentalDeaths",
                "CriticalHits",
                "CriticalHitAccuracy",
                "ScopedAccuracy",
                "ScopedCriticalHitAccuracy",
                "ScopedCriticalHitKills",
                "ShotsFired",
                "ShotsHit",
                "ShotsMissed",
                "ScopedShotsFired",
                "ScopedShotsHit",
                "WeaponAccuracy",
                "HeroTimePlayed",
                "FirstPicks",
                "FirstDeaths",
                "UltimateKills",
                "SupportKills",
                "Performance",
                "PerformancePoints",
                "KD",
                "KDA",
                "DamageDelta",
                "FBE",
                "DamageFB",
                "Assists",
                "ImpactPoints",
                "ImpactRank",
                "OverperformanceScore",
                name="logstatsname",
            ),
            nullable=False,
        ),
        sa.Column("value", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["hero_id"], ["overwatch.hero.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["match_id"], ["matches.match.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["team_id"], ["tournament.team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["players.user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="matches",
    )
    op.create_index(
        "ix_match_statistics_match_name_round",
        "statistics",
        ["match_id", "name", "round"],
        unique=False,
        schema="matches",
    )
    op.create_index(
        "ix_match_statistics_match_user_round",
        "statistics",
        ["match_id", "user_id", "round"],
        unique=False,
        schema="matches",
    )
    op.create_index(
        "ix_match_statistics_playtime_r0",
        "statistics",
        ["match_id", "user_id", "hero_id"],
        unique=False,
        schema="matches",
        postgresql_where=sa.text("round = 0 AND name = 'HeroTimePlayed'"),
    )
    op.create_index(
        "ix_match_statistics_user_hero_r0",
        "statistics",
        ["user_id", "hero_id", "name"],
        unique=False,
        schema="matches",
        postgresql_where=sa.text("round = 0 AND hero_id IS NOT NULL"),
    )
    op.create_index(
        "ix_match_statistics_user_name_r0",
        "statistics",
        ["user_id", "name"],
        unique=False,
        schema="matches",
        postgresql_where=sa.text("round = 0 AND hero_id IS NULL"),
    )
    op.create_index(
        "ix_match_statistics_user_round_name",
        "statistics",
        ["user_id", "round", "name"],
        unique=False,
        schema="matches",
    )
    op.create_index(op.f("ix_matches_statistics_match_id"), "statistics", ["match_id"], unique=False, schema="matches")
    op.create_index(op.f("ix_matches_statistics_name"), "statistics", ["name"], unique=False, schema="matches")
    op.create_index(op.f("ix_matches_statistics_team_id"), "statistics", ["team_id"], unique=False, schema="matches")
    op.create_index(op.f("ix_matches_statistics_user_id"), "statistics", ["user_id"], unique=False, schema="matches")
    # ### end Alembic commands ###
    # Objects no model describes, carried over from the v5 chain: invariant CHECKs,
    # coalesced/partial unique indexes, an expression index, and the FK/perf indexes
    # added by the index-hygiene revisions. Dropping them here would silently
    # deoptimise (or unguard) a fresh database.
    for statement in HANDWRITTEN_OBJECTS:
        op.execute(statement)
    op.execute(HERO_GLOBAL_STATS_MATVIEW)
    op.execute("CREATE UNIQUE INDEX ix_mv_hero_global_stats_name_hero ON matches.mv_hero_global_stats (name, hero_id)")


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.execute("DROP MATERIALIZED VIEW IF EXISTS matches.mv_hero_global_stats")
    # These FKs stand between the drop order below and their tables (the two
    # cycle-breakers plus the undeclared draft one); every other hand-written
    # object dies with the table it hangs on.
    op.execute("ALTER TABLE balancer.draft_session DROP CONSTRAINT IF EXISTS fk_draft_session_current_pick")
    op.execute("ALTER TABLE division_grid DROP CONSTRAINT IF EXISTS division_grid_workspace_id_fkey")
    op.execute("ALTER TABLE division_grid DROP CONSTRAINT IF EXISTS fk_division_grid_source_workspace")
    op.drop_index(op.f("ix_matches_statistics_user_id"), table_name="statistics", schema="matches")
    op.drop_index(op.f("ix_matches_statistics_team_id"), table_name="statistics", schema="matches")
    op.drop_index(op.f("ix_matches_statistics_name"), table_name="statistics", schema="matches")
    op.drop_index(op.f("ix_matches_statistics_match_id"), table_name="statistics", schema="matches")
    op.drop_index("ix_match_statistics_user_round_name", table_name="statistics", schema="matches")
    op.drop_index(
        "ix_match_statistics_user_name_r0",
        table_name="statistics",
        schema="matches",
        postgresql_where=sa.text("round = 0 AND hero_id IS NULL"),
    )
    op.drop_index(
        "ix_match_statistics_user_hero_r0",
        table_name="statistics",
        schema="matches",
        postgresql_where=sa.text("round = 0 AND hero_id IS NOT NULL"),
    )
    op.drop_index(
        "ix_match_statistics_playtime_r0",
        table_name="statistics",
        schema="matches",
        postgresql_where=sa.text("round = 0 AND name = 'HeroTimePlayed'"),
    )
    op.drop_index("ix_match_statistics_match_user_round", table_name="statistics", schema="matches")
    op.drop_index("ix_match_statistics_match_name_round", table_name="statistics", schema="matches")
    op.drop_table("statistics", schema="matches")
    op.drop_index("ix_matches_kill_feed_victim_team_id", table_name="kill_feed", schema="matches")
    op.drop_index(op.f("ix_matches_kill_feed_victim_id"), table_name="kill_feed", schema="matches")
    op.drop_index("ix_matches_kill_feed_victim_hero_id", table_name="kill_feed", schema="matches")
    op.drop_index(op.f("ix_matches_kill_feed_match_id"), table_name="kill_feed", schema="matches")
    op.drop_index("ix_matches_kill_feed_killer_team_id", table_name="kill_feed", schema="matches")
    op.drop_index(op.f("ix_matches_kill_feed_killer_id"), table_name="kill_feed", schema="matches")
    op.drop_index("ix_matches_kill_feed_killer_hero_id", table_name="kill_feed", schema="matches")
    op.drop_table("kill_feed", schema="matches")
    op.drop_index(op.f("ix_matches_assists_user_id"), table_name="assists", schema="matches")
    op.drop_index(op.f("ix_matches_assists_team_id"), table_name="assists", schema="matches")
    op.drop_index("ix_matches_assists_related_user_id", table_name="assists", schema="matches")
    op.drop_index("ix_matches_assists_related_team_id", table_name="assists", schema="matches")
    op.drop_index("ix_matches_assists_related_hero_id", table_name="assists", schema="matches")
    op.drop_index(op.f("ix_matches_assists_match_id"), table_name="assists", schema="matches")
    op.drop_index("ix_matches_assists_hero_id", table_name="assists", schema="matches")
    op.drop_table("assists", schema="matches")
    op.drop_index(
        op.f("ix_balancer_draft_player_role_hero_draft_player_role_id"),
        table_name="draft_player_role_hero",
        schema="balancer",
    )
    op.drop_table("draft_player_role_hero", schema="balancer")
    op.drop_index(op.f("ix_achievements_override_workspace_member_id"), table_name="override", schema="achievements")
    op.drop_index("ix_achievements_override_tournament_id", table_name="override", schema="achievements")
    op.drop_index("ix_achievements_override_match_id", table_name="override", schema="achievements")
    op.drop_index(op.f("ix_achievements_override_achievement_rule_id"), table_name="override", schema="achievements")
    op.drop_table("override", schema="achievements")
    op.drop_index(
        op.f("ix_achievements_evaluation_result_workspace_member_id"),
        table_name="evaluation_result",
        schema="achievements",
    )
    op.drop_index(
        op.f("ix_achievements_evaluation_result_tournament_id"), table_name="evaluation_result", schema="achievements"
    )
    op.drop_index(
        op.f("ix_achievements_evaluation_result_run_id"), table_name="evaluation_result", schema="achievements"
    )
    op.drop_index(
        "ix_achievements_evaluation_result_match_id",
        table_name="evaluation_result",
        schema="achievements",
        postgresql_where=sa.text("match_id IS NOT NULL"),
    )
    op.drop_index(
        op.f("ix_achievements_evaluation_result_achievement_rule_id"),
        table_name="evaluation_result",
        schema="achievements",
    )
    op.drop_table("evaluation_result", schema="achievements")
    op.drop_index(op.f("ix_tournament_pick_ban_entry_team_id"), table_name="pick_ban_entry", schema="tournament")
    op.drop_index(op.f("ix_tournament_pick_ban_entry_session_id"), table_name="pick_ban_entry", schema="tournament")
    op.drop_index(op.f("ix_tournament_pick_ban_entry_item_id"), table_name="pick_ban_entry", schema="tournament")
    op.drop_table("pick_ban_entry", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_encounter_map_code_report_id"), table_name="encounter_map_code", schema="tournament"
    )
    op.drop_index(op.f("ix_tournament_encounter_map_code_map_id"), table_name="encounter_map_code", schema="tournament")
    op.drop_table("encounter_map_code", schema="tournament")
    op.drop_table("catalog_alias_miss", schema="overwatch")
    op.drop_index(op.f("ix_matches_match_map_id"), table_name="match", schema="matches")
    op.drop_index(op.f("ix_matches_match_log_record_id"), table_name="match", schema="matches")
    op.drop_index(op.f("ix_matches_match_home_team_id"), table_name="match", schema="matches")
    op.drop_index(op.f("ix_matches_match_encounter_id"), table_name="match", schema="matches")
    op.drop_index(op.f("ix_matches_match_away_team_id"), table_name="match", schema="matches")
    op.drop_table("match", schema="matches")
    op.drop_index(
        op.f("ix_balancer_draft_player_role_draft_player_id"), table_name="draft_player_role", schema="balancer"
    )
    op.drop_table("draft_player_role", schema="balancer")
    op.drop_index("ix_draft_pick_session_status", table_name="draft_pick", schema="balancer")
    op.drop_index(op.f("ix_balancer_draft_pick_picked_player_id"), table_name="draft_pick", schema="balancer")
    op.drop_index(op.f("ix_balancer_draft_pick_draft_team_id"), table_name="draft_pick", schema="balancer")
    op.drop_table("draft_pick", schema="balancer")
    op.drop_index(op.f("ix_tournament_scrim_room_workspace_id"), table_name="scrim_room", schema="tournament")
    op.drop_index(op.f("ix_tournament_scrim_room_tournament_id"), table_name="scrim_room", schema="tournament")
    op.drop_index(op.f("ix_tournament_scrim_room_stage_id"), table_name="scrim_room", schema="tournament")
    op.drop_index(op.f("ix_tournament_scrim_room_encounter_id"), table_name="scrim_room", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_scrim_room_created_by_auth_user_id"), table_name="scrim_room", schema="tournament"
    )
    op.drop_index(
        "ix_scrim_room_open_by_creator",
        table_name="scrim_room",
        schema="tournament",
        postgresql_where=sa.text("closed_at IS NULL"),
    )
    op.drop_table("scrim_room", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_pick_ban_session_encounter_id"), table_name="pick_ban_session", schema="tournament"
    )
    op.drop_table("pick_ban_session", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_pick_ban_config_slot_item_pick_ban_config_slot_id"),
        table_name="pick_ban_config_slot_item",
        schema="tournament",
    )
    op.drop_index(
        op.f("ix_tournament_pick_ban_config_slot_item_item_id"),
        table_name="pick_ban_config_slot_item",
        schema="tournament",
    )
    op.drop_table("pick_ban_config_slot_item", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_map_veto_config_slot_map_map_veto_config_slot_id"),
        table_name="map_veto_config_slot_map",
        schema="tournament",
    )
    op.drop_index(
        op.f("ix_tournament_map_veto_config_slot_map_map_id"),
        table_name="map_veto_config_slot_map",
        schema="tournament",
    )
    op.drop_table("map_veto_config_slot_map", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_encounter_veto_session_encounter_id"),
        table_name="encounter_veto_session",
        schema="tournament",
    )
    op.drop_table("encounter_veto_session", schema="tournament")
    op.drop_index(
        "ix_encounter_result_audit_encounter_created", table_name="encounter_result_audit", schema="tournament"
    )
    op.drop_table("encounter_result_audit", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_encounter_readiness_encounter_id"), table_name="encounter_readiness", schema="tournament"
    )
    op.drop_table("encounter_readiness", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_encounter_pick_ban_ledger_item_id"),
        table_name="encounter_pick_ban_ledger",
        schema="tournament",
    )
    op.drop_index(
        op.f("ix_tournament_encounter_pick_ban_ledger_encounter_id"),
        table_name="encounter_pick_ban_ledger",
        schema="tournament",
    )
    op.drop_table("encounter_pick_ban_ledger", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_encounter_map_report_team_id"), table_name="encounter_map_report", schema="tournament"
    )
    op.drop_index(
        op.f("ix_tournament_encounter_map_report_map_id"), table_name="encounter_map_report", schema="tournament"
    )
    op.drop_index(
        op.f("ix_tournament_encounter_map_report_encounter_id"), table_name="encounter_map_report", schema="tournament"
    )
    op.drop_table("encounter_map_report", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_encounter_map_pool_team_id"), table_name="encounter_map_pool", schema="tournament"
    )
    op.drop_index(op.f("ix_tournament_encounter_map_pool_map_id"), table_name="encounter_map_pool", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_encounter_map_pool_encounter_id"), table_name="encounter_map_pool", schema="tournament"
    )
    op.drop_table("encounter_map_pool", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_encounter_link_target_encounter_id"), table_name="encounter_link", schema="tournament"
    )
    op.drop_index(
        op.f("ix_tournament_encounter_link_source_encounter_id"), table_name="encounter_link", schema="tournament"
    )
    op.drop_table("encounter_link", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_encounter_captain_report_team_id"),
        table_name="encounter_captain_report",
        schema="tournament",
    )
    op.drop_index(
        op.f("ix_tournament_encounter_captain_report_encounter_id"),
        table_name="encounter_captain_report",
        schema="tournament",
    )
    op.drop_table("encounter_captain_report", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_challonge_sync_log_tournament_id"), table_name="challonge_sync_log", schema="tournament"
    )
    op.drop_index(
        op.f("ix_tournament_challonge_sync_log_source_id"), table_name="challonge_sync_log", schema="tournament"
    )
    op.drop_index("ix_challonge_sync_log_tournament_created", table_name="challonge_sync_log", schema="tournament")
    op.drop_table("challonge_sync_log", schema="tournament")
    op.drop_index(
        "ix_challonge_participant_mapping_team", table_name="challonge_participant_mapping", schema="tournament"
    )
    op.drop_index(
        "ix_challonge_participant_mapping_source", table_name="challonge_participant_mapping", schema="tournament"
    )
    op.drop_table("challonge_participant_mapping", schema="tournament")
    op.drop_index("ix_challonge_match_mapping_source", table_name="challonge_match_mapping", schema="tournament")
    op.drop_index("ix_challonge_match_mapping_encounter", table_name="challonge_match_mapping", schema="tournament")
    op.drop_table("challonge_match_mapping", schema="tournament")
    op.drop_index("ix_log_processing_record_uploader_id", table_name="record", schema="log_processing")
    op.drop_index(op.f("ix_log_processing_record_tournament_id"), table_name="record", schema="log_processing")
    op.drop_index("ix_log_processing_record_status_created", table_name="record", schema="log_processing")
    op.drop_index(op.f("ix_log_processing_record_content_hash"), table_name="record", schema="log_processing")
    op.drop_index(op.f("ix_log_processing_record_attached_encounter_id"), table_name="record", schema="log_processing")
    op.drop_table("record", schema="log_processing")
    op.drop_index(op.f("ix_balancer_team_slot_team_id"), table_name="team_slot", schema="balancer")
    op.drop_index(op.f("ix_balancer_team_slot_battle_tag_normalized"), table_name="team_slot", schema="balancer")
    op.drop_table("team_slot", schema="balancer")
    op.drop_index(
        op.f("ix_balancer_registration_role_hero_role_id"), table_name="registration_role_hero", schema="balancer"
    )
    op.drop_table("registration_role_hero", schema="balancer")
    op.drop_index("ix_draft_player_session_status", table_name="draft_player", schema="balancer")
    op.drop_index(op.f("ix_balancer_draft_player_workspace_member_id"), table_name="draft_player", schema="balancer")
    op.drop_index(op.f("ix_balancer_draft_player_drafted_by_team_id"), table_name="draft_player", schema="balancer")
    op.drop_table("draft_player", schema="balancer")
    op.drop_index(op.f("ix_analytics_player_anomaly_tournament_id"), table_name="player_anomaly", schema="analytics")
    op.drop_index(
        op.f("ix_analytics_player_anomaly_source_encounter_id"), table_name="player_anomaly", schema="analytics"
    )
    op.drop_index(op.f("ix_analytics_player_anomaly_player_id"), table_name="player_anomaly", schema="analytics")
    op.drop_index(op.f("ix_analytics_player_anomaly_kind"), table_name="player_anomaly", schema="analytics")
    op.drop_table("player_anomaly", schema="analytics")
    op.drop_index(op.f("ix_analytics_match_quality_encounter_id"), table_name="match_quality", schema="analytics")
    op.drop_index(op.f("ix_analytics_match_quality_algorithm_id"), table_name="match_quality", schema="analytics")
    op.drop_table("match_quality", schema="analytics")
    op.drop_index("ix_balance_player_snapshot_team_id", table_name="balance_player_snapshot", schema="analytics")
    op.drop_index(
        op.f("ix_analytics_balance_player_snapshot_user_id"), table_name="balance_player_snapshot", schema="analytics"
    )
    op.drop_index(
        op.f("ix_analytics_balance_player_snapshot_tournament_id"),
        table_name="balance_player_snapshot",
        schema="analytics",
    )
    op.drop_index(
        op.f("ix_analytics_balance_player_snapshot_balance_snapshot_id"),
        table_name="balance_player_snapshot",
        schema="analytics",
    )
    op.drop_table("balance_player_snapshot", schema="analytics")
    op.drop_index(op.f("ix_tournament_standing_tournament_id"), table_name="standing", schema="tournament")
    op.drop_index(op.f("ix_tournament_standing_team_id"), table_name="standing", schema="tournament")
    op.drop_index(op.f("ix_tournament_standing_stage_item_id"), table_name="standing", schema="tournament")
    op.drop_index(op.f("ix_tournament_standing_stage_id"), table_name="standing", schema="tournament")
    op.drop_index(op.f("ix_tournament_standing_group_id"), table_name="standing", schema="tournament")
    op.drop_index("ix_standing_tournament_position", table_name="standing", schema="tournament")
    op.drop_index("ix_standing_stage_stage_item_team", table_name="standing", schema="tournament")
    op.drop_table("standing", schema="tournament")
    op.drop_index(op.f("ix_tournament_stage_item_input_team_id"), table_name="stage_item_input", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_stage_item_input_stage_item_id"), table_name="stage_item_input", schema="tournament"
    )
    op.drop_table("stage_item_input", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_pick_ban_config_slot_pick_ban_config_id"),
        table_name="pick_ban_config_slot",
        schema="tournament",
    )
    op.drop_table("pick_ban_config_slot", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_pick_ban_config_item_pick_ban_config_id"),
        table_name="pick_ban_config_item",
        schema="tournament",
    )
    op.drop_index(
        op.f("ix_tournament_pick_ban_config_item_item_id"), table_name="pick_ban_config_item", schema="tournament"
    )
    op.drop_table("pick_ban_config_item", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_map_veto_config_slot_reserve_map_id"),
        table_name="map_veto_config_slot",
        schema="tournament",
    )
    op.drop_index(
        op.f("ix_tournament_map_veto_config_slot_map_veto_config_id"),
        table_name="map_veto_config_slot",
        schema="tournament",
    )
    op.drop_table("map_veto_config_slot", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_map_veto_config_map_map_veto_config_id"),
        table_name="map_veto_config_map",
        schema="tournament",
    )
    op.drop_index(
        op.f("ix_tournament_map_veto_config_map_map_id"), table_name="map_veto_config_map", schema="tournament"
    )
    op.drop_table("map_veto_config_map", schema="tournament")
    op.drop_index(op.f("ix_tournament_encounter_tournament_id"), table_name="encounter", schema="tournament")
    op.drop_index(op.f("ix_tournament_encounter_tournament_group_id"), table_name="encounter", schema="tournament")
    op.drop_index(op.f("ix_tournament_encounter_stage_item_id"), table_name="encounter", schema="tournament")
    op.drop_index(op.f("ix_tournament_encounter_stage_id"), table_name="encounter", schema="tournament")
    op.drop_index(op.f("ix_tournament_encounter_round"), table_name="encounter", schema="tournament")
    op.drop_index(op.f("ix_tournament_encounter_home_team_id"), table_name="encounter", schema="tournament")
    op.drop_index(op.f("ix_tournament_encounter_away_team_id"), table_name="encounter", schema="tournament")
    op.drop_index("ix_encounter_tournament_status", table_name="encounter", schema="tournament")
    op.drop_index("ix_encounter_tournament_group", table_name="encounter", schema="tournament")
    op.drop_index(
        "ix_encounter_status_live_upcoming",
        table_name="encounter",
        schema="tournament",
        postgresql_where=sa.text(
            "status IN ('PENDING'::tournament.encounterstatus, 'OPEN'::tournament.encounterstatus)"
        ),
    )
    op.drop_table("encounter", schema="tournament")
    op.drop_index(
        "uq_tournament_computation_job_active_key",
        table_name="computation_job",
        schema="tournament",
        postgresql_where=sa.text("status IN ('pending', 'running')"),
    )
    op.drop_index("ix_tournament_computation_job_tournament_kind", table_name="computation_job", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_computation_job_tournament_id"), table_name="computation_job", schema="tournament"
    )
    op.drop_index("ix_tournament_computation_job_status", table_name="computation_job", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_computation_job_stage_item_id"), table_name="computation_job", schema="tournament"
    )
    op.drop_index(op.f("ix_tournament_computation_job_stage_id"), table_name="computation_job", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_computation_job_requested_by_user_id"), table_name="computation_job", schema="tournament"
    )
    op.drop_table("computation_job", schema="tournament")
    op.drop_index("ix_challonge_source_tournament", table_name="challonge_source", schema="tournament")
    op.drop_index("ix_challonge_source_stage_item", table_name="challonge_source", schema="tournament")
    op.drop_index("ix_challonge_source_stage", table_name="challonge_source", schema="tournament")
    op.drop_table("challonge_source", schema="tournament")
    op.drop_index("ix_battle_tag_state_priority", table_name="battle_tag_state", schema="overwatch_rank")
    op.drop_index("ix_battle_tag_state_due", table_name="battle_tag_state", schema="overwatch_rank")
    op.drop_table("battle_tag_state", schema="overwatch_rank")
    op.drop_index(op.f("ix_balancer_team_variant_id"), table_name="team", schema="balancer")
    op.drop_index(op.f("ix_balancer_team_exported_team_id"), table_name="team", schema="balancer")
    op.drop_index(op.f("ix_balancer_team_balance_id"), table_name="team", schema="balancer")
    op.drop_table("team", schema="balancer")
    op.drop_index(
        op.f("ix_balancer_registration_role_registration_id"), table_name="registration_role", schema="balancer"
    )
    op.drop_table("registration_role", schema="balancer")
    op.drop_index(
        op.f("ix_balancer_registration_google_sheet_binding_registration_id"),
        table_name="registration_google_sheet_binding",
        schema="balancer",
    )
    op.drop_index(
        op.f("ix_balancer_registration_google_sheet_binding_feed_id"),
        table_name="registration_google_sheet_binding",
        schema="balancer",
    )
    op.drop_table("registration_google_sheet_binding", schema="balancer")
    op.drop_index(op.f("ix_balancer_draft_team_session_id"), table_name="draft_team", schema="balancer")
    op.drop_index(op.f("ix_balancer_draft_team_exported_team_id"), table_name="draft_team", schema="balancer")
    op.drop_index(
        op.f("ix_balancer_draft_team_captain_workspace_member_id"), table_name="draft_team", schema="balancer"
    )
    op.drop_index(op.f("ix_balancer_draft_team_captain_auth_user_id"), table_name="draft_team", schema="balancer")
    op.drop_table("draft_team", schema="balancer")
    op.drop_index("ix_draft_audit_session_created", table_name="draft_audit_event", schema="balancer")
    op.drop_index(
        op.f("ix_balancer_draft_audit_event_actor_auth_user_id"), table_name="draft_audit_event", schema="balancer"
    )
    op.drop_table("draft_audit_event", schema="balancer")
    op.drop_index(op.f("ix_analytics_tournament_tournament_id"), table_name="tournament", schema="analytics")
    op.drop_index(op.f("ix_analytics_tournament_player_id"), table_name="tournament", schema="analytics")
    op.drop_table("tournament", schema="analytics")
    op.drop_index(op.f("ix_analytics_shifts_tournament_id"), table_name="shifts", schema="analytics")
    op.drop_index(op.f("ix_analytics_shifts_player_id"), table_name="shifts", schema="analytics")
    op.drop_index(op.f("ix_analytics_shifts_algorithm_id"), table_name="shifts", schema="analytics")
    op.drop_table("shifts", schema="analytics")
    op.drop_index(op.f("ix_analytics_performance_tournament_id"), table_name="performance", schema="analytics")
    op.drop_index(op.f("ix_analytics_performance_player_id"), table_name="performance", schema="analytics")
    op.drop_index(op.f("ix_analytics_performance_algorithm_id"), table_name="performance", schema="analytics")
    op.drop_table("performance", schema="analytics")
    op.drop_index(
        op.f("ix_analytics_balance_snapshot_tournament_id"), table_name="balance_snapshot", schema="analytics"
    )
    op.drop_index(op.f("ix_analytics_balance_snapshot_balance_id"), table_name="balance_snapshot", schema="analytics")
    op.drop_table("balance_snapshot", schema="analytics")
    op.drop_index(
        op.f("ix_analytics_anomaly_feedback_tournament_id"), table_name="anomaly_feedback", schema="analytics"
    )
    op.drop_index(
        op.f("ix_analytics_anomaly_feedback_reviewer_user_id"), table_name="anomaly_feedback", schema="analytics"
    )
    op.drop_index(op.f("ix_analytics_anomaly_feedback_player_id"), table_name="anomaly_feedback", schema="analytics")
    op.drop_index(op.f("ix_analytics_anomaly_feedback_kind"), table_name="anomaly_feedback", schema="analytics")
    op.drop_table("anomaly_feedback", schema="analytics")
    op.drop_index(op.f("ix_tournament_stage_item_stage_id"), table_name="stage_item", schema="tournament")
    op.drop_table("stage_item", schema="tournament")
    op.drop_index(op.f("ix_tournament_player_tournament_id"), table_name="player", schema="tournament")
    op.drop_index("ix_player_workspace_member_tournament", table_name="player", schema="tournament")
    op.drop_index("ix_player_tournament_role_sub_role", table_name="player", schema="tournament")
    op.drop_index("ix_player_team_workspace_member", table_name="player", schema="tournament")
    op.drop_index("ix_player_related_player_id", table_name="player", schema="tournament")
    op.drop_index(
        "ix_player_member_not_sub",
        table_name="player",
        schema="tournament",
        postgresql_where=sa.text("is_substitution = false"),
    )
    op.drop_table("player", schema="tournament")
    op.drop_index(
        "uq_pick_ban_config_level",
        table_name="pick_ban_config",
        schema="tournament",
        postgresql_nulls_not_distinct=True,
    )
    op.drop_index(
        op.f("ix_tournament_pick_ban_config_tournament_id"), table_name="pick_ban_config", schema="tournament"
    )
    op.drop_table("pick_ban_config", schema="tournament")
    op.drop_index(
        "uq_map_veto_config_level",
        table_name="map_veto_config",
        schema="tournament",
        postgresql_nulls_not_distinct=True,
    )
    op.drop_index(
        op.f("ix_tournament_map_veto_config_tournament_id"), table_name="map_veto_config", schema="tournament"
    )
    op.drop_table("map_veto_config", schema="tournament")
    op.drop_index(op.f("ix_tournament_group_tournament_id"), table_name="group", schema="tournament")
    op.drop_table("group", schema="tournament")
    op.drop_index(
        "uq_social_visibility_workspace",
        table_name="social_account_visibility",
        schema="players",
        postgresql_where=sa.text("workspace_id IS NOT NULL"),
    )
    op.drop_index(
        "uq_social_visibility_global",
        table_name="social_account_visibility",
        schema="players",
        postgresql_where=sa.text("workspace_id IS NULL"),
    )
    op.drop_index("ix_social_account_visibility_workspace_id", table_name="social_account_visibility", schema="players")
    op.drop_index("ix_social_account_visibility_account_id", table_name="social_account_visibility", schema="players")
    op.drop_table("social_account_visibility", schema="players")
    op.drop_index("ix_rank_snapshot_user_captured", table_name="rank_snapshot", schema="overwatch_rank")
    op.drop_index("ix_rank_snapshot_series_captured", table_name="rank_snapshot", schema="overwatch_rank")
    op.drop_index(
        op.f("ix_overwatch_rank_rank_snapshot_captured_at"), table_name="rank_snapshot", schema="overwatch_rank"
    )
    op.drop_table("rank_snapshot", schema="overwatch_rank")
    op.drop_index("ix_fetch_log_status_created", table_name="fetch_log", schema="overwatch_rank")
    op.drop_index("ix_fetch_log_created_at", table_name="fetch_log", schema="overwatch_rank")
    op.drop_table("fetch_log", schema="overwatch_rank")
    op.drop_index(
        "uq_balancer_registration_user",
        table_name="registration",
        schema="balancer",
        postgresql_where="deleted_at IS NULL",
    )
    op.drop_index(
        "uq_balancer_registration_tournament_tag_active",
        table_name="registration",
        schema="balancer",
        postgresql_where="battle_tag_normalized IS NOT NULL AND deleted_at IS NULL",
    )
    op.drop_index(op.f("ix_balancer_registration_workspace_member_id"), table_name="registration", schema="balancer")
    op.drop_index(op.f("ix_balancer_registration_tournament_id"), table_name="registration", schema="balancer")
    op.drop_index(
        "ix_balancer_registration_tournament_balancer_status",
        table_name="registration",
        schema="balancer",
        postgresql_where="deleted_at IS NULL",
    )
    op.drop_table("registration", schema="balancer")
    op.drop_index(
        "uq_draft_session_active_tournament",
        table_name="draft_session",
        schema="balancer",
        postgresql_where=sa.text("status IN ('setup','ready','live','paused')"),
    )
    op.drop_index("ix_draft_session_tournament_status", table_name="draft_session", schema="balancer")
    op.drop_index("ix_draft_session_status_created", table_name="draft_session", schema="balancer")
    op.drop_index(op.f("ix_balancer_draft_session_workspace_id"), table_name="draft_session", schema="balancer")
    op.drop_index(op.f("ix_balancer_draft_session_source_balance_id"), table_name="draft_session", schema="balancer")
    op.drop_table("draft_session", schema="balancer")
    op.drop_index(op.f("ix_balancer_balance_variant_balance_id"), table_name="balance_variant", schema="balancer")
    op.drop_table("balance_variant", schema="balancer")
    op.drop_index(
        op.f("ix_analytics_standings_distribution_tournament_id"),
        table_name="standings_distribution",
        schema="analytics",
    )
    op.drop_index(
        op.f("ix_analytics_standings_distribution_team_id"), table_name="standings_distribution", schema="analytics"
    )
    op.drop_index(
        op.f("ix_analytics_standings_distribution_algorithm_id"),
        table_name="standings_distribution",
        schema="analytics",
    )
    op.drop_table("standings_distribution", schema="analytics")
    op.drop_index(op.f("ix_workspace_member_workspace_id"), table_name="workspace_member")
    op.drop_index(op.f("ix_workspace_member_player_id"), table_name="workspace_member")
    op.drop_table("workspace_member")
    op.drop_index(
        op.f("ix_tournament_tournament_preview_access_tournament_id"),
        table_name="tournament_preview_access",
        schema="tournament",
    )
    op.drop_index(
        op.f("ix_tournament_tournament_preview_access_auth_user_id"),
        table_name="tournament_preview_access",
        schema="tournament",
    )
    op.drop_table("tournament_preview_access", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_tournament_phase_schedule_tournament_id"),
        table_name="tournament_phase_schedule",
        schema="tournament",
    )
    op.drop_index(
        op.f("ix_tournament_tournament_phase_schedule_starts_at"),
        table_name="tournament_phase_schedule",
        schema="tournament",
    )
    op.drop_table("tournament_phase_schedule", schema="tournament")
    op.drop_index(op.f("ix_tournament_team_tournament_id"), table_name="team", schema="tournament")
    op.drop_index(op.f("ix_tournament_team_captain_id"), table_name="team", schema="tournament")
    op.drop_table("team", schema="tournament")
    op.drop_index(op.f("ix_tournament_stage_tournament_id"), table_name="stage", schema="tournament")
    op.drop_table("stage", schema="tournament")
    op.drop_table("recalculation_state", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_encounter_report_form_tournament_id"),
        table_name="encounter_report_form",
        schema="tournament",
    )
    op.drop_table("encounter_report_form", schema="tournament")
    op.drop_index(op.f("ix_players_user_merge_audit_target_user_id"), table_name="user_merge_audit", schema="players")
    op.drop_index(op.f("ix_players_user_merge_audit_source_user_id"), table_name="user_merge_audit", schema="players")
    op.drop_index(
        op.f("ix_players_user_merge_audit_operator_auth_user_id"), table_name="user_merge_audit", schema="players"
    )
    op.drop_table("user_merge_audit", schema="players")
    op.drop_index(
        "uq_social_account_user_provider_handle_nullnorm",
        table_name="social_account",
        schema="players",
        postgresql_where=sa.text("username_normalized IS NULL"),
    )
    op.drop_index(
        "uq_social_account_provider_subject",
        table_name="social_account",
        schema="players",
        postgresql_where=sa.text("provider_user_id IS NOT NULL"),
    )
    op.drop_index("ix_social_account_username_normalized", table_name="social_account", schema="players")
    op.drop_index("ix_social_account_user_id", table_name="social_account", schema="players")
    op.drop_index("ix_social_account_provider_user_id", table_name="social_account", schema="players")
    op.drop_index("ix_social_account_provider", table_name="social_account", schema="players")
    op.drop_table("social_account", schema="players")
    op.drop_index(
        op.f("ix_log_processing_discord_channel_channel_id"), table_name="discord_channel", schema="log_processing"
    )
    op.drop_table("discord_channel", schema="log_processing")
    op.drop_index(op.f("ix_division_grid_mapping_rule_target_tier_id"), table_name="division_grid_mapping_rule")
    op.drop_index(op.f("ix_division_grid_mapping_rule_source_tier_id"), table_name="division_grid_mapping_rule")
    op.drop_index(op.f("ix_division_grid_mapping_rule_mapping_id"), table_name="division_grid_mapping_rule")
    op.drop_table("division_grid_mapping_rule")
    op.drop_index(op.f("ix_balancer_tournament_config_workspace_id"), table_name="tournament_config", schema="balancer")
    op.drop_index(
        op.f("ix_balancer_tournament_config_tournament_id"), table_name="tournament_config", schema="balancer"
    )
    op.drop_table("tournament_config", schema="balancer")
    op.drop_index(
        op.f("ix_balancer_registration_google_sheet_feed_tournament_id"),
        table_name="registration_google_sheet_feed",
        schema="balancer",
    )
    op.drop_table("registration_google_sheet_feed", schema="balancer")
    op.drop_index(op.f("ix_balancer_registration_form_workspace_id"), table_name="registration_form", schema="balancer")
    op.drop_index(
        op.f("ix_balancer_registration_form_tournament_id"), table_name="registration_form", schema="balancer"
    )
    op.drop_table("registration_form", schema="balancer")
    op.drop_index(op.f("ix_balancer_balance_workspace_id"), table_name="balance", schema="balancer")
    op.drop_index(op.f("ix_balancer_balance_tournament_id"), table_name="balance", schema="balancer")
    op.drop_table("balance", schema="balancer")
    op.drop_index("ix_user_roles_user_id", table_name="user_roles", schema="auth")
    op.drop_index("ix_user_roles_role_id", table_name="user_roles", schema="auth")
    op.drop_table("user_roles", schema="auth")
    op.drop_index("ix_role_permissions_role_id", table_name="role_permissions", schema="auth")
    op.drop_index("ix_role_permissions_permission_id", table_name="role_permissions", schema="auth")
    op.drop_table("role_permissions", schema="auth")
    op.drop_index(
        op.f("ix_analytics_ml_model_artifact_training_cutoff_tournament_id"),
        table_name="ml_model_artifact",
        schema="analytics",
    )
    op.drop_index(op.f("ix_analytics_ml_model_artifact_model_kind"), table_name="ml_model_artifact", schema="analytics")
    op.drop_index(op.f("ix_analytics_ml_model_artifact_is_active"), table_name="ml_model_artifact", schema="analytics")
    op.drop_index(
        op.f("ix_analytics_ml_model_artifact_algorithm_id"), table_name="ml_model_artifact", schema="analytics"
    )
    op.drop_table("ml_model_artifact", schema="analytics")
    op.drop_index(op.f("ix_analytics_ml_features_tournament_id"), table_name="ml_features", schema="analytics")
    op.drop_index(op.f("ix_analytics_ml_features_granularity"), table_name="ml_features", schema="analytics")
    op.drop_index(op.f("ix_analytics_ml_features_entity_id"), table_name="ml_features", schema="analytics")
    op.drop_table("ml_features", schema="analytics")
    op.drop_index(
        "uq_analytics_job_one_running_per_workspace",
        table_name="job",
        schema="analytics",
        postgresql_where=sa.text("status IN ('pending', 'running')"),
    )
    op.drop_index(op.f("ix_analytics_job_workspace_id"), table_name="job", schema="analytics")
    op.drop_index(op.f("ix_analytics_job_tournament_id"), table_name="job", schema="analytics")
    op.drop_index("ix_analytics_job_status", table_name="job", schema="analytics")
    op.drop_index(op.f("ix_analytics_job_requested_by_user_id"), table_name="job", schema="analytics")
    op.drop_table("job", schema="analytics")
    op.drop_index(op.f("ix_analytics_explanation_tournament_id"), table_name="explanation", schema="analytics")
    op.drop_index(op.f("ix_analytics_explanation_entity_kind"), table_name="explanation", schema="analytics")
    op.drop_index(op.f("ix_analytics_explanation_entity_id"), table_name="explanation", schema="analytics")
    op.drop_index(op.f("ix_analytics_explanation_algorithm_id"), table_name="explanation", schema="analytics")
    op.drop_table("explanation", schema="analytics")
    op.drop_index(
        op.f("ix_achievements_evaluation_run_workspace_id"), table_name="evaluation_run", schema="achievements"
    )
    op.drop_index(op.f("ix_achievements_evaluation_run_id"), table_name="evaluation_run", schema="achievements")
    op.drop_table("evaluation_run", schema="achievements")
    op.drop_index(op.f("ix_tournament_tournament_workspace_id"), table_name="tournament", schema="tournament")
    op.drop_index(op.f("ix_tournament_tournament_is_hidden"), table_name="tournament", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_tournament_division_grid_version_id"), table_name="tournament", schema="tournament"
    )
    op.drop_table("tournament", schema="tournament")
    op.drop_index("ix_player_sub_role_workspace_role_active", table_name="player_sub_role", schema="tournament")
    op.drop_index("ix_player_sub_role_workspace_id", table_name="player_sub_role", schema="tournament")
    op.drop_table("player_sub_role", schema="tournament")
    op.drop_index(
        op.f("ix_tournament_encounter_saved_view_workspace_id"), table_name="encounter_saved_view", schema="tournament"
    )
    op.drop_index(
        op.f("ix_tournament_encounter_saved_view_auth_user_id"), table_name="encounter_saved_view", schema="tournament"
    )
    op.drop_index("ix_encounter_saved_view_workspace_user", table_name="encounter_saved_view", schema="tournament")
    op.drop_table("encounter_saved_view", schema="tournament")
    op.drop_index(op.f("ix_subscriptions_requirement_workspace_id"), table_name="requirement", schema="subscriptions")
    op.drop_table("requirement", schema="subscriptions")
    op.drop_index(
        op.f("ix_subscriptions_provider_config_workspace_id"), table_name="provider_config", schema="subscriptions"
    )
    op.drop_table("provider_config", schema="subscriptions")
    op.drop_index(op.f("ix_subscriptions_entitlement_workspace_id"), table_name="entitlement", schema="subscriptions")
    op.drop_index(op.f("ix_subscriptions_entitlement_auth_user_id"), table_name="entitlement", schema="subscriptions")
    op.drop_index("ix_subscription_entitlement_workspace_provider", table_name="entitlement", schema="subscriptions")
    op.drop_table("entitlement", schema="subscriptions")
    op.drop_index(op.f("ix_subscriptions_check_log_workspace_id"), table_name="check_log", schema="subscriptions")
    op.drop_index("ix_subscription_check_log_user_created", table_name="check_log", schema="subscriptions")
    op.drop_index("ix_subscription_check_log_state_created", table_name="check_log", schema="subscriptions")
    op.drop_index("ix_subscription_check_log_created_at", table_name="check_log", schema="subscriptions")
    op.drop_table("check_log", schema="subscriptions")
    op.drop_index(op.f("ix_settings_key"), table_name="settings")
    op.drop_table("settings")
    op.drop_index(
        "ix_user_name_trgm",
        table_name="user",
        schema="players",
        postgresql_using="gin",
        postgresql_ops={"name": "gin_trgm_ops"},
    )
    op.drop_index(op.f("ix_players_user_auth_user_id"), table_name="user", schema="players")
    op.drop_table("user", schema="players")
    op.drop_table("map", schema="overwatch")
    op.drop_index(op.f("ix_division_grid_tier_version_id"), table_name="division_grid_tier")
    op.drop_table("division_grid_tier")
    op.drop_index(op.f("ix_division_grid_mapping_target_version_id"), table_name="division_grid_mapping")
    op.drop_index(op.f("ix_division_grid_mapping_source_version_id"), table_name="division_grid_mapping")
    op.drop_table("division_grid_mapping")
    op.drop_index(op.f("ix_division_grid_import_job_workspace_id"), table_name="division_grid_import_job")
    op.drop_index(op.f("ix_division_grid_import_job_source_workspace_id"), table_name="division_grid_import_job")
    op.drop_index(op.f("ix_division_grid_import_job_requested_by_user_id"), table_name="division_grid_import_job")
    op.drop_table("division_grid_import_job")
    op.drop_index(op.f("ix_balancer_workspace_config_workspace_id"), table_name="workspace_config", schema="balancer")
    op.drop_table("workspace_config", schema="balancer")
    op.drop_index(
        "ix_balancer_registration_status_workspace_scope", table_name="registration_status", schema="balancer"
    )
    op.drop_index(
        op.f("ix_balancer_registration_status_workspace_id"), table_name="registration_status", schema="balancer"
    )
    op.drop_table("registration_status", schema="balancer")
    op.drop_index("uq_user_permission_deny_user_perm_workspace", table_name="user_permission_deny", schema="auth")
    op.drop_index("ix_user_permission_deny_user_id", table_name="user_permission_deny", schema="auth")
    op.drop_index(op.f("ix_auth_user_permission_deny_workspace_id"), table_name="user_permission_deny", schema="auth")
    op.drop_table("user_permission_deny", schema="auth")
    op.drop_index(
        "uq_roles_name_workspace",
        table_name="roles",
        schema="auth",
        postgresql_where=sa.text("workspace_id IS NOT NULL"),
    )
    op.drop_index(
        "uq_roles_name_global", table_name="roles", schema="auth", postgresql_where=sa.text("workspace_id IS NULL")
    )
    op.drop_index(op.f("ix_auth_roles_workspace_id"), table_name="roles", schema="auth")
    op.drop_index(op.f("ix_auth_roles_name"), table_name="roles", schema="auth")
    op.drop_table("roles", schema="auth")
    op.drop_index(op.f("ix_auth_refresh_token_token"), table_name="refresh_token", schema="auth")
    op.drop_index(op.f("ix_auth_refresh_token_session_id"), table_name="refresh_token", schema="auth")
    op.drop_table("refresh_token", schema="auth")
    op.drop_index(op.f("ix_auth_oauth_connections_provider_user_id"), table_name="oauth_connections", schema="auth")
    op.drop_index(op.f("ix_auth_oauth_connections_provider"), table_name="oauth_connections", schema="auth")
    op.drop_table("oauth_connections", schema="auth")
    op.drop_index(op.f("ix_auth_api_key_workspace_id"), table_name="api_key", schema="auth")
    op.drop_index(op.f("ix_auth_api_key_public_id"), table_name="api_key", schema="auth")
    op.drop_index(op.f("ix_auth_api_key_auth_user_id"), table_name="api_key", schema="auth")
    op.drop_index("ix_api_key_public_id_active", table_name="api_key", schema="auth")
    op.drop_index("ix_api_key_owner_workspace", table_name="api_key", schema="auth")
    op.drop_table("api_key", schema="auth")
    op.drop_index(op.f("ix_achievements_rule_workspace_id"), table_name="rule", schema="achievements")
    op.drop_index(op.f("ix_achievements_rule_slug"), table_name="rule", schema="achievements")
    op.drop_table("rule", schema="achievements")
    op.drop_index(op.f("ix_workspace_subdomain"), table_name="workspace")
    op.drop_index(op.f("ix_workspace_slug"), table_name="workspace")
    op.drop_index(op.f("ix_workspace_default_division_grid_version_id"), table_name="workspace")
    op.drop_index(op.f("ix_workspace_custom_domain"), table_name="workspace")
    op.drop_table("workspace")
    op.drop_index(op.f("ix_realtime_workspace_event_workspace_id"), table_name="workspace_event", schema="realtime")
    op.drop_index(op.f("ix_realtime_workspace_event_tournament_id"), table_name="workspace_event", schema="realtime")
    op.drop_index("ix_realtime_workspace_event_topic_id", table_name="workspace_event", schema="realtime")
    op.drop_index("ix_realtime_workspace_event_occurred_at", table_name="workspace_event", schema="realtime")
    op.drop_index(op.f("ix_realtime_workspace_event_actor_user_id"), table_name="workspace_event", schema="realtime")
    op.drop_table("workspace_event", schema="realtime")
    op.drop_table("hero", schema="overwatch")
    op.drop_table("gamemode", schema="overwatch")
    op.drop_index("ix_stat_baselines_version", table_name="stat_baselines", schema="matches")
    op.drop_table("stat_baselines", schema="matches")
    op.drop_index("ix_event_outbox_status_next_attempt", table_name="event_outbox")
    op.drop_table("event_outbox")
    op.drop_index(op.f("ix_division_grid_version_grid_id"), table_name="division_grid_version")
    op.drop_index(op.f("ix_division_grid_version_created_from_version_id"), table_name="division_grid_version")
    op.drop_table("division_grid_version")
    op.drop_index(op.f("ix_division_grid_workspace_id"), table_name="division_grid")
    op.drop_index(op.f("ix_division_grid_source_workspace_id"), table_name="division_grid")
    op.drop_index(op.f("ix_division_grid_source_key"), table_name="division_grid")
    op.drop_index(op.f("ix_division_grid_source_grid_id"), table_name="division_grid")
    op.drop_index(op.f("ix_division_grid_source_fingerprint"), table_name="division_grid")
    op.drop_table("division_grid")
    op.drop_index(op.f("ix_auth_user_username"), table_name="user", schema="auth")
    op.drop_index(op.f("ix_auth_user_email"), table_name="user", schema="auth")
    op.drop_table("user", schema="auth")
    op.drop_index(op.f("ix_auth_permissions_resource"), table_name="permissions", schema="auth")
    op.drop_index(op.f("ix_auth_permissions_name"), table_name="permissions", schema="auth")
    op.drop_index(op.f("ix_auth_permissions_action"), table_name="permissions", schema="auth")
    op.drop_table("permissions", schema="auth")
    op.drop_index("ix_audit_log_workspace_created", table_name="audit_log")
    op.drop_index("ix_audit_log_entity_created", table_name="audit_log")
    op.drop_index("ix_audit_log_actor_created", table_name="audit_log")
    op.drop_table("audit_log")
    op.drop_table("algorithms", schema="analytics")
    # ### end Alembic commands ###
    # CASCADE, because the enum types the tables above declared inline live in
    # these schemas and alembic never drops a type it created implicitly. The same
    # holds for the ones that landed in public, which no schema drop reaches.
    for schema in SCHEMAS:
        op.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
    op.execute(
        "DO $$ DECLARE t regtype; BEGIN "
        "FOR t IN SELECT oid::regtype FROM pg_type "
        "WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace "
        "LOOP EXECUTE 'DROP TYPE IF EXISTS ' || t || ' CASCADE'; END LOOP; END $$"
    )
