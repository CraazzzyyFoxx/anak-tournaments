import discord
import httpx
import asyncio
from datetime import datetime, timedelta, UTC
from typing import Any, Dict, Set

from faststream.rabbit import RabbitBroker
from faststream.rabbit.annotations import RabbitMessage

from sqlalchemy import select

from src.core.config import settings
from src.core.logging import logger
from src.core.db import async_session_maker
from shared.models import Tournament, TournamentDiscordChannel


intents = discord.Intents.default()
intents.messages = True
intents.message_content = True
intents.reactions = True
intents.guilds = True

if settings.proxy_ip:
    PROXY_CONF = f"http://{settings.proxy_username}:{settings.proxy_password}@{settings.proxy_ip}:{settings.proxy_port}"
else:
    PROXY_CONF = None


client = discord.Client(intents=intents, proxy=PROXY_CONF)

DISCORD_COMMANDS_QUEUE = "discord_commands"
rabbit_broker: RabbitBroker | None = None

# Cache for active tournaments and their channels
active_channels: Dict[int, int] = {}  # channel_id -> tournament_id
processing_messages: Set[int] = set()  # message IDs being processed


async def get_httpx_client(destination: str = 'internal') -> httpx.AsyncClient:
    """Create HTTP client for parser service"""
    return httpx.AsyncClient(
        base_url=settings.parser_url,
        headers={"Authorization": f"Bearer {settings.access_token_service}"},
        proxy=httpx.Proxy(url=PROXY_CONF) if PROXY_CONF and destination != "internal" else None,
        timeout=httpx.Timeout(30, read=60),
    )


async def get_tournament_discord_channels(tournament_id: int) -> list[int]:
    async with async_session_maker() as session:
        result = await session.execute(
            select(TournamentDiscordChannel.channel_id).where(
                TournamentDiscordChannel.tournament_id == tournament_id,
                TournamentDiscordChannel.is_active == True,
            )
        )
        return list(result.scalars().all())


async def get_text_channel(channel_id: int):
    channel = client.get_channel(channel_id)
    if channel is not None:
        return channel
    try:
        return await client.fetch_channel(channel_id)
    except discord.NotFound:
        return None
    except discord.Forbidden:
        return None


async def load_active_channels():
    """Load active tournament channels from database"""
    global active_channels
    
    async with async_session_maker() as session:
        # Get tournaments that are not finished or finished less than 1 day ago
        one_day_ago = datetime.now(UTC) - timedelta(days=1)
        
        result = await session.execute(
            select(TournamentDiscordChannel, Tournament)
            .join(Tournament, TournamentDiscordChannel.tournament_id == Tournament.id)
            .where(
                TournamentDiscordChannel.is_active == True,
                (
                    (Tournament.is_finished == False) |
                    (
                        (Tournament.is_finished == True) &
                        (Tournament.end_date != None) &
                        (Tournament.end_date >= one_day_ago)
                    )
                )
            )
        )
        
        new_channels = {}
        for discord_channel, tournament in result:
            new_channels[discord_channel.channel_id] = tournament.id
            logger.info(
                f"📌 Monitoring channel {discord_channel.channel_id} "
                f"for tournament #{tournament.number} - {tournament.name}"
            )
        
        active_channels = new_channels
        logger.success(f"✅ Loaded {len(active_channels)} active channels")


async def process_attachment(
    tournament_id: int,
    attachment: discord.Attachment,
) -> bool:
    """
    Download and process a single attachment
    Returns True if successful
    """
    try:
        logger.info(f"📥 Downloading {attachment.filename} for tournament {tournament_id}")
        async with await get_httpx_client(destination='discord') as http_client:
            # Download file from Discord
            response = await http_client.get(attachment.url)
            response.raise_for_status()

        async with await get_httpx_client(destination='internal') as http_client:
            # Upload to parser service
            files = {
                "file": (attachment.filename, response.content, attachment.content_type)
            }

            upload_response = await http_client.post(
                f"logs/{tournament_id}/upload",
                files=files
            )

            if upload_response.status_code != 200:
                logger.error(
                    f"❌ Upload failed for {attachment.filename}: "
                    f"{upload_response.status_code} - {upload_response.text}"
                )
                return False

            logger.success(f"✅ {attachment.filename} uploaded")

            # Process the uploaded file
            process_response = await http_client.post(
                f"logs/{tournament_id}/{attachment.filename}"
            )

            if process_response.status_code == 400:
                process_data = process_response.json()
                if not process_data["detail"][0]["code"] == "match_not_finished":
                    logger.error(
                        f"❌ Processing failed for {attachment.filename}: "
                        f"{process_response.status_code} - {process_response.text}"
                    )
                    return False

            if process_response.status_code != 200:
                logger.error(
                    f"❌ Processing failed for {attachment.filename}: "
                    f"{process_response.status_code} - {process_response.text}"
                )
                return False
            
        logger.success(f"✅ {attachment.filename} processed successfully")
        return True

    except httpx.HTTPError as e:
        logger.error(f"❌ HTTP error processing {attachment.filename}: {e}")
        return False
    except Exception as e:
        logger.error(f"❌ Unexpected error processing {attachment.filename}: {e}")
        return False


