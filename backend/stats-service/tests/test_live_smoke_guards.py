"""The live smoke's safety guards, with no database, broker or process: they run in the normal suite.

``LiveStack`` must refuse a non-loopback dependency or a non-test database before it creates or drops anything, and may
only ever delete resources whose generated names match its own patterns.
"""

from __future__ import annotations

import pytest

from tests.live_smoke_support import BUCKET_NAME, DB_NAME, REQUIRED, VHOST_NAME, LiveStack, redact

GOOD = {
    "P5_SMOKE_RABBITMQ_URL": "amqp://u:p@127.0.0.1:55672",
    "P5_SMOKE_RABBITMQ_MANAGEMENT_URL": "http://127.0.0.1:55673",
    "P5_SMOKE_REDIS_URL": "redis://127.0.0.1:56379/0",
    "P5_SMOKE_S3_ENDPOINT_URL": "http://127.0.0.1:59000",
    "P5_SMOKE_S3_ACCESS_KEY": "access",
    "P5_SMOKE_S3_SECRET_KEY": "secret",
}


@pytest.fixture
def ephemeral_postgres(monkeypatch):
    for name, value in {
        "POSTGRES_HOST": "127.0.0.1",
        "POSTGRES_PORT": "55432",
        "POSTGRES_DB": "anak_test",
        "POSTGRES_USER": "postgres",
        "POSTGRES_PASSWORD": "postgres",
    }.items():
        monkeypatch.setenv(name, value)


def configure(monkeypatch, **overrides: str | None) -> None:
    for name, value in {**GOOD, **overrides}.items():
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)


def test_a_complete_loopback_configuration_owns_generated_names(monkeypatch, tmp_path, ephemeral_postgres) -> None:
    configure(monkeypatch)
    stack = LiveStack(tmp_path)
    assert DB_NAME.fullmatch(stack.db) and VHOST_NAME.fullmatch(stack.vhost) and BUCKET_NAME.fullmatch(stack.bucket)
    assert stack.db != "anak_test"
    assert stack._created == {"db": False, "vhost": False, "bucket": False, "redis": False}


@pytest.mark.parametrize("name", REQUIRED)
def test_every_dependency_variable_is_required(monkeypatch, tmp_path, ephemeral_postgres, name) -> None:
    configure(monkeypatch, **{name: None})
    with pytest.raises(pytest.fail.Exception, match=name):
        LiveStack(tmp_path / "evidence")
    assert not (tmp_path / "evidence").exists()


@pytest.mark.parametrize(
    "name,value",
    [
        ("P5_SMOKE_RABBITMQ_URL", "amqp://u:p@rabbit.example.com:5672"),
        ("P5_SMOKE_RABBITMQ_MANAGEMENT_URL", "http://10.0.0.7:15672"),
        ("P5_SMOKE_REDIS_URL", "redis://cache.internal:6379/0"),
        ("P5_SMOKE_S3_ENDPOINT_URL", "https://s3.example.com"),
    ],
)
def test_a_non_loopback_dependency_is_refused_before_anything_is_created(
    monkeypatch, tmp_path, ephemeral_postgres, name, value
) -> None:
    configure(monkeypatch, **{name: value})
    with pytest.raises(pytest.fail.Exception, match="loopback"):
        LiveStack(tmp_path / "evidence")
    assert not (tmp_path / "evidence").exists()


@pytest.mark.parametrize(
    "overrides",
    [{"POSTGRES_DB": "anak_prod"}, {"POSTGRES_HOST": "db.example.com"}, {"POSTGRES_PORT": "5432"}],
)
def test_a_database_that_is_not_the_committed_test_server_is_refused(
    monkeypatch, tmp_path, ephemeral_postgres, overrides
) -> None:
    configure(monkeypatch)
    for name, value in overrides.items():
        monkeypatch.setenv(name, value)
    with pytest.raises(pytest.fail.Exception):
        LiveStack(tmp_path / "evidence")
    assert not (tmp_path / "evidence").exists()


def test_teardown_refuses_names_it_did_not_generate(monkeypatch, tmp_path, ephemeral_postgres) -> None:
    configure(monkeypatch)
    stack = LiveStack(tmp_path)
    for attribute, drop in (("db", stack._drop_database), ("vhost", stack._delete_vhost)):
        original = getattr(stack, attribute)
        setattr(stack, attribute, "anak_test" if attribute == "db" else "/")
        with pytest.raises(AssertionError):
            drop()
        setattr(stack, attribute, original)


