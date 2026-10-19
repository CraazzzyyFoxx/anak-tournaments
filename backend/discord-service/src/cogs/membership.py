"""Guild lifecycle logging, and member changes handed to stats-service as events."""

from __future__ import annotations

from typing import TYPE_CHECKING

import discord
from discord.ext import commands
from loguru import logger

from shared.messaging.config import DISCORD_MEMBER_CHANGED_QUEUE
from shared.observability import publish_message
from shared.schemas.events import DiscordMemberChangedEvent
from src.core.broker import optional_broker

if TYPE_CHECKING:
    from src.bot import LogCollectorBot


async def _member_changed(member: discord.Member, reason: str) -> None:
    """Tell stats-service, which re-resolves the member's Boosty entitlement, that they changed.

    Published straight to the queue: a gateway event has no transaction for an
    outbox row to join. A lost one is caught up by stats's scheduled sweep.
    """
    broker = optional_broker()
    if broker is None:
        logger.warning(f"⚠️ RabbitMQ not available; member {member.id} change ({reason}) not published")
        return
    event = DiscordMemberChangedEvent(
        guild_id=str(member.guild.id),
        discord_user_id=str(member.id),
        reason=reason,
        source_service="discord-service",
    )
    await publish_message(broker, event.model_dump(), DISCORD_MEMBER_CHANGED_QUEUE, logger=logger)


class MembershipEventsCog(commands.Cog):
    def __init__(self, bot: LogCollectorBot) -> None:
        self.bot = bot

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
        """A role change can grant or revoke a role-backed subscription."""
        before_roles = {r.id for r in before.roles}
        after_roles = {r.id for r in after.roles}
        if before_roles != after_roles:
            logger.info(f"🔄 Member roles updated in guild {after.guild.id} for user {after.id}")
            await _member_changed(after, "role_update")

    @commands.Cog.listener()
    async def on_member_join(self, member: discord.Member) -> None:
        """Handle member joining guild."""
        logger.info(f"➕ Member joined guild {member.guild.id}: user {member.id}")
        await _member_changed(member, "member_join")

    @commands.Cog.listener()
    async def on_member_remove(self, member: discord.Member) -> None:
        """Handle member leaving guild."""
        logger.warning(f"➖ Member left guild {member.guild.id}: user {member.id}")
        await _member_changed(member, "member_remove")
