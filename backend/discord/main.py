import asyncio
from typing import Optional

import discord
import httpx
from faststream.rabbit import RabbitBroker

from src.core.config import settings
from src.core.logging import logger

# --- Constants for readability and easy maintenance ---
SUCCESS_EMOJI = "✅"
FAILURE_EMOJI = "❌"
PROCESSING_EMOJI = "🔄"
CONCURRENT_MESSAGE_PROCESSING_LIMIT = 10  # Limit for process_all_messages

# --- Client Setup ---

# Configure Discord Intents
intents = discord.Intents.default()
intents.messages = True
intents.message_content = True
intents.reactions = True

# Configure proxy for both discord.py and httpx
proxy_conf: Optional[str] = None
if all([settings.proxy_ip, settings.proxy_username, settings.proxy_password, settings.proxy_port]):
    proxy_conf = f"http://{settings.proxy_username}:{settings.proxy_password}@{settings.proxy_ip}:{settings.proxy_port}"
    logger.info("Using proxy for all connections.")
else:
    logger.info("Proxy is not configured.")

# Initialize clients
client = discord.Client(intents=intents, proxy=proxy_conf)
broker = RabbitBroker(settings.broker_url)
httpx_client = httpx.AsyncClient(
    base_url=settings.parser_url,
    headers={"Authorization": f"Bearer {settings.access_token_service}"},
    proxies={"http://": proxy_conf, "https://": proxy_conf} if proxy_conf else None,
    # Increased read timeout for potentially large files
    timeout=httpx.Timeout(10.0, read=30.0),
)


async def update_message_reaction(message: discord.Message, success: bool) -> None:
    """Adds the correct reaction and removes the opposite one."""
    try:
        # Remove processing indicator if present
        await message.remove_reaction(PROCESSING_EMOJI, client.user)

        if success:
            await message.add_reaction(SUCCESS_EMOJI)
            await message.remove_reaction(FAILURE_EMOJI, client.user)
        else:
            await message.add_reaction(FAILURE_EMOJI)
            await message.remove_reaction(SUCCESS_EMOJI, client.user)
    except discord.Forbidden:
        logger.warning(
            f"Insufficient permissions to set reactions in channel {message.channel.id} "
            f"for message {message.id}"
        )
    except discord.NotFound:
        logger.warning(f"Message {message.id} or reaction not found for update.")


async def process_attachment(tournament_id: int, attachment: discord.Attachment) -> bool:
    """Uploads and initiates the processing of a single attachment."""
    log_context = f"tournament_id={tournament_id}, attachment={attachment.filename}"
    logger.info(f"Starting attachment processing. {log_context}")
    try:
        # 1. Download the file from Discord's CDN
        response = await httpx_client.get(attachment.url)
        response.raise_for_status()
        logger.debug(f"File successfully downloaded from CDN. {log_context}")

        # 2. Upload the file to the parser service
        files = {
            "file": (attachment.filename, response.content, attachment.content_type)
        }
        upload_response = await httpx_client.post(f"logs/{tournament_id}/upload", files=files)
        upload_response.raise_for_status()  # Will raise an exception for 4xx/5xx statuses

        logger.info(f"✅ File successfully uploaded to the parser. {log_context}")

        # 3. Initiate file processing on the parser
        process_response = await httpx_client.post(f"logs/{tournament_id}/{attachment.filename}")
        process_response.raise_for_status()

        logger.info(f"✅ File successfully sent for processing. {log_context}")
        return True

    except httpx.HTTPStatusError as e:
        # API error (4xx, 5xx)
        error_body = e.response.text
        logger.error(
            f"❌ HTTP status error during attachment processing: {e.response.status_code}. "
            f"Server response: {error_body}. {log_context}"
        )
        return False
    except httpx.RequestError as e:
        # Network error (timeout, connection error, etc.)
        logger.error(f"❌ Network error during attachment processing: {e}. {log_context}")
        return False
    except Exception as e:
        logger.exception(f"❌ Unexpected error during attachment processing. {log_context}")
        return False


async def process_message(tournament_id: int, message: discord.Message) -> None:
    """Processes all attachments in a single message and sets the final reaction."""
    if not message.attachments:
        logger.debug(f"Message {message.id} has no attachments to process.")
        return

    log_context = f"tournament_id={tournament_id}, message_id={message.id}"
    logger.info(f"Starting message processing. {log_context}")

    try:
        await message.add_reaction(PROCESSING_EMOJI)
    except (discord.Forbidden, discord.NotFound):
        # If we can't set a reaction, just continue
        pass

    tasks = [process_attachment(tournament_id, att) for att in message.attachments]
    results = await asyncio.gather(*tasks)

    # all() returns True if results list is empty or all elements are True
    is_fully_successful = all(results)

    await update_message_reaction(message, success=is_fully_successful)

    if is_fully_successful:
        logger.info(f"Message processed successfully. {log_context}")
    else:
        logger.warning(f"Not all attachments in the message were processed successfully. {log_context}")


