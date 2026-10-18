from __future__ import annotations

from typing import Any

import aio_pika
from faststream.rabbit import Channel, RabbitQueue

from shared.messaging.config import DLX_EXCHANGE, ingest_replay_dlq, ingest_replay_queue


async def declare_dead_letter_queue(broker: Any, queue: RabbitQueue) -> None:
    """Declare and bind a durable dead-letter queue to the shared DLX."""
    exchange = await broker.declare_exchange(DLX_EXCHANGE)
    declared_queue = await broker.declare_queue(queue)
    await declared_queue.bind(exchange, routing_key=queue.routing())


async def declare_replay_queues(broker: Any, discipline: str) -> None:
    """Declare ``stats.ingest.<discipline>.replay`` and its DLQ (the one shared definition in ``config``).

    Called by the consumer side at startup and by any publisher of a replay request before it publishes, so the request
    never depends on a worker of that discipline having started first. Declaration is idempotent.
    """
    await declare_dead_letter_queue(broker, ingest_replay_dlq(discipline))
    await broker.declare_queue(ingest_replay_queue(discipline))


#: Own channel (publisher confirms + ``on_return_raises``): the process's default channel silently drops an unroutable
#: mandatory message, which is right for fanout results but wrong for a request that must not be lost.
_REQUIRED_CHANNEL = Channel(on_return_raises=True)


async def publish_required(broker: Any, queue: RabbitQueue, body_json: str) -> None:
    """Persistently publish one JSON body to ``queue`` by name; raises if the broker cannot route it to that queue."""
    channel = await broker.config.broker_config.channel_manager.get_channel(_REQUIRED_CHANNEL)
    message = aio_pika.Message(
        body_json.encode(), content_type="application/json", delivery_mode=aio_pika.DeliveryMode.PERSISTENT
    )
    # aio_pika raises DeliveryError on a basic.return (mandatory + on_return_raises) or a nack.
    await channel.default_exchange.publish(message, routing_key=queue.name, mandatory=True)
