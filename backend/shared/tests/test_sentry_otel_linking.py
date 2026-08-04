"""Sentry gets its spans from the otel-collector, not from the Sentry SDK.

``setup_sentry`` therefore adds ``OTLPIntegration`` with **both** of its side
effects switched off, which is easy to "simplify" back into a bug:

* ``setup_otlp_traces_exporter=True`` installs a second span processor that ships
  every span straight to Sentry, duplicating what the collector already forwards
  (double ingest, double bill, two copies of every trace).
* ``setup_propagator=True`` replaces the global W3C propagator with Sentry's own,
  so ``traceparent`` stops being written — silently severing the gateway -> service
  and RabbitMQ hops that make the trace distributed in the first place.

What must hold is that a Sentry event raised inside an OTel span carries that
span's ids (so an Issue opens on the trace Grafana shows) while the propagator
stays W3C. Both are global-state assertions, so this runs in a subprocess: an
in-process ``sentry_sdk.init`` plus a global TracerProvider would leak into every
other test in the session.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest import TestCase

_PROBE = """
import json
import sys
from pathlib import Path

import sentry_sdk
from opentelemetry import trace
from opentelemetry.propagate import get_global_textmap

from shared.observability.sentry import setup_sentry
from shared.observability.tracing import setup_tracing

setup_tracing(
    service_name="probe",
    # Never dialled: the exporter connects lazily and the span is dropped at exit.
    otlp_endpoint="http://127.0.0.1:1",
    enabled=True,
    sampler_name="always_on",
    sampler_arg=1.0,
    environment="test",
    release="probe@1",
)
setup_sentry(
    dsn="https://public@o0.ingest.us.sentry.io/1",
    environment="test",
    traces_sample_rate=0.0,
    profiles_sample_rate=0.0,
    service_name="probe",
    enable_logs=False,
    enable_metrics=False,
)

envelopes = []
sentry_sdk.get_client().transport.capture_envelope = envelopes.append

with trace.get_tracer("probe").start_as_current_span("probe span") as span:
    ctx = span.get_span_context()
    otel = (trace.format_trace_id(ctx.trace_id), trace.format_span_id(ctx.span_id))
    sentry_sdk.capture_message("probe")

events = [
    item.payload.json
    for envelope in envelopes
    for item in envelope.items
    if item.payload.json and item.payload.json.get("message") == "probe"
]
event_trace = events[0]["contexts"]["trace"] if events else {}
Path(sys.argv[1]).write_text(
    json.dumps(
        {
            "propagator_fields": sorted(get_global_textmap().fields),
            "otel": list(otel),
            "event": [event_trace.get("trace_id"), event_trace.get("span_id")],
            "resource": dict(trace.get_tracer_provider().resource.attributes),
        }
    ),
    encoding="utf-8",
)
"""


class SentryOtelLinkingTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        # shared/tests -> shared -> backend, where every service package lives.
        backend = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "probe.json"
            err = Path(tmp) / "probe.err"
            # Result goes through a file and the pipes are closed: a probe that
            # wedges (a mis-set flag can deadlock Sentry's scope handling) must
            # die on the timeout instead of parking the suite on a pipe read.
            with err.open("wb") as errfile:
                proc = subprocess.run(  # noqa: S603 - fixed argv, no shell
                    [sys.executable, "-c", _PROBE, str(out)],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=errfile,
                    cwd=backend,
                    timeout=120,
                    check=False,
                )
            if proc.returncode != 0 or not out.exists():
                tail = err.read_text(encoding="utf-8", errors="replace")[-2000:]
                raise AssertionError(f"probe failed ({proc.returncode}):\n{tail}")
            cls.result = json.loads(out.read_text(encoding="utf-8"))

    def test_event_inherits_the_active_otel_span(self) -> None:
        """Without OTLPIntegration the SDK invents its own trace id here."""
        self.assertEqual(self.result["otel"], self.result["event"])

    def test_propagator_still_writes_traceparent(self) -> None:
        """SentryPropagator would drop traceparent and break the broker hop."""
        self.assertIn("traceparent", self.result["propagator_fields"])

    def test_resource_carries_environment_and_release(self) -> None:
        """Sentry derives a span's environment and release from these two."""
        resource = self.result["resource"]
        self.assertEqual(resource.get("deployment.environment"), "test")
        self.assertEqual(resource.get("service.version"), "probe@1")
