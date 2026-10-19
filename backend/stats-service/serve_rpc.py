"""The stats RPC process: typed ``rpc.stats.*`` handlers behind the gateway, and nothing that runs in the background.

It registers no ingest, rank, achievement or tournament-event consumer and starts no schedule but the outbox drain (its
handlers commit outbox rows, which must go out even while no worker runs); the rest belongs to ``serve_worker.py``.
Run: ``faststream run serve_rpc:app``.
"""

from shared.disciplines import DISCIPLINES
from shared.disciplines import jobs as discipline_jobs
from shared.messaging.outbox import drain_outbox
from shared.services.scheduler import IntervalScheduler
from src.core import config, db
from src.core.clients import realtime_redis
from src.core.lifecycle import Readiness, close_clients, create_process, start_clients, start_observability
from src.rpc import (
    achievements as rpc_achievements,
)
from src.rpc import (
    impact as rpc_impact,
)
from src.rpc import (
    ingest as rpc_ingest,
)
from src.rpc import (
    logs as rpc_logs,
)
from src.rpc import (
    misc as rpc_misc,
)
from src.rpc import (
    rank as rpc_rank,
)
from src.rpc import (
    subscription as rpc_subscription,
)

SERVICE_NAME = "stats-svc"

logger, broker, app = create_process(SERVICE_NAME, prefetch_count=config.settings.rpc_prefetch_count)
readiness = Readiness(broker)
_outbox_scheduler = IntervalScheduler(job_id="event_outbox_drain", label="Outbox drain", logger=logger)

rpc_logs.register(broker, logger)
rpc_rank.register(broker, logger)
rpc_achievements.register(broker, logger)
rpc_misc.register(broker, logger)
rpc_impact.register(broker, logger)
rpc_ingest.register(broker, logger)
rpc_subscription.register(broker, logger)

# The collection handlers (``rank.collect``, ...) run here but their consumers and schedules run in the worker: wire only
# the module runtime they read. Every installed discipline, not the worker's selection: the RPC surface is not partial.
discipline_jobs.configure_runtime(
    DISCIPLINES.values(), broker, session_factory=db.async_session_maker, redis=realtime_redis
)


@app.on_startup
async def start_rpc() -> None:
    await broker.connect()
    start_observability(SERVICE_NAME, readiness)
    await start_clients()
    readiness.bind()
    _outbox_scheduler.start(drain_outbox, seconds=1, args=(db.async_session_maker, broker))


@app.after_startup
async def serve_rpc() -> None:
    readiness.serving(True)
    logger.info("Stats RPC process started")


@app.on_shutdown
async def stop_rpc() -> None:
    readiness.serving(False)
    _outbox_scheduler.shutdown()


@app.after_shutdown
async def close_rpc_resources() -> None:
    await close_clients()
