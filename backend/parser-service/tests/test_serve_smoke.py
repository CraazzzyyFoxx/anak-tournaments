from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

from faststream import FastStream


def _import_serve():
    backend_root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(backend_root))
    sys.path.insert(0, str(backend_root / "parser-service"))

    os.environ["DEBUG"] = "true"

    return importlib.import_module("serve")


def test_serve_module_exposes_faststream_app() -> None:
    serve = _import_serve()

    assert isinstance(serve.app, FastStream)


def test_serve_module_leaves_tournament_worker_queues_to_tournament_service() -> None:
    serve = _import_serve()

    queue_names = {subscriber.queue.name for subscriber in serve.broker.subscribers}

    assert "tournament_encounter_completed" in queue_names
    assert "swiss_next_round" not in queue_names
    assert "tournament_recalc" not in queue_names
    assert not hasattr(serve, "scheduler")


def test_match_log_parsing_gets_its_own_amqp_channel() -> None:
    """A delivery that outlives RabbitMQ's consumer_timeout closes the channel it
    arrived on, taking every consumer sharing that channel down with it. The
    minutes-long match-log parse must therefore not share one with the short
    handlers, or a single slow log strands uploads on "Queued"."""
    serve = _import_serve()

    channel_by_queue = {
        subscriber.queue.name: subscriber.channel
        for subscriber in serve.broker.subscribers
        if getattr(subscriber, "queue", None) is not None
    }

    assert channel_by_queue["process_match_log"] is serve._MATCH_LOG_CHANNEL
    for short_handler in ("upload_match_log", "process_tournament_logs", "achievement_evaluate"):
        assert channel_by_queue[short_handler] is serve._JOBS_CHANNEL
    assert serve._MATCH_LOG_CHANNEL is not serve._JOBS_CHANNEL


def test_serve_registers_parser_unique_rpc_subjects() -> None:
    """The FastAPI HTTP face was removed; the parser-unique admin/read surface now
    runs as ``rpc.parser.*`` FastStream subscribers registered in ``serve.py``."""
    serve = _import_serve()

    subjects = {
        getattr(subscriber, "subject", None) or getattr(getattr(subscriber, "queue", None), "name", None)
        for subscriber in serve.broker.subscribers
    }

    assert "rpc.parser.logs.upload" in subjects
    assert "rpc.parser.logs.history" in subjects
    assert "rpc.parser.rank.user_history" in subjects
    assert "rpc.parser.ach.calculate" in subjects
