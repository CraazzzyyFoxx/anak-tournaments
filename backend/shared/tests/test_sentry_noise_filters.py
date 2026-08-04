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

from shared.core.errors import ApiExc, ApiHTTPException, BaseAPIException
from shared.observability.sentry import _before_send, _before_send_log

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
        for exc in (ValueError("bad row"), TimeoutError("Timeout reading from redis:6379")):
            with self.subTest(exc=type(exc).__name__):
                event = {"event_id": "keep-me"}
                self.assertIs(event, _before_send(event, _hint(exc)))

    def test_drops_events_from_noisy_loggers(self) -> None:
        # faststream duplicates an exception it re-raises; the OTLP exporter
        # reports a collector it cannot reach and retries on its own.
        for name in (
            "faststream._internal.logger.logger_proxy",
            "opentelemetry.exporter.otlp.proto.grpc.exporter",
        ):
            with self.subTest(logger=name):
                self.assertIsNone(_before_send({"logger": name}, {}))

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
