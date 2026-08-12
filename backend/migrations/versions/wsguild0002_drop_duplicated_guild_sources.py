"""drop the duplicated discord guild sources (contract half)

The CONTRACT half of the pair started by ``wsguild0001``. That revision added
``workspace.discord_guild_id`` and backfilled it; this one removes the two places the
guild used to live, now that nothing reads them.

**Apply this only AFTER the services carrying the new code are running.** The old
``TournamentDiscordChannel`` maps a ``guild_id`` attribute, and SQLAlchemy emits every
mapped column in every ``SELECT``, so dropping the column while old code is live makes
the Discord bot's ``load_active_channels`` raise ``UndefinedColumn`` -- log collection
stops entirely, not just for new rows. Symmetrically, ``wsguild0001`` must run BEFORE
the new code, which joins the workspace column. Neither ordering works for a single
combined revision, which is why there are two.

Stripping ``guild_id`` out of ``config_json`` matters beyond tidiness: leaving it would
keep two sources of truth and make the injection order in
``SqlEntitlementStore.load_configs`` load-bearing and untestable.

``config_json`` is ``sa.JSON()`` (``subs0001``), so the column type is ``json``, not
``jsonb``. The ``-``, ``||`` and ``?`` operators exist only on ``jsonb``, hence the
``::jsonb`` in and ``::json`` back out. The ``where ... ? 'guild_id'`` guard also makes
the strip idempotent.

``downgrade`` restores both sources so the pre-``wsguild0001`` code can run again:

- ``discord_channel.guild_id`` comes back as ``BigInteger NOT NULL`` via a server
  default that is then dropped, so the schema is byte-identical to before. Rows with no
  resolvable guild get ``0`` -- precisely as meaningful as the value was before, since
  nothing read it. The cast is bounded by shape *and* magnitude
  (``<= 9223372036854775807``): a 19-digit value can still overflow ``bigint``, which
  would abort the rollback. It would NOT leave a half-applied schema -- ``env.py`` wraps
  ``run_migrations`` in one transaction and PostgreSQL has transactional DDL, so an
  abort takes the ``add_column`` with it and the database is left exactly as it was. The
  rollback still would not complete, which is reason enough to bound the cast.
- The guild goes back into a ``boosty`` ``provider_config`` row by UPSERT, not UPDATE: a
  workspace can hold a guild while having no such row, and a plain update would destroy
  the snowflake irrecoverably. Inserted ``enabled = false`` so a rollback never starts
  enforcing something that was not enforcing, and on conflict updating only
  ``config_json`` so an existing row keeps its own flags.

Revision ID: wsguild0002
Revises: wsguild0001
Create Date: 2026-08-04

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "wsguild0002"
down_revision: str | Sequence[str] | None = "wsguild0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # One source of truth: the blob must not keep a competing copy.
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
           -- CASE, not two conjuncts: PostgreSQL leaves subexpression evaluation
           -- order undefined and the planner may reorder WHERE clauses, so the
           -- regex is not guaranteed to run before the cast it guards. Written as
           -- `regex and ::numeric <= …` a non-digit value could raise
           -- `invalid input syntax for type numeric` and abort the very rollback
           -- the guard exists to protect. No supported writer can produce such a
           -- value today -- this survives one arriving out of band.
           and case
                 when w.discord_guild_id ~ '^[0-9]{1,19}$'
                 then w.discord_guild_id::numeric <= 9223372036854775807
                 else false
               end
        """
    )
    op.alter_column("discord_channel", "guild_id", server_default=None, schema="log_processing")

    # A workspace can hold a guild while having no boosty row at all (and the
    # statement above needs a discord_channel row), so a plain update would destroy
    # the snowflake irrecoverably -- and since workspace is now the only source, a
    # re-upgrade would leave the gate silently unconfigured. Upsert instead, and
    # insert disabled so rolling back cannot start enforcing. `created_at` is omitted:
    # it has a server default (subs0001). The target is aliased `pc` rather than
    # referenced as `subscriptions.provider_config.config_json` inside DO UPDATE: the
    # three-part form is almost certainly valid, but an alias removes all doubt on a
    # path that first executes during a rollback, when nobody wants to debug syntax.
    op.execute(
        """
        insert into subscriptions.provider_config as pc
                    (workspace_id, provider, enabled, config_json)
        select w.id, 'boosty', false,
               jsonb_build_object('guild_id', w.discord_guild_id)::json
          from workspace w
         where w.discord_guild_id is not null
            on conflict on constraint uq_subscription_config_workspace_provider
            do update set config_json = ((pc.config_json::jsonb)
                                         || jsonb_build_object(
                                                'guild_id', excluded.config_json::jsonb ->> 'guild_id'
                                            ))::json
        """
    )
