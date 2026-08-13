"""``setup_sentry``'s noise filters decide what reaches the issue stream.

Before they existed, one shared DSN accumulated 983 unresolved groups of which
fewer than a dozen were defects: AMQP reconnect churn opened an issue per
channel close, FastStream logged every handler traceback a second time as a
timestamped message (defeating grouping entirely), and ``AsyncioIntegration``
reported domain 404s raised inside cashews' ``lock=True`` task as unhandled.

These tests pin the classification so a future edit cannot silently reopen the
floodgates — or, worse, start dropping real 5xx.
"""

from __future__ import annotations

import asyncio
from unittest import TestCase

from redis import exceptions as redis_exceptions

from shared.core.errors import ApiExc, ApiHTTPException, BaseAPIException
from shared.observability.sentry import _before_send, _before_send_log, setup_sentry

ChannelClosed = type("ChannelClosed", (Exception,), {})
ConnectionClosed = type("ConnectionClosed", (OSError,), {})
# redis.exceptions.ConnectionError is its own class that happens to share the
# stdlib name; the filter matches on the name, so a stand-in is enough.
RedisConnectionError = type("ConnectionError", (Exception,), {})


def _hint(exc: BaseException) -> dict:
    return {"exc_info": (type(exc), exc, None)}


class BeforeSendTests(TestCase):
    def test_drops_transport_churn(self) -> None:
        churn = (
            ChannelClosed(),
            ConnectionClosed(),
            asyncio.CancelledError(),
            ConnectionResetError(),
            ConnectionRefusedError(),
            RedisConnectionError("No connection available."),
        )
        for exc in churn:
            with self.subTest(exc=type(exc).__name__):
                self.assertIsNone(_before_send({}, _hint(exc)))

    def test_drops_subclass_of_a_churn_type(self) -> None:
        class LostChannel(ChannelClosed):
            pass

        self.assertIsNone(_before_send({}, _hint(LostChannel())))

    def test_drops_domain_4xx_already_answered_by_the_rpc_envelope(self) -> None:
        exc = ApiHTTPException(status_code=404, detail=[ApiExc(code="not_found", msg="Match 6730 not found")])
        self.assertIsNone(_before_send({}, _hint(exc)))

    def test_keeps_domain_5xx(self) -> None:
        exc = BaseAPIException(status_code=500, detail="workspace_member has no linked auth user")
        event = {"event_id": "keep-me"}
        self.assertIs(event, _before_send(event, _hint(exc)))

    def test_keeps_real_database_and_infrastructure_errors(self) -> None:
        # NB: the STDLIB ``TimeoutError``, despite the redis-shaped message. It is
        # what an ``asyncio.timeout`` on a slow dependency raises, and it must stay
        # visible — see ``test_drops_redis_reachability_errors`` for the driver's
        # same-named class, which is churn. Only the qualified name separates them.
        for exc in (ValueError("bad row"), TimeoutError("Timeout reading from redis:6379")):
            with self.subTest(exc=type(exc).__name__):
                event = {"event_id": "keep-me"}
                self.assertIs(event, _before_send(event, _hint(exc)))

    def test_drops_redis_reachability_errors(self) -> None:
        """One Redis blip opened three groups and 282 events. ``ConnectionError``
        was already dropped by bare name; its ``TimeoutError`` sibling was not."""
        for exc in (
            redis_exceptions.TimeoutError("Timeout reading from redis:6379"),
            redis_exceptions.ConnectionError("Timeout connecting to server"),
            redis_exceptions.BusyLoadingError(),
        ):
            with self.subTest(exc=type(exc).__name__):
                self.assertIsNone(_before_send({}, _hint(exc)))

    def test_keeps_redis_errors_that_are_our_own_mistake(self) -> None:
        """The module is not blanket-dropped: a wrong command is a defect."""
        for exc in (redis_exceptions.ResponseError("WRONGTYPE"), redis_exceptions.DataError("bad value")):
            with self.subTest(exc=type(exc).__name__):
                event = {"event_id": "keep-me"}
                self.assertIs(event, _before_send(event, _hint(exc)))

    def test_drops_events_from_noisy_loggers(self) -> None:
        # faststream duplicates an exception it re-raises; the OTLP exporter
        # reports a collector it cannot reach and retries on its own.
        #
        # aiormq/aio_pika RENDER the refused connect into the log message instead of
        # raising it, so the record never carries the ``AMQPConnectionError`` that
        # ``_TRANSPORT_CHURN_EXCEPTIONS`` already covers. One stack restart landed
        # 1248 events across two groups through that gap.
        for name in (
            "faststream._internal.logger.logger_proxy",
            "opentelemetry.exporter.otlp.proto.grpc.exporter",
            "aiormq.connection",
            "aio_pika.robust_connection",
        ):
            with self.subTest(logger=name):
                self.assertIsNone(_before_send({"logger": name}, {}))

    def test_keeps_asyncio_lifecycle_complaints(self) -> None:
        """These look like restart noise and are not.

        "Task was destroyed but it is pending!" and "Event loop is closed" both mean
        a background task was never anchored or never cancelled — real defects, and
        exactly how the unanchored realtime publishers were found. Silencing the
        ``asyncio`` logger to quieten a restart would have hidden them.
        """
        event = {"logger": "asyncio"}
        self.assertIs(event, _before_send(event, {}))
        self.assertIs(event, _before_send(event, _hint(RuntimeError("Event loop is closed"))))

    def test_keeps_events_from_application_loggers(self) -> None:
        event = {"logger": "src.rpc._helpers"}
        self.assertIs(event, _before_send(event, {}))

    def test_tolerates_a_missing_hint(self) -> None:
        event = {"event_id": "keep-me"}
        self.assertIs(event, _before_send(event, {}))


