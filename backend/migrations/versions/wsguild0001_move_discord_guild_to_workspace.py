"""add workspace.discord_guild_id and backfill it (expand half)

The guild lived in two unrelated places: ``subscriptions.provider_config``'s
``config_json['guild_id']`` (workspace-scoped, Boosty only, and the only one
anything read) and ``log_processing.discord_channel.guild_id`` (one row per
tournament, written by the admin form and read by nobody -- the bot keys on
``channel_id`` alone).

**This is the EXPAND half of an expand/contract pair; ``wsguild0002`` contracts.**
The split is not cosmetic -- a single revision is undeployable, because its two
halves need opposite orderings:

- ``add_column workspace.discord_guild_id`` must land BEFORE the new code, which
  joins that column in ``SqlEntitlementStore.load_configs``. Run the code first and
  every subscription read raises ``UndefinedColumn``.
- ``drop_column discord_channel.guild_id`` must land AFTER the new code, because the
  old ``TournamentDiscordChannel`` still maps that attribute and SQLAlchemy emits
  every mapped column in every ``SELECT``. Drop it first and the Discord bot's
  ``load_active_channels`` raises ``UndefinedColumn``, i.e. log collection stops.

So: apply this revision, roll the services, then apply ``wsguild0002``. Both
intermediate states are fully working -- old code still reads the blob key and the
tournament column, new code reads the workspace column.

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
that ``wsguild0002``'s downgrade writes for unresolvable rows.

``config_json`` is ``sa.JSON()`` (``subs0001``), so the column type is ``json``, not
``jsonb``. The ``->>`` operator used here works on ``json`` uncast; ``wsguild0002``,
which needs ``-``/``||``/``?``, does the casting.

``downgrade`` is a bare ``drop_column``: this revision adds a column and copies into
it, so there is nothing else to undo. The sources it copied FROM are still intact at
this point -- removing them is ``wsguild0002``'s job, and so is putting them back.

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

    # 1. The value the resolver actually reads wins. Pattern-guarded: the old write
    #    schema permitted any <=32-char string, so a stored '999' is possible, and
    #    copying it verbatim would both block every patron (see the docstring) and
    #    make every later workspace save 422 against the new `^\d{17,19}$` schema.
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
    #    Floored at the smallest 17-digit id -- `guild_id is not null` would be
    #    vacuous (the column is NOT NULL) and would let the placeholder 0 through.
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


def downgrade() -> None:
    op.drop_column("workspace", "discord_guild_id")