async def process_message(message: discord.Message, tournament_id: int) -> None:
    """
    Process a single message and its attachments
    Adds reactions to indicate status
    """
    if message.id in processing_messages:
        return  # Already processing
    
    if not message.attachments:
        return  # No attachments to process
    
    processing_messages.add(message.id)
    
    try:
        results = []
        for attachment in message.attachments:
            # Only process log files
            if attachment.filename.lower().endswith(('.txt', '.log', '.json')):
                success = await process_attachment(tournament_id, attachment)
                results.append(success)
            else:
                logger.info(f"⏭️ Skipping non-log file: {attachment.filename}")
        
        if not results:
            return
        
        # Update reactions based on results
        try:
            if all(results):
                await message.add_reaction("✅")
                try:
                    await message.remove_reaction("❌", client.user)
                except discord.NotFound:
                    pass
            else:
                await message.add_reaction("❌")
                try:
                    await message.remove_reaction("✅", client.user)
                except discord.NotFound:
                    pass
        except discord.Forbidden:
            logger.warning("⚠️ Bot doesn't have permission to add reactions")
        except discord.HTTPException as e:
            logger.warning(f"⚠️ Failed to add reaction: {e}")
            
    finally:
        processing_messages.discard(message.id)


async def process_channel_history(channel_id: int, tournament_id: int, limit: int = 10):
    """
    Process recent message history in a channel
    Used when bot starts or channel is newly added
    """
    try:
        channel = await get_text_channel(channel_id)
        if not channel:
            logger.error(f"❌ Channel {channel_id} not found")
            return
        
        logger.info(f"🔍 Processing last {limit} messages in channel {channel_id}")
        
        processed = 0
        async for message in channel.history(limit=limit):
            if message.attachments:
                await process_message(message, tournament_id)
                processed += 1
        
        logger.success(f"✅ Processed {processed} messages with attachments")
        
    except discord.Forbidden:
        logger.error(f"❌ No permission to read channel {channel_id}")
    except Exception as e:
        logger.error(f"❌ Error processing channel history: {e}")


def register_rabbit_handlers(broker: RabbitBroker) -> None:
    @broker.subscriber(DISCORD_COMMANDS_QUEUE)
    async def handle_discord_command(body: dict[str, Any], msg: RabbitMessage):
        await client.wait_until_ready()

        try:
            action = body.get("action")
            if action not in {"process_all", "process_message"}:
                logger.error(f"❌ Unknown discord command action: {action}")
                await msg.reject()
                return

            if action == "process_all":
                tournament_id = int(body["tournament_id"])
                channel_ids = await get_tournament_discord_channels(tournament_id)
                if not channel_ids:
                    logger.warning(f"⚠️ No active Discord channels found for tournament {tournament_id}")
                    await msg.ack()
                    return

                logger.info(
                    f"📩 RabbitMQ command: process_all for tournament {tournament_id} "
                    f"({len(channel_ids)} channel(s))"
                )
                for channel_id in channel_ids:
                    await process_channel_history(channel_id, tournament_id, limit=500)

                await msg.ack()
                return

            # process_message
            tournament_id = int(body["tournament_id"])
            channel_id = int(body["channel_id"])
            message_id = int(body["message_id"])

            channel = await get_text_channel(channel_id)
            if channel is None:
                logger.error(f"❌ Channel {channel_id} not found for message fetch")
                await msg.reject()
                return

            try:
                fetched_message = await channel.fetch_message(message_id)  # type: ignore[attr-defined]
            except discord.NotFound:
                logger.warning(f"⚠️ Message {message_id} not found in channel {channel_id}")
                await msg.reject()
                return
            except discord.Forbidden:
                logger.error(f"❌ No permission to fetch message {message_id} in channel {channel_id}")
                await msg.reject()
                return

            logger.info(
                f"📩 RabbitMQ command: process_message channel={channel_id} message={message_id} "
                f"tournament={tournament_id}"
            )
            await process_message(fetched_message, tournament_id)
            await msg.ack()

        except KeyError as e:
            logger.error(f"❌ Malformed discord command payload, missing: {e}")
            await msg.reject()
        except ValueError as e:
            logger.error(f"❌ Invalid discord command payload: {e}")
            await msg.reject()
        except Exception as e:
            logger.error(f"❌ Error handling discord command: {e}")
            await msg.nack()


