import discord
import httpx
import asyncio

from faststream.rabbit import RabbitBroker

from src.core.config import settings
from src.core.logging import logger


intents = discord.Intents.default()
intents.messages = True
intents.message_content = True
intents.reactions = True

if settings.proxy_ip:
    proxy_conf = f"http://{settings.proxy_username}:{settings.proxy_password}@{settings.proxy_ip}:{settings.proxy_port}"
else:
    proxy_conf = None


client = discord.Client(intents=intents, proxy=proxy_conf)
broker = RabbitBroker(settings.broker_url)
httpx_client = httpx.AsyncClient(
    base_url=settings.parser_url,
    headers={"Authorization": f"Bearer {settings.access_token_service}"},
    proxy=httpx.Proxy(
        url=proxy_conf,
    ),
    timeout=httpx.Timeout(10, read=10),
)


async def process_attachment(tournament_id: int, attachment: discord.Attachment) -> bool:
    try:
        response = await httpx_client.get(attachment.url)
        response.raise_for_status()

        files = {
            "file": (attachment.filename, response.content, attachment.content_type)
        }

        upload_response = await httpx_client.post(f"logs/{tournament_id}/upload", files=files)
        if upload_response.status_code == 200:
            logger.info(f"✅ {attachment.filename} uploaded")
            process_response = await httpx_client.post(f"logs/{tournament_id}/{attachment.filename}")
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
    except discord.Forbidden:
        logger.info("❌ Bot does not have permission to react to the message.")
        return False


async def process_message(tournament_id: int, message: discord.Message) -> None:
    states: list[bool] = []
    try:
        if message.attachments:
            for attachment in message.attachments:
                state = await process_attachment(tournament_id, attachment)
                states.append(state)
        if all(states):
            await message.add_reaction("✅")
            await message.remove_reaction("❌", client.user)
        else:
            await message.add_reaction("❌")
            await message.remove_reaction("✅", client.user)
    except discord.Forbidden:
        logger.info("❌ Bot does not have permission to react to the message.")


async def process_all_messages(tournament_id: int) -> None:
    logger.info("🔍 Starting to process all messages in the channel...")
    channel = client.get_channel(settings.discord_channel_id)
    if not channel:
        logger.info("❌ Channel not found.")
        return

    async for message in channel.history(limit=None):
        await process_message(tournament_id, message)


@broker.subscriber("discord_commands")
async def handle_command(cmd: dict):
    if cmd.get("action") == "process_all":
        tournament_id = cmd.get("tournament_id")
        if not tournament_id:
            logger.info("❌ No tournament ID provided for process_all command.")
            return
        logger.info("🚀 Command from FastStream: process_all")
        await process_all_messages(tournament_id)
    elif cmd.get("action") == "process_message":
        logger.info("🚀 Command from FastStream: process_message")
        message_id = cmd.get("message_id")
        channel_id = cmd.get("channel_id")
        tournament_id = cmd.get("tournament_id")
        channel = client.get_channel(channel_id)
        if channel:
            message = await channel.fetch_message(message_id)
            await process_message(tournament_id, message)
        else:
            logger.info(f"❌ Channel with ID {channel_id} not found.")


@client.event
async def on_message(message: discord.Message):
    if message.channel.id != settings.discord_channel_id:
        return

    if message.attachments:
        for attachment in message.attachments:
            state = await process_attachment(settings.tournament_id, attachment)
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
        await client.start(settings.discord_token)
        await broker.start()
    finally:
        await client.close()
        await broker.close()


asyncio.run(main())