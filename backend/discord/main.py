import discord
import httpx
import asyncio

from faststream.redis import RedisBroker

from src.core.config import settings
from src.core.logging import logger


intents = discord.Intents.default()
intents.messages = True
intents.message_content = True
intents.reactions = True

client = discord.Client(intents=intents)
broker = RedisBroker(settings.broker_url)
httpx_client = httpx.AsyncClient(
    base_url=settings.api_url,
    headers={"Authorization": f"Bearer {settings.access_token_service}"},
    timeout=httpx.Timeout(10, read=10),
)


async def process_attachment(attachment: discord.Attachment) -> bool:
    try:
        response = await httpx_client.get(attachment.url)
        response.raise_for_status()

        files = {
            "file": (attachment.filename, response.content, attachment.content_type)
        }

        upload_response = await httpx_client.post("logs/48/upload", files=files)
        if upload_response.status_code == 200:
            logger.info(f"✅ {attachment.filename} uploaded")
            process_response = await httpx_client.post(f"logs/48/{attachment.filename}")
            if process_response.status_code == 200:
                logger.info(f"✅ {attachment.filename} processed")
                return True
            else:
                logger.info(
                    f"❌ Error processing {attachment.filename}: {process_response.status_code}"
                )
                return False

        else:
            logger.info(
                f"❌ Error uploading {attachment.filename}: {upload_response.status_code}"
            )
    except httpx.HTTPError as e:
        logger.info(f"❌ HTTP error: {e}")
        return False


async def process_message(message: discord.Message) -> None:
    if message.attachments:
        for attachment in message.attachments:
            state = await process_attachment(attachment)
            if state:
                await message.add_reaction("✅")
                await message.remove_reaction("❌", client.user)
                logger.info(f"✅ {attachment.filename} processed")
            else:
                await message.add_reaction("❌")
                await message.remove_reaction("✅", client.user)
                logger.info(f"❌ {attachment.filename} failed to process")


async def process_all_messages():
    logger.info("🔍 Starting to process all messages in the channel...")
    channel = client.get_channel(settings.discord_channel_id)
    if not channel:
        logger.info("❌ Channel not found.")
        return

    async for message in channel.history(limit=None):
        await process_message(message)


@broker.subscriber("discord_commands")
async def handle_command(cmd: dict):
    if cmd.get("action") == "process_all":
        logger.info("🚀 Command from FastStream: process_all")
        await process_all_messages()
    elif cmd.get("action") == "process_message":
        logger.info("🚀 Command from FastStream: process_message")
        message_id = cmd.get("message_id")
        channel_id = cmd.get("channel_id")
        channel = client.get_channel(channel_id)
        if channel:
            message = await channel.fetch_message(message_id)
            await process_message(message)
        else:
            logger.info(f"❌ Channel with ID {channel_id} not found.")


@client.event
async def on_message(message: discord.Message):
    if message.channel.id != settings.discord_channel_id:
        return

    if message.attachments:
        for attachment in message.attachments:
            state = await process_attachment(attachment)
            if state:
                await message.add_reaction("✅")
            else:
                await message.add_reaction("❌")


@client.event
async def on_ready():
    logger.info(f"✅ Bot started as {client.user}")


async def main():
    await broker.connect()

    try:
        await broker.start()
        await client.start(settings.discord_token)
    finally:
        await client.close()
        await broker.close()


asyncio.run(main())