class BeforeSendLogTests(TestCase):
    def test_drops_logs_from_noisy_loggers(self) -> None:
        for name in (
            "faststream._internal.logger.logger_proxy",
            "opentelemetry.exporter.otlp.proto.grpc.exporter",
        ):
            with self.subTest(logger=name):
                self.assertIsNone(_before_send_log({"attributes": {"logger.name": name}}, {}))

    def test_keeps_application_logs(self) -> None:
        log = {"attributes": {"logger.name": "src.services.achievement.engine.runner"}}
        self.assertIs(log, _before_send_log(log, {}))

    def test_keeps_logs_without_a_logger_attribute(self) -> None:
        log = {"attributes": {}}
        self.assertIs(log, _before_send_log(log, {}))


class LoguruEventGroupingTests(TestCase):
    """An ERROR log must be titled by its MESSAGE, never by a rendered log line.

    ``LoguruIntegration.event_format`` defaults to loguru's ``LOGURU_FORMAT``, and
    the SDK uses the rendered line as the event message — so every record arrived
    titled ``2026-08-07 15:44:15.785 | ERROR | mod:fn:12 - ...``. A millisecond
    timestamp is unique per occurrence, so grouping never happened: one group per
    event, the same fault unrecognizable across restarts, and thousands of
    single-event issues. This is the mechanism behind the loudest groups in the
    project, and it is invisible in the filters above — nothing was being dropped,
    the titles were simply never grouping.
    """

    def test_an_error_record_is_titled_by_its_bare_message(self) -> None:
        import sentry_sdk
        from loguru import logger

        captured: list[dict] = []
        logger.remove()
        self.addCleanup(logger.remove)
        logger.add(lambda _m: None, level="INFO", format="{time} | {level} | {message}")

        setup_sentry(
            dsn="https://key@o0.ingest.sentry.io/0",
            environment="test",
            traces_sample_rate=0.0,
            profiles_sample_rate=0.0,
            enable_logs=False,
            enable_metrics=False,
        )
        sentry_sdk.get_global_scope().set_client(
            sentry_sdk.Client(
                dsn="https://key@o0.ingest.sentry.io/0",
                transport=captured.append,
                integrations=sentry_sdk.get_client().integrations.values(),
                default_integrations=False,
            )
        )
        logger.error("Circuit breaker opened after consecutive failures")
        sentry_sdk.flush()

        titles = [e.get("logentry", {}).get("message") or e.get("message") for e in captured]
        self.assertEqual(["Circuit breaker opened after consecutive failures"], titles)
