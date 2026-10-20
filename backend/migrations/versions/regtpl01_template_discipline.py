"""Registration form templates are owned by a game (spec §8.4).

``balancer.registration_form_template.discipline`` (FK ``catalog.discipline.code``) is added nullable, backfilled,
then made NOT NULL. Backfill: the game whose identity provider is the provider of the template's REQUIRED game
identity question; none, or more than one game, falls back to the workspace's first enabled game. The provider ->
game map is frozen here (the modules may grow later; a revision must not change meaning with them).

Revision ID: regtpl01
Revises: achievement06
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "regtpl01"
down_revision = "achievement06"
branch_labels = None
depends_on = None

#: Game identity provider -> game, as installed when this revision was written.
_GAME_BY_PROVIDER = {"battlenet": "overwatch", "riot": "lol"}
_IDENTITY_PREFIX = "identity_"


def _required_games(schema: object) -> set[str]:
    document = json.loads(schema) if isinstance(schema, str) else schema
    games: set[str] = set()
    for section in (document or {}).get("sections", []):
        for field in section.get("fields", []):
            key = str(field.get("key", ""))
            if field.get("kind") == "builtin" and field.get("required") and key.startswith(_IDENTITY_PREFIX):
                game = _GAME_BY_PROVIDER.get(key[len(_IDENTITY_PREFIX) :])
                if game is not None:
                    games.add(game)
    return games


def upgrade() -> None:
    op.add_column(
        "registration_form_template",
        sa.Column("discipline", sa.String(length=32), nullable=True),
        schema="balancer",
    )
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT t.id, t.schema_json, w.disciplines_enabled[1] "
            "FROM balancer.registration_form_template t JOIN public.workspace w ON w.id = t.workspace_id"
        )
    ).all()
    for template_id, schema, first_enabled in rows:
        games = _required_games(schema)
        discipline = next(iter(games)) if len(games) == 1 else first_enabled
        bind.execute(
            sa.text("UPDATE balancer.registration_form_template SET discipline = :discipline WHERE id = :id"),
            {"discipline": discipline, "id": template_id},
        )
    op.alter_column("registration_form_template", "discipline", nullable=False, schema="balancer")
    op.create_foreign_key(
        "fk_registration_form_template_discipline",
        "registration_form_template",
        "discipline",
        ["discipline"],
        ["code"],
        source_schema="balancer",
        referent_schema="catalog",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_registration_form_template_discipline", "registration_form_template", schema="balancer", type_="foreignkey"
    )
    op.drop_column("registration_form_template", "discipline", schema="balancer")