async def process_all_messages(tournament_id: int) -> None:
    """
    Scans the channel history and processes all messages.
    Uses a semaphore to limit concurrent requests.
    """
    logger.info(f"🔍 Starting full channel scan for tournament_id={tournament_id}")
    channel = client.get_channel(settings.discord_channel_id)
    if not isinstance(channel, discord.TextChannel):
        logger.error(f"❌ Channel with ID {settings.discord_channel_id} not found or is not a text channel.")
        return

    semaphore = asyncio.Semaphore(CONCURRENT_MESSAGE_PROCESSING_LIMIT)
    tasks = []

    async def process_with_semaphore(msg: discord.Message):
        async with semaphore:
            await process_message(tournament_id, msg)

    async for message in channel.history(limit=None):
        if message.attachments:
            task = asyncio.create_task(process_with_semaphore(message))
            tasks.append(task)

    if not tasks:
        logger.info("No messages with attachments found in the channel history.")
        return

    logger.info(f"Found {len(tasks)} messages with attachments. Starting processing...")
    await asyncio.gather(*tasks)
    logger.info(f"✅ Full channel scan for tournament_id={tournament_id} completed.")


@broker.subscriber("discord_commands")
async def handle_command(cmd: dict):
    """Handler for commands from RabbitMQ."""
    action = cmd.get("action")
    logger.info(f"🚀 Received command from FastStream: {action}, payload: {cmd}")

    try:
        if action == "process_all":
            tournament_id = cmd.get("tournament_id")
            if not tournament_id:
                logger.warning("❌ Command 'process_all' received without a tournament_id.")
                return
            await process_all_messages(int(tournament_id))

        elif action == "process_message":
            message_id = cmd.get("message_id")
            channel_id = cmd.get("channel_id")
            tournament_id = cmd.get("tournament_id")

            if not all([message_id, channel_id, tournament_id]):
                logger.warning(f"❌ Command 'process_message' received with incomplete data: {cmd}")
                return

            channel = client.get_channel(int(channel_id))
            if isinstance(channel, discord.TextChannel):
                try:
                    message = await channel.fetch_message(int(message_id))
                    await process_message(int(tournament_id), message)
                except discord.NotFound:
                    logger.error(f"❌ Message with ID {message_id} not found in channel {channel_id}.")
            else:
                logger.error(f"❌ Channel with ID {channel_id} not found or is not a text channel.")
        else:
            logger.warning(f"Received unknown command: {action}")

    except Exception:
        logger.exception(f"Critical error while processing command from FastStream: {cmd}")


@client.event
async def on_message(message: discord.Message):
    """Event: new message in a channel."""
    if message.author.bot or message.channel.id != settings.discord_channel_id:
        return

    if message.attachments:
        # Important note: Where to get the tournament_id for a new message?
        # In your original code, it came from settings. This can be inflexible.
        # If the bot needs to serve multiple tournaments, this ID should be obtained differently
        # (e.g., from a command that starts a "watch mode", or from the channel name).
        # For now, we'll stick with the settings.tournament_id logic.
        if not settings.tournament_id:
            logger.warning("Cannot process new message: settings.tournament_id is not set.")
            return

        # Using the centralized processing function
        await process_message(settings.tournament_id, message)


@client.event
async def on_ready():
    logger.info(f"✅ Bot successfully started and logged in as {client.user}")
    logger.info(f"Watching channel ID: {settings.discord_channel_id}")


async def main():
    """Main application entry point."""
    logger.info("Starting the microservice...")
    try:
        await broker.connect()
        await broker.start()
        logger.info("✅ Successfully connected to RabbitMQ.")

        # Check token and start the client
        if not settings.discord_token:
            logger.critical("❌ Discord token not found! Shutting down.")
            return

        await client.start(settings.discord_token)

    except Exception:
        logger.exception("💥 Critical error during startup. The microservice will be stopped.")
    finally:
        logger.info("Shutting down the microservice...")
        if not client.is_closed():
            await client.close()
        await broker.close()
        # Properly close the httpx client
        await httpx_client.aclose()
        logger.info("All connections closed. Exiting.")


if __name__ == "__main__":
    asyncio.run(main())