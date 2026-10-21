"""Watches monitored tournament channels for match-log attachments: live
messages, edits that add attachments, and history rescans on connect -- from
each channel's cursor, so a reconnect reads only what it missed.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import discord
from discord.ext import commands, tasks
from loguru import logger

if TYPE_CHECKING:
    from src.bot import LogCollectorBot

_HISTORY_RESCAN_LIMIT = 500
# Tournament changes reload the registry as events (DiscordRabbitGateway), and
# a binding written through rpc.discord.channel.* reloads it in-process; this
# loop only catches what neither announces -- a finished tournament leaving
# its grace period -- and an event that was lost.
_CHANNEL_RELOAD_FALLBACK_MINUTES = 60


class LogIngestionCog(commands.Cog):
    def __init__(self, bot: LogCollectorBot) -> None:
        self.bot = bot
        self._registry = bot.channel_registry
        self._processor = bot.attachment_processor

    async def cog_unload(self) -> None:
        self.channel_monitor.cancel()

    @commands.Cog.listener()
    async def on_ready(self) -> None:
        """Bot is ready and connected: load channels, catch up on history, start polling."""
        logger.success(f"✅ Bot started as {self.bot.user}")
        logger.info(f"📡 Connected to {len(self.bot.guilds)} guilds")

        await self._registry.reload()

        # Independent per-channel history scans -- run them concurrently so
        # catching up N active tournaments' channels costs the slowest one,
        # not their sum.
        await asyncio.gather(
            *(
                self._processor.process_channel_history(
                    channel_id,
                    tournament_id,
                    after_message_id=self._registry.cursor_for(channel_id),
                    limit=_HISTORY_RESCAN_LIMIT,
                )
                for channel_id, tournament_id in self._registry.channel_ids().items()
            )
        )

        if not self.channel_monitor.is_running():
            self.channel_monitor.start()

    @tasks.loop(minutes=_CHANNEL_RELOAD_FALLBACK_MINUTES)
    async def channel_monitor(self) -> None:
        """Slow fallback reload of the active channels (see ``_CHANNEL_RELOAD_FALLBACK_MINUTES``)."""
        try:
            await self._registry.reload()
        except Exception as e:
            logger.error(f"❌ Error reloading channels: {e}")

    @channel_monitor.before_loop
    async def _before_channel_monitor(self) -> None:
        await self.bot.wait_until_ready()

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message) -> None:
        """Handle new messages in monitored channels."""
        if message.author == self.bot.user:
            return

        tournament_id = self._registry.tournament_id_for(message.channel.id)
        if not tournament_id:
            return

        if message.attachments:
            logger.info(
                f"📨 New message in monitored channel from {message.author.name} "
                f"with {len(message.attachments)} attachment(s)"
            )
            await self._processor.process_message(message, tournament_id)
            await self._registry.advance(message.channel.id, message.id)

    @commands.Cog.listener()
    async def on_message_edit(self, before: discord.Message, after: discord.Message) -> None:
        """Handle message edits (in case attachments were added)."""
        tournament_id = self._registry.tournament_id_for(after.channel.id)
        if not tournament_id:
            return

        if len(after.attachments) > len(before.attachments):
            logger.info("📝 Message edited with new attachments")
            await self._processor.process_message(after, tournament_id)
