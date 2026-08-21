"""Guild lifecycle logging and Discord-membership-triggered subscription resync."""

from __future__ import annotations

from typing import TYPE_CHECKING

import discord
from discord.ext import commands
from loguru import logger

if TYPE_CHECKING:
    from src.bot import LogCollectorBot


class MembershipEventsCog(commands.Cog):
    def __init__(self, bot: LogCollectorBot) -> None:
        self.bot = bot
        self._subscription_sync = bot.subscription_sync

    @commands.Cog.listener()
    async def on_guild_join(self, guild: discord.Guild) -> None:
        """Bot joined a new guild."""
        logger.info(f"🎉 Joined new guild: {guild.name} (ID: {guild.id})")

    @commands.Cog.listener()
    async def on_guild_remove(self, guild: discord.Guild) -> None:
        """Bot removed from guild."""
        logger.warning(f"👋 Removed from guild: {guild.name} (ID: {guild.id})")

    @commands.Cog.listener()
    async def on_member_update(self, before: discord.Member, after: discord.Member) -> None:
        """Handle role changes on guild members for instant subscription updates."""
        before_roles = {r.id for r in before.roles}
        after_roles = {r.id for r in after.roles}
        if before_roles != after_roles:
            logger.info(f"🔄 Member roles updated in guild {after.guild.id} for user {after.id}")
            await self._subscription_sync.resync(str(after.guild.id), str(after.id), "role_update")

    @commands.Cog.listener()
    async def on_member_join(self, member: discord.Member) -> None:
        """Handle member joining guild."""
        logger.info(f"➕ Member joined guild {member.guild.id}: user {member.id}")
        await self._subscription_sync.resync(str(member.guild.id), str(member.id), "member_join")

    @commands.Cog.listener()
    async def on_member_remove(self, member: discord.Member) -> None:
        """Handle member leaving guild."""
        logger.warning(f"➖ Member left guild {member.guild.id}: user {member.id}")
        await self._subscription_sync.resync(str(member.guild.id), str(member.id), "member_remove")
