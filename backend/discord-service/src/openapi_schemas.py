"""OpenAPI request/response model map for discord-service RPC subjects.

Schemas-only module consumed by the export script -- see ``shared.rpc.openapi``;
importing it connects to nothing. Ad-hoc dict bodies (the workspace guild
reads, the backfill ack) and 204 handlers are omitted.
"""

from __future__ import annotations

from shared.rpc.openapi import Op
from src import schemas

OPERATIONS: dict[str, Op] = {
    "rpc.discord.channel.get": Op(response=schemas.DiscordChannelRead),
    "rpc.discord.channel.upsert": Op(request=schemas.DiscordChannelUpsert, response=schemas.DiscordChannelRead),
}
