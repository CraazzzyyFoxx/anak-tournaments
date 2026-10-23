import typing

from sqlalchemy import BigInteger, Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db

if typing.TYPE_CHECKING:
    from shared.models.tournament.tournament import Tournament

__all__ = ("TournamentDiscordChannel",)


class TournamentDiscordChannel(db.TimeStampIntegerMixin):
    """A tournament's match-log channel: the one discord-service watches for attachments."""

    __tablename__ = "discord_channel"
    __table_args__ = ({"schema": "stats"},)

    tournament_id: Mapped[int] = mapped_column(
        ForeignKey("tournament.tournament.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    channel_id: Mapped[int] = mapped_column(BigInteger(), nullable=False, unique=True, index=True)
    channel_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean(), default=True, nullable=False)
    # The newest message id the bot has already walked past in this channel.
    # A reconnect rescans from here, not the last 500 messages; ``None`` (or a
    # manual backfill) walks the history.
    last_scanned_message_id: Mapped[int | None] = mapped_column(BigInteger(), nullable=True)

    # Relations
    tournament: Mapped[Tournament] = relationship()

    def __repr__(self):
        return f"<TournamentDiscordChannel tournament_id={self.tournament_id} channel_id={self.channel_id}>"
