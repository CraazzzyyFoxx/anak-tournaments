"""Headless RPC worker for app-service (app-svc).

Hosts every ``rpc.app.*`` subscriber the Go gateway calls (identity, catalog, discipline and workspace reads,
workspace writes, binary base64 endpoints). The public statistics, ``/users/*`` statistics and achievement reads,
their caches and the ``cache.invalidated`` consumer are stats-service's; the organizer dashboard is tournament-service's.

Run with: ``faststream run serve:app``.
"""

from faststream import FastStream
from redis.asyncio import Redis

from shared.messaging.config import NOTIFICATION_DELIVERY_DLQ
from shared.messaging.outbox import drain_outbox
from shared.messaging.topology import declare_dead_letter_queue
from shared.observability import (
    make_rabbit_broker,
    set_worker_broker,
    setup_logging,
    setup_sentry,
    setup_tracing,
    start_worker_metrics_server,
)
from shared.quota import close as close_quota
from shared.quota import configure as configure_quota
from shared.services.ontology import project_disciplines
from shared.services.realtime import configure_realtime
from shared.services.scheduler import IntervalScheduler
from src.core import clients, config, db
from src.core.caching import configure_cache
from src.rpc import (
    admin_crud,
    announcements,
    audit,
    binary,
    catalog,
    catalog_aliases,
    disciplines,
    metadata_admin,
    notifications,
    notifications_admin,
    quota,
    users,
    users_admin,
    workspaces,
)
from src.services.notification_delivery import consumer as notification_delivery_consumer

logger = setup_logging(
    service_name="app-svc",
    log_level=config.settings.log_level,
    logs_root_path=config.settings.logs_root_path,
    json_output=config.settings.json_logging,
)

broker = make_rabbit_broker(
    config.settings.rabbitmq_url, logger=logger, prefetch_count=config.settings.rpc_prefetch_count
)
app = FastStream(broker)

# The cashews singleton is process-global and has no default backend. The
# @cache-decorated flows raise NotConfiguredError without this — call it before
# any subscriber runs.
configure_cache()

# Same reason, for the realtime rail: ``emit`` publishes through this Redis URL,
# and the cache generations every service's invalidations bump live there too.
configure_realtime(redis_url=str(config.settings.redis_url))

# Third process-global with the same rule: the quota gate needs its policy
# session factory and its Redis before the first metered upload, and the admin
# subjects need it before the first ``invalidate_policy()``.
configure_quota(
    session_factory=db.async_session_maker,
    redis_url=str(config.settings.redis_url),
    enabled=config.settings.quota_enabled,
    edge_workspace_metering=config.settings.quota_edge_workspace_metering,
)

# Identity and workspace reads + workspace writes/members:
for _mod in (users, workspaces):
    _mod.register(broker, logger)
catalog.register(broker, logger)
disciplines.register(broker, logger)

# Workspace update/delete via the shared CRUD engine.
admin_crud.register(broker, logger)

# Game-metadata admin CRUD (hero/map/gamemode).
metadata_admin.register(broker, logger)

# Alias-miss queue: unresolved log names + one-click attach (superuser only).
catalog_aliases.register(broker, logger)

# User + identity admin CRUD, profile merge, avatar, CSV import.
users_admin.register(broker, logger)

# Platform audit log (read-only feed + per-entity trail), gated by audit.read.
audit.register(broker, logger)

# Notification inbox reads/mark-read + the public announcement banner.
notifications.register(broker, logger)

# Operator-facing announcement CRUD (workspace-scoped, plus the superuser-only
# platform banner).
announcements.register(broker, logger)

# Operator-facing view of the notifications this workspace produced, and the
# retire that takes one back out of every recipient's inbox.
notifications_admin.register(broker, logger)

# Discord delivery of the rows ``notify()`` writes and the posts
# ``broadcast()`` queues -- its own queue, its own channel, its own DLQ.
notification_delivery_consumer.register(broker, logger)

# Binary/multipart endpoints (icons, assets, match-log) over base64.
binary.register(broker, logger)

# Quota policy: the superuser-only plan/operation catalogue every metered
# service reads, plus a workspace's own usage report.
quota.register(broker, logger)

# Relay for the outbox rows this service writes (notifications, Discord
# messages, workspace membership changes).
_outbox_scheduler = IntervalScheduler(job_id="event_outbox_drain", label="Outbox drain", logger=logger)


@app.on_startup
async def start_worker() -> None:
    await broker.connect()
    # Service code that is not handed a broker (WorkspaceService's post-commit
    # RBAC drop at identity) resolves this one.
    set_worker_broker(broker)
    # The notification delivery queue dead-letters here; without the declaration a
    # poison message routes to a non-existent queue and vanishes.
    await declare_dead_letter_queue(broker, NOTIFICATION_DELIVERY_DLQ)
    await clients.s3_client.start()
    setup_sentry(
        dsn=config.settings.sentry_dsn,
        traces_sample_rate=config.settings.sentry_traces_sample_rate,
        profiles_sample_rate=config.settings.sentry_profiles_sample_rate,
        service_name="app-svc",
        enable_logs=config.settings.sentry_enable_logs,
        logs_level=config.settings.sentry_logs_level,
        enable_metrics=config.settings.sentry_enable_metrics,
        environment=config.settings.environment,
        release=config.settings.sentry_release,
        http_proxy=config.settings.sentry_http_proxy_url,
        https_proxy=config.settings.sentry_https_proxy_url,
    )
    setup_tracing(
        service_name="app-svc",
        otlp_endpoint=config.settings.otlp_endpoint,
        enabled=config.settings.tracing_enabled,
        sampler_name=config.settings.otel_traces_sampler,
        sampler_arg=config.settings.otel_traces_sampler_arg,
        environment=config.settings.environment,
        release=config.settings.sentry_release,
        engine=db.async_engine,
    )
    if config.settings.worker_metrics_port is not None:
        start_worker_metrics_server(config.settings.worker_metrics_port)
    await _flush_read_caches()
    # The modules' role ontologies are projected before the first message is served.
    async with db.async_session_maker() as session:
        await project_disciplines(session)
        await session.commit()
    _outbox_scheduler.start(drain_outbox, seconds=1, args=(db.async_session_maker, broker))
    logger.info("App RPC service (app-svc) started")


async def _flush_read_caches() -> None:
    """Drop stale cache on (re)deploy: one FLUSHDB per cache database, which hold nothing but cache — never a
    keyspace SCAN, which times out under load and loses the drop."""
    for url in (config.settings.api_cache_url, config.settings.backend_cache_url):
        client = Redis.from_url(url)
        try:
            await client.flushdb(asynchronous=True)
        finally:
            await client.aclose()


@app.on_shutdown
async def stop_worker() -> None:
    _outbox_scheduler.shutdown()
    await clients.s3_client.close()
    # Process-global redis client behind the quota gate (see configure_quota).
    await close_quota()