def test_redaction_removes_keys_tokens_and_credentials() -> None:
    text = (
        "key owt_sk_AbC123-xyz header Bearer abc.def broker amqp://user:hunter2@127.0.0.1:5672/v "
        "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl plain secret-value"
    )
    out = redact(text, ["secret-value"])
    for leaked in ("owt_sk_AbC123", "abc.def", "hunter2", "eyJhbGci", "secret-value"):
        assert leaked not in out


def test_the_release_guide_example_is_a_valid_document() -> None:
    import re
    from pathlib import Path

    from shared.schemas.match_doc import parse_match_doc

    guide = Path(__file__).resolve().parents[3] / "docs" / "releases" / "2026-10-15-multi-game-p5-ingest.md"
    example = re.search(r"```json\n(\{.*?\n\})\n```", guide.read_text(encoding="utf-8"), re.S).group(1)
    doc = parse_match_doc(example.encode())
    assert doc.protocol == "owt.match/1" and {p.key for p in doc.participants} == {"p1", "p2", "p3", "p7"}


def test_redis_cleanup_flushes_only_a_database_this_session_owns(monkeypatch, tmp_path, ephemeral_postgres) -> None:
    import fakeredis

    configure(monkeypatch)
    stack = LiveStack(tmp_path)
    server = fakeredis.FakeServer()
    client = fakeredis.FakeStrictRedis(server=server)
    monkeypatch.setattr(stack, "_redis_client", lambda db: client)
    stack.redis_db = 3
    client.set("p5smoke:owner", "someone-else")
    client.set("their:data", "1")
    with pytest.raises(RuntimeError, match="not owned"):
        stack._flush_redis()
    assert client.get("their:data") == b"1"
    client.set("p5smoke:owner", stack.redis_token)
    stack._flush_redis()
    assert client.dbsize() == 0


def test_teardown_continues_after_a_process_cannot_be_stopped(monkeypatch, tmp_path, ephemeral_postgres) -> None:
    from types import SimpleNamespace

    configure(monkeypatch)
    stack = LiveStack(tmp_path)
    steps: list[str] = []
    stuck = SimpleNamespace(
        popen=SimpleNamespace(poll=lambda: None), tree=[1], pid=1, log=tmp_path / "missing.log", name="stuck"
    )
    stack.procs["stuck"] = stuck
    stack.stop = lambda name, **_: (_ for _ in ()).throw(RuntimeError("will not die"))
    stack.kill = lambda name: (_ for _ in ()).throw(RuntimeError("really will not die"))
    stack._created["db"] = stack._created["vhost"] = True
    stack._drop_database = lambda: steps.append("database")
    stack._delete_vhost = lambda: steps.append("vhost")
    with pytest.raises(pytest.fail.Exception, match="stuck"):
        stack.close()
    assert steps == ["database", "vhost"]
    assert (tmp_path / "evidence.json").is_file()


def test_teardown_never_signals_pids_of_a_process_it_already_reaped(monkeypatch, tmp_path, ephemeral_postgres) -> None:
    import os
    import subprocess
    import sys

    from tests.live_smoke_support import Proc

    configure(monkeypatch)
    stack = LiveStack(tmp_path)
    # A real, finished child; its (now reusable) pid and a bystander pid are cached as its descendants.
    done = subprocess.Popen([sys.executable, "-c", "pass"])
    done.wait()
    bystander = os.getpid()
    proc = Proc("done", [], str(tmp_path), done, tmp_path / "none.log", 0.0, tree=[done.pid, bystander])
    stack.procs["done"] = proc
    killed: list[int] = []
    monkeypatch.setattr("tests.live_smoke_support.subprocess.run", lambda *a, **k: killed.append(a[0]))
    monkeypatch.setattr("tests.live_smoke_support.os.kill", lambda pid, sig: killed.append(pid))
    stack.stop("done")  # the launcher exited by itself: cached pids are discarded, never acted on
    assert proc.reaped and proc.tree == [] and killed == []
    proc.tree = [bystander]
    stack.close()  # already reaped: close() must not stop it again or signal the cached pid
    assert killed == []