async def start_rabbitmq_listener() -> None:
    global rabbit_broker
    if not settings.broker_url:
        logger.info("ℹ️ RABBITMQ_URL not set; RabbitMQ listener disabled")
        return

    rabbit_broker = RabbitBroker(settings.broker_url, logger=logger)
    register_rabbit_handlers(rabbit_broker)
    await rabbit_broker.start()
    logger.success(f"✅ RabbitMQ listener started (queue='{DISCORD_COMMANDS_QUEUE}')")


async def stop_rabbitmq_listener() -> None:
    global rabbit_broker
    if rabbit_broker is None:
        return
    try:
        await rabbit_broker.close()
    finally:
        rabbit_broker = None


async def channel_monitor_task():
    """
    Background task to periodically reload active channels
    Runs every 5 minutes
    """
    await client.wait_until_ready()
    
    while not client.is_closed():
        try:
            await load_active_channels()
        except Exception as e:
            logger.error(f"❌ Error reloading channels: {e}")
        
        await asyncio.sleep(300)  # 5 minutes


@client.event
async def on_ready():
    """Bot is ready and connected"""
    logger.success(f"✅ Bot started as {client.user}")
    logger.info(f"📡 Connected to {len(client.guilds)} guilds")
    
    # Load active channels
    await load_active_channels()
    
    # Process recent history for all active channels
    for channel_id, tournament_id in active_channels.items():
        await process_channel_history(channel_id, tournament_id, limit=500)
    
    # Start background monitor task
    client.loop.create_task(channel_monitor_task())


@client.event
async def on_message(message: discord.Message):
    """Handle new messages in monitored channels"""
    # Ignore bot's own messages
    if message.author == client.user:
        return
    
    # Check if this channel is being monitored
    tournament_id = active_channels.get(message.channel.id)
    if not tournament_id:
        return
    
    # Process message attachments
    if message.attachments:
        logger.info(
            f"📨 New message in monitored channel from {message.author.name} "
            f"with {len(message.attachments)} attachment(s)"
        )
        await process_message(message, tournament_id)


@client.event
async def on_message_edit(before: discord.Message, after: discord.Message):
    """Handle message edits (in case attachments were added)"""
    # Check if this channel is being monitored
    tournament_id = active_channels.get(after.channel.id)
    if not tournament_id:
        return
    
    # Check if attachments were added
    if len(after.attachments) > len(before.attachments):
        logger.info(f"📝 Message edited with new attachments")
        await process_message(after, tournament_id)


@client.event
async def on_guild_join(guild: discord.Guild):
    """Bot joined a new guild"""
    logger.info(f"🎉 Joined new guild: {guild.name} (ID: {guild.id})")


@client.event
async def on_guild_remove(guild: discord.Guild):
    """Bot removed from guild"""
    logger.warning(f"👋 Removed from guild: {guild.name} (ID: {guild.id})")


async def main():
    """Main entry point"""
    try:
        logger.info("🚀 Starting Discord Log Collection Bot...")
        await start_rabbitmq_listener()
        await client.start(settings.discord_token)
    except KeyboardInterrupt:
        logger.info("⏸️ Shutting down bot...")
    except Exception as e:
        logger.error(f"❌ Fatal error: {e}")
    finally:
        await stop_rabbitmq_listener()
        await client.close()
        logger.info("👋 Bot stopped")


if __name__ == "__main__":
    asyncio.run(main())