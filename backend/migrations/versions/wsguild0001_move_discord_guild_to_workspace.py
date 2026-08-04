"""move the discord guild id to workspace

The guild lived in two unrelated places: ``subscriptions.provider_config``'s
``config_json['guild_id']`` (workspace-scoped, Boosty only, and the only one
anything read) and ``log_processing.discord_channel.guild_id`` (one row per
tournament, written by the admin form and read by nobody -- the bot keys on
``channel_id`` alone).

Backfill precedence is the Boosty config first (step 1), because that is the value
the running system already resolves against: preferring it cannot change current
admission behaviour. Step 2, the tournament channels, is a different bet, and the
asymmetry matters. That column was written by the admin form and read by nobody, so
it was never validated against Discord. Promoting it turns it into a live gating
input, and the two failure modes are NOT symmetric: a workspace with NO guild
answers ``unknown``, which the Kleene composition treats as a pass, so everybody is
still admitted; a workspace with the WRONG guild gets a 404 from
``GET /guilds/{id}/members/{user}``, which surfaces as ``MemberNotFound`` and
resolves ``inactive``/``not_a_member`` -- a refusal that blocks every patron in that
workspace, where before it admitted them all. Guessing wrong is strictly worse than
not guessing. So both steps accept only what can plausibly be a snowflake: step 1
requires ``^[0-9]{17,19}$`` (the old write schema had ``max_length=32`` and no digits
pattern, so ``'999'`` was a legal stored value, and an over-long one would abort the
whole migration on the ``varchar(32)`` column), and step 2 requires
``>= 10000000000000000`` -- the smallest 17-digit id, which also rejects the ``0``
that ``downgrade`` writes for unresolvable rows.

``guild_id`` is stripped out of ``config_json`` in the same revision. Leaving it
would keep two sources of truth and make the injection order in
``SqlEntitlementStore.load_configs`` load-bearing and untestable.

``config_json`` is ``sa.JSON()`` (``subs0001``), so the column type is ``json``,
not ``jsonb``. The ``-``/``||``/``?`` operators exist only on ``jsonb``, hence the
``::jsonb`` in and ``::json`` back out below.

``downgrade`` restores the original schema exactly: ``discord_channel.guild_id``
comes back as ``BigInteger NOT NULL``, and rows with no resolvable guild get ``0`` --
precisely as meaningful as the value was before, since nothing read it. The cast is
bounded by shape *and* magnitude (``<= 9223372036854775807``): a 19-digit value can
still overflow ``bigint``, and that would abort the revision after ``add_column`` had
already run, leaving it half-applied. The guild itself is preserved into a ``boosty``
``provider_config`` row so a later re-upgrade recovers it -- inserted
``enabled = false`` so a rollback never starts enforcing something that was not
enforcing, and on conflict updating only ``config_json`` so an existing row keeps its
own flags.

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
           and pc.config_json ->> 'guild_id' ~ '^[0-9]{17,19}$'
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
                 where dc.guild_id >= 10000000000000000
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
           and w.discord_guild_id ~ '^[0-9]{1,19}$'
           and w.discord_guild_id::numeric <= 9223372036854775807
        """
    )
    op.alter_column("discord_channel", "guild_id", server_default=None, schema="log_processing")

    # A workspace can hold a guild while having no boosty row at all (and the
    # statement above needs a discord_channel row), so a plain update would destroy
    # the snowflake irrecoverably -- and since workspace is now the only source, a
    # re-upgrade would leave the gate silently unconfigured. Upsert instead, and
    # insert disabled so rolling back cannot start enforcing. `created_at` is omitted:
    # it has a server default (subs0001).
    op.execute(
        """
        insert into subscriptions.provider_config (workspace_id, provider, enabled, config_json)
        select w.id, 'boosty', false,
               jsonb_build_object('guild_id', w.discord_guild_id)::json
          from workspace w
         where w.discord_guild_id is not null
            on conflict on constraint uq_subscription_config_workspace_provider
            do update set config_json = ((subscriptions.provider_config.config_json::jsonb)
                                         || jsonb_build_object(
                                                'guild_id', excluded.config_json::jsonb ->> 'guild_id'
                                            ))::json
        """
    )

    op.drop_column("workspace", "discord_guild_id")
