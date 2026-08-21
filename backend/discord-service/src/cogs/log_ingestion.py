"""Watches monitored tournament channels for match-log attachments: live
messages, edits that add attachments, and periodic history rescans.
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
_CHANNEL_RELOAD_INTERVAL_MINUTES = 5


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
                self._processor.process_channel_history(channel_id, tournament_id, limit=_HISTORY_RESCAN_LIMIT)
                for channel_id, tournament_id in self._registry.channel_ids().items()
            )
        )

        if not self.channel_monitor.is_running():
            self.channel_monitor.start()

    @tasks.loop(minutes=_CHANNEL_RELOAD_INTERVAL_MINUTES)
    async def channel_monitor(self) -> None:
        """Periodically reload active channels so tournament additions/removals
        take effect without a bot restart."""
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
        # Ignore bot's own messages
        if message.author == self.bot.user:
            return

        # Check if this channel is being monitored
        tournament_id = self._registry.tournament_id_for(message.channel.id)
        if not tournament_id:
            return

        # Process message attachments
        if message.attachments:
            logger.info(
                f"📨 New message in monitored channel from {message.author.name} "
                f"with {len(message.attachments)} attachment(s)"
            )
            await self._processor.process_message(message, tournament_id)

    @commands.Cog.listener()
    async def on_message_edit(self, before: discord.Message, after: discord.Message) -> None:
        """Handle message edits (in case attachments were added)."""
        # Check if this channel is being monitored
        tournament_id = self._registry.tournament_id_for(after.channel.id)
        if not tournament_id:
            return

        # Check if attachments were added
        if len(after.attachments) > len(before.attachments):
            logger.info("📝 Message edited with new attachments")
            await self._processor.process_message(after, tournament_id)
