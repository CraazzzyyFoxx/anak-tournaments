"""move the discord guild id to workspace

The guild lived in two unrelated places: ``subscriptions.provider_config``'s
``config_json['guild_id']`` (workspace-scoped, Boosty only, and the only one
anything read) and ``log_processing.discord_channel.guild_id`` (one row per
tournament, written by the admin form and read by nobody -- the bot keys on
``channel_id`` alone).

Backfill precedence is the Boosty config first, because that is the value the
running system actually resolves against, so preferring it cannot change current
admission behaviour. The tournament channels are the fallback.

``guild_id`` is stripped out of ``config_json`` in the same revision. Leaving it
would keep two sources of truth and make the injection order in
``SqlEntitlementStore.load_configs`` load-bearing and untestable.

``config_json`` is ``sa.JSON()`` (``subs0001``), so the column type is ``json``,
not ``jsonb``. The ``-``/``||``/``?`` operators exist only on ``jsonb``, hence the
``::jsonb`` in and ``::json`` back out below.

``downgrade`` restores the original schema exactly: ``discord_channel.guild_id``
comes back as ``BigInteger NOT NULL``. Rows with no resolvable guild get ``0`` --
precisely as meaningful as the value was before, since nothing read it.

Revision ID: wsguild0001
Revises: subs0003
Create Date: 2026-08-04

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "wsguild0001"
down_revision: str | Sequence[str] | None = "subs0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("workspace", sa.Column("discord_guild_id", sa.String(length=32), nullable=True))

    # 1. The value the resolver actually reads wins.
    op.execute(
        """
        update workspace w
           set discord_guild_id = pc.config_json ->> 'guild_id'
          from subscriptions.provider_config pc
         where pc.workspace_id = w.id
           and pc.provider = 'boosty'
           and coalesce(pc.config_json ->> 'guild_id', '') <> ''
        """
    )

    # 2. Fallback: the most recently created tournament channel for that workspace.
    op.execute(
        """
        update workspace w
           set discord_guild_id = src.guild_id::text
          from (
                select distinct on (t.workspace_id)
                       t.workspace_id, dc.guild_id
                  from log_processing.discord_channel dc
                  join tournament.tournament t on t.id = dc.tournament_id
                 where dc.guild_id is not null
                 order by t.workspace_id, dc.created_at desc, dc.id desc
               ) src
         where src.workspace_id = w.id
           and w.discord_guild_id is null
        """
    )

    # 3. One source of truth: the blob must not keep a competing copy.
    op.execute(
        "update subscriptions.provider_config "
        "set config_json = ((config_json::jsonb) - 'guild_id')::json "
        "where config_json::jsonb ? 'guild_id'"
    )

    op.drop_column("discord_channel", "guild_id", schema="log_processing")


def downgrade() -> None:
    # NOT NULL is restored via a server default, then the default is dropped, so
    # the resulting schema is byte-identical to pre-upgrade.
    op.add_column(
        "discord_channel",
        sa.Column("guild_id", sa.BigInteger(), nullable=False, server_default="0"),
        schema="log_processing",
    )
    op.execute(
        """
        update log_processing.discord_channel dc
           set guild_id = w.discord_guild_id::bigint
          from tournament.tournament t
          join workspace w on w.id = t.workspace_id
         where t.id = dc.tournament_id
           and w.discord_guild_id ~ '^[0-9]+$'
        """
    )
    op.alter_column("discord_channel", "guild_id", server_default=None, schema="log_processing")

    op.execute(
        """
        update subscriptions.provider_config pc
           set config_json = ((pc.config_json::jsonb)
                              || jsonb_build_object('guild_id', w.discord_guild_id))::json
          from workspace w
         where w.id = pc.workspace_id
           and pc.provider = 'boosty'
           and w.discord_guild_id is not null
        """
    )

    op.drop_column("workspace", "discord_guild_id")
