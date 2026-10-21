"""discord-service renders every message: ``discord_message.payload_json``, ``discord_channel.last_scanned_message_id``.

Revision ID: discordmsg03
Revises: regtpl01
Create Date: 2026-10-21 00:00:00.000000

Publishers stop rendering cards. A row now carries, in ``payload_json``, only
what the bot cannot re-read from a table when it renders (a broadcast's event
payload); ``card_json`` becomes the bot's own last render. Rows claimed before
this migration still hold a publisher-rendered card there and no payload: the
bot re-renders them from their subject like any other row.

``discord_channel.last_scanned_message_id`` is where the bot's history walk
left off, so a reconnect scans only what arrived since instead of the last
500 messages of every channel. ``NULL`` walks the history once.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "discordmsg03"
down_revision: str | Sequence[str] | None = "regtpl01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("discord_message", sa.Column("payload_json", sa.JSON(), nullable=True))
    op.add_column(
        "discord_channel", sa.Column("last_scanned_message_id", sa.BigInteger(), nullable=True), schema="stats"
    )


def downgrade() -> None:
    op.drop_column("discord_channel", "last_scanned_message_id", schema="stats")
    op.drop_column("discord_message", "payload_json")
