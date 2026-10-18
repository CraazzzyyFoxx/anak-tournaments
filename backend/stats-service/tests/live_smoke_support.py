"""Opt-in live-stack fixture: real subprocesses against real PostgreSQL, RabbitMQ, Redis and an S3-compatible store.

Reusable by later phases (P6/P8). Nothing here runs unless the caller asks for it (``RUN_P5_LIVE_SMOKE=1`` in
``test_ingest_live_smoke.py``). Every dependency is loopback-only and the fixture owns exactly the resources whose
generated names it created:

* PostgreSQL: the administrative connection is the committed ``anak_test`` DSN (``is_ephemeral_test_dsn``) used only to
  ``CREATE``/``DROP`` the scratch database ``test_p5_ingest_<uuid4 hex>``, migrated to head. ``anak_test`` itself is never
  touched.
* RabbitMQ: a ``p5smoke_<hex>`` vhost created and deleted through the local management API.
* S3: a ``p5-smoke-<hex>`` bucket created/emptied/deleted through the repository's ``S3Client``.
* Redis: one empty logical database of the configured server, flushed on exit.

Child processes (``subprocess.Popen``, explicit cwd/env, output to a temp directory) are the real entry points: stats
``serve_rpc`` and ``serve_worker``, identity ``serve``, tournament ``serve`` (outbox drain + evidence consumer) and the
built Go gateway. Readiness is observed (broker consumers, ``/health``, answered RPC), never slept.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psycopg
import pytest
from psycopg import sql

from shared.clients.s3 import S3Client
from shared.testing.db import is_ephemeral_test_dsn, postgres_env

STATS = Path(__file__).resolve().parents[1]
BACKEND = STATS.parent
REPO = BACKEND.parent
LOOPBACK = {"127.0.0.1", "localhost", "::1"}
DB_NAME = re.compile(r"test_p5_ingest_[0-9a-f]{32}")
VHOST_NAME = re.compile(r"p5smoke_[0-9a-f]{16}")
BUCKET_NAME = re.compile(r"p5-smoke-[0-9a-f]{16}")
REQUIRED = (
    "P5_SMOKE_RABBITMQ_URL",
    "P5_SMOKE_RABBITMQ_MANAGEMENT_URL",
    "P5_SMOKE_REDIS_URL",
    "P5_SMOKE_S3_ENDPOINT_URL",
    "P5_SMOKE_S3_ACCESS_KEY",
    "P5_SMOKE_S3_SECRET_KEY",
)
REDIS_OWNER_KEY = "p5smoke:owner"
JWT_SECRET = "p5-live-smoke-secret-" + "x" * 24
SECRET_PATTERNS = (
    re.compile(r"owt_sk_[A-Za-z0-9_\-]+"),
    re.compile(r"eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]*"),
    re.compile(r"(?i)bearer\s+\S+"),
    re.compile(r"(?i)(amqps?|redis|postgres(?:ql)?(?:\+\w+)?)://[^\s/@]*:[^\s/@]*@"),
)


def require_loopback(url: str, what: str) -> None:
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    if host not in LOOPBACK:
        pytest.fail(f"{what} must be a loopback address, got host {host!r}")


def free_port() -> int:
    """A currently free loopback port; re-checked by the caller right before use via :func:`assert_port_free`."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def assert_port_free(port: int) -> None:
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", port)) == 0:
            pytest.fail(f"port {port} is already in use")


def wait_until(predicate: Callable[[], Any], what: str, *, timeout: float = 90.0, interval: float = 0.25) -> Any:
    """Poll ``predicate`` until truthy within a bounded deadline; the failure names what never happened."""
    deadline = time.monotonic() + timeout
    last: Any = None
    while time.monotonic() < deadline:
        try:
            last = predicate()
        except Exception as exc:  # not up yet
            last = repr(exc)
        else:
            if last:
                return last
        time.sleep(interval)
    pytest.fail(f"timed out after {timeout:.0f}s waiting for {what}; last observation: {last!r}")


@dataclass
class Response:
    status: int
    headers: dict[str, str]
    raw: bytes

    def json(self) -> Any:
        return json.loads(self.raw) if self.raw else None


def http(
    method: str, url: str, *, body: bytes | None = None, headers: dict[str, str] | None = None, timeout: float = 30
) -> Response:
    request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return Response(response.status, dict(response.headers), response.read())
    except urllib.error.HTTPError as exc:
        return Response(exc.code, dict(exc.headers), exc.read())


def redact(text: str, secrets: list[str]) -> str:
    for secret in secrets:
        if secret:
            text = text.replace(secret, "***")
    for pattern in SECRET_PATTERNS:
        text = pattern.sub("***", text)
    return text


@dataclass
class Proc:
    name: str
    argv: list[str]
    cwd: str
    popen: subprocess.Popen
    log: Path
    started_at: float
    exit_code: int | None = None
    tree: list[int] = field(default_factory=list)
    #: Set once the process and its descendants are confirmed gone: cached pids are then never acted on again
    #: (an OS may have reused them for an unrelated process).
    reaped: bool = False

    @property
    def pid(self) -> int:
        return self.popen.pid

    def alive(self) -> bool:
        return self.popen.poll() is None


def _alive_windows(pid: int) -> bool:
    import ctypes

    handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return False
    try:
        code = ctypes.c_ulong()
        return bool(ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259
    finally:
        ctypes.windll.kernel32.CloseHandle(handle)


def _alive_posix(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def process_tree(pid: int) -> list[int]:
    """``pid`` and every live descendant.

    On Windows a venv's ``python.exe`` is a launcher that spawns the real interpreter, so ``Popen.pid`` alone is not the
    process under test: pausing or waiting on it must cover the whole tree.
    """
    if os.name != "nt":
        found = [pid]
        for child in subprocess.run(
            ["pgrep", "-P", str(pid)], capture_output=True, text=True, check=False
        ).stdout.split():
            found.extend(process_tree(int(child)))
        return found
    import ctypes
    from ctypes import wintypes

    class Entry(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", ctypes.c_long),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", ctypes.c_char * 260),
        ]

    kernel = ctypes.windll.kernel32
    snapshot = kernel.CreateToolhelp32Snapshot(0x2, 0)  # TH32CS_SNAPPROCESS
    parents: dict[int, list[int]] = {}
    try:
        entry = Entry()
        entry.dwSize = ctypes.sizeof(Entry)
        more = kernel.Process32First(snapshot, ctypes.byref(entry))
        while more:
            parents.setdefault(entry.th32ParentProcessID, []).append(entry.th32ProcessID)
            more = kernel.Process32Next(snapshot, ctypes.byref(entry))
    finally:
        kernel.CloseHandle(snapshot)
    found, queue = [], [pid]
    while queue:
        current = queue.pop(0)
        found.append(current)
        queue.extend(child for child in parents.get(current, []) if child not in found)
    return [p for p in found if p == pid or _alive_windows(p)]


def _suspend_windows(pid: int, suspend: bool) -> None:
    import ctypes

    handle = ctypes.windll.kernel32.OpenProcess(0x0800, False, pid)  # PROCESS_SUSPEND_RESUME
    if not handle:
        raise OSError(f"cannot open process {pid}")
    try:
        status = (ctypes.windll.ntdll.NtSuspendProcess if suspend else ctypes.windll.ntdll.NtResumeProcess)(handle)
        if status:
            raise OSError(f"NtSuspend/ResumeProcess({pid}) failed with {status:#x}")
    finally:
        ctypes.windll.kernel32.CloseHandle(handle)


@dataclass
class Evidence:
    """What the run proves, written outside tracked source: no key, token or raw identity content."""

    directory: Path
    data: dict[str, Any] = field(
        default_factory=lambda: {
            "commands": [],
            "process_pids": {},
            "ready_checks": [],
            "job_ids": {},
            "status_transitions": {},
            "match_ids": {},
            "revisions": {},
            "observation_counts": {},
            "outbox_event_ids": {},
            "receipt_outcomes": {},
            "exit_codes": {},
        }
    )

    def record(self, section: str, key: str, value: Any) -> None:
        self.data[section][key] = value

    def append(self, section: str, value: Any) -> None:
        self.data[section].append(value)

    def write(self) -> Path:
        path = self.directory / "evidence.json"
        path.write_text(json.dumps(self.data, indent=1, sort_keys=True, default=str) + "\n", encoding="utf-8")
        return path


class LiveStack:
    """Provisions the owned resources, then starts/stops/kills/pauses the real processes against them."""

    def __init__(self, evidence_dir: Path | None = None) -> None:
        missing = [name for name in REQUIRED if not os.environ.get(name)]
        if missing:
            pytest.fail(
                f"RUN_P5_LIVE_SMOKE=1 needs {', '.join(missing)} (see docs/releases/2026-10-15-multi-game-p5-ingest.md)"
            )
        self.amqp = os.environ["P5_SMOKE_RABBITMQ_URL"]
        self.mgmt_url = os.environ["P5_SMOKE_RABBITMQ_MANAGEMENT_URL"].rstrip("/")
        self.redis_url = os.environ["P5_SMOKE_REDIS_URL"]
        self.s3_endpoint = os.environ["P5_SMOKE_S3_ENDPOINT_URL"]
        self.s3_access = os.environ["P5_SMOKE_S3_ACCESS_KEY"]
        self.s3_secret = os.environ["P5_SMOKE_S3_SECRET_KEY"]
        for url, what in (
            (self.amqp, "P5_SMOKE_RABBITMQ_URL"),
            (self.mgmt_url, "P5_SMOKE_RABBITMQ_MANAGEMENT_URL"),
            (self.redis_url, "P5_SMOKE_REDIS_URL"),
            (self.s3_endpoint, "P5_SMOKE_S3_ENDPOINT_URL"),
        ):
            require_loopback(url, what)
        # The administrative connection is the committed ephemeral test server; the scratch database is generated here.
        if not is_ephemeral_test_dsn():
            pytest.fail(
                "refusing: POSTGRES_* is not the committed ephemeral test PostgreSQL (127.0.0.1:55432/anak_test)"
            )
        self.pg = postgres_env()
        require_loopback(f"//{self.pg['host']}", "POSTGRES_HOST")
        suffix = uuid.uuid4().hex
        self.db = f"test_p5_ingest_{suffix}"
        self.vhost = f"p5smoke_{suffix[:16]}"
        self.bucket = f"p5-smoke-{suffix[16:32]}"
        assert DB_NAME.fullmatch(self.db) and VHOST_NAME.fullmatch(self.vhost) and BUCKET_NAME.fullmatch(self.bucket)
        amqp = urllib.parse.urlsplit(self.amqp)
        self.amqp_user, self.amqp_password = (
            urllib.parse.unquote(amqp.username or ""),
            urllib.parse.unquote(amqp.password or ""),
        )
        self.vhost_url = amqp._replace(path="/" + urllib.parse.quote(self.vhost, safe="")).geturl()
        self.redis_db: int | None = None
        self.redis_token = uuid.uuid4().hex
        self.directory = Path(evidence_dir or tempfile.mkdtemp(prefix="p5-live-smoke-"))
        self.directory.mkdir(parents=True, exist_ok=True)
        (self.directory / "logs").mkdir(exist_ok=True)
        self.evidence = Evidence(self.directory)
        self.procs: dict[str, Proc] = {}
        self.ports: dict[str, int] = {}
        self._created: dict[str, bool] = {"db": False, "vhost": False, "bucket": False, "redis": False}
        self.gateway_binary: Path | None = None

    # -- resources --------------------------------------------------------------------------------------------

    @property
    def db_url(self) -> str:
        return f"postgresql+psycopg://{self.pg['user']}:{self.pg['password']}@{self.pg['host']}:{self.pg['port']}/{self.db}"

    @property
    def redis(self) -> str:
        return f"{self._redis_root()}/{self.redis_db}"

    def _admin(self) -> psycopg.Connection:
        return psycopg.connect(
            host=self.pg["host"],
            port=int(self.pg["port"]),
            user=self.pg["user"],
            password=self.pg["password"],
            dbname="postgres",
            autocommit=True,
        )

    def connect(self) -> psycopg.Connection:
        assert DB_NAME.fullmatch(self.db)
        return psycopg.connect(
            host=self.pg["host"],
            port=int(self.pg["port"]),
            user=self.pg["user"],
            password=self.pg["password"],
            dbname=self.db,
            autocommit=True,
        )

    def query(self, statement: str, params: tuple | dict | None = None) -> list[tuple]:
        with self.connect() as connection:
            return connection.execute(statement, params).fetchall()

    def scalar(self, statement: str, params: tuple | dict | None = None) -> Any:
        rows = self.query(statement, params)
        return rows[0][0] if rows else None

    def mgmt(self, path: str, *, method: str = "GET", body: dict | None = None) -> Response:
        token = base64.b64encode(f"{self.amqp_user}:{self.amqp_password}".encode()).decode()
        headers = {"Authorization": f"Basic {token}", "Content-Type": "application/json"}
        return http(
            method,
            f"{self.mgmt_url}/api/{path}",
            body=json.dumps(body).encode() if body is not None else None,
            headers=headers,
            timeout=10,
        )

    def queue(self, name: str) -> dict | None:
        response = self.mgmt(f"queues/{urllib.parse.quote(self.vhost, safe='')}/{urllib.parse.quote(name, safe='')}")
        return response.json() if response.status == 200 else None

    def consumers(self, name: str) -> int:
        queue = self.queue(name)
        return int(queue.get("consumers", 0)) if queue else 0

    def provision(self) -> None:
        migrated_env = {**os.environ, "DATABASE_URL": self.db_url, "OWT_APPLY_ENCOUNTER_LAYER_DROP": "1"}
        # Every dependency is awaited (bounded) before anything is created in it.
        wait_until(lambda: self.mgmt("overview").status == 200, "RabbitMQ management API", timeout=120)
        wait_until(lambda: self._redis_client(0).ping(), "Redis to answer PING", timeout=60)
        wait_until(lambda: asyncio.run(self._s3_ready()), "the S3 endpoint to list buckets", timeout=60)
        quoted = urllib.parse.quote(self.vhost, safe="")
        assert self.mgmt(f"vhosts/{quoted}", method="PUT", body={}).status in (201, 204)
        self._created["vhost"] = True
        grant = {"configure": ".*", "write": ".*", "read": ".*"}
        assert self.mgmt(
            f"permissions/{quoted}/{urllib.parse.quote(self.amqp_user, safe='')}", method="PUT", body=grant
        ).status in (201, 204)
        self.evidence.append("ready_checks", {"check": "rabbitmq vhost created", "vhost": self.vhost})

        # Exclusive reservation: an atomic SET NX of an ownership key. An empty DBSIZE alone would let two sessions
        # claim the same database; here only one SET NX wins, a database holding foreign data is released again and
        # skipped, and cleanup flushes a database only after re-reading its own token.
        for candidate in range(1, 16):
            client = self._redis_client(candidate)
            if not client.set(REDIS_OWNER_KEY, self.redis_token, nx=True):
                continue
            if client.dbsize() == 1:
                self.redis_db = candidate
                self._created["redis"] = True
                break
            client.delete(REDIS_OWNER_KEY)
        else:
            pytest.fail("no unreserved, empty Redis logical database (1-15) available for the smoke")
        self.evidence.append("ready_checks", {"check": "redis database claimed", "db": self.redis_db})

        asyncio.run(self._create_bucket())
        self._created["bucket"] = True
        self.evidence.append("ready_checks", {"check": "s3 bucket created", "bucket": self.bucket})

        with self._admin() as admin:
            admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(self.db)))
        self._created["db"] = True
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=BACKEND,
            env=migrated_env,
            text=True,
            capture_output=True,
            timeout=600,
            check=False,
        )
        self.evidence.append(
            "commands", {"cmd": "alembic upgrade head", "database": self.db, "exit": result.returncode}
        )
        if result.returncode:
            pytest.fail(f"migration failed:\n{result.stdout[-2000:]}\n{result.stderr[-3000:]}")
        self.evidence.append("ready_checks", {"check": "database migrated to head", "database": self.db})

    def _redis_client(self, db: int):
        import redis

        return redis.Redis.from_url(f"{self._redis_root()}/{db}", socket_timeout=5, socket_connect_timeout=5)

    async def _s3_ready(self) -> bool:
        client = self.s3()
        await client.start()
        async with client._client() as raw:
            await raw.list_buckets()
        return True

    def _redis_root(self) -> str:
        parts = urllib.parse.urlsplit(self.redis_url)
        return parts._replace(path="", query="", fragment="").geturl().rstrip("/")

    def s3(self) -> S3Client:
        return S3Client(self.s3_access, self.s3_secret, self.s3_endpoint, self.bucket)

    async def _create_bucket(self) -> None:
        client = self.s3()
        await client.start()
        async with client._client() as raw:
            await raw.create_bucket(Bucket=self.bucket)

    async def _drop_bucket(self) -> None:
        client = self.s3()
        await client.start()
        for key in await client.list_objects(""):
            await client.delete_object(key)
        async with client._client() as raw:
            await raw.delete_bucket(Bucket=self.bucket)

    # -- processes --------------------------------------------------------------------------------------------

    def env(self, **extra: str) -> dict[str, str]:
        env = dict(os.environ)
        env.update(
            POSTGRES_DB=self.db,
            POSTGRES_HOST=self.pg["host"],
            POSTGRES_PORT=str(self.pg["port"]),
            POSTGRES_USER=self.pg["user"],
            POSTGRES_PASSWORD=self.pg["password"],
            RABBITMQ_URL=self.vhost_url,
            RABBITMQ_MANAGEMENT_URL=self.mgmt_url,
            RABBITMQ_MANAGEMENT_USER=self.amqp_user,
            RABBITMQ_MANAGEMENT_PASSWORD=self.amqp_password,
            REDIS_URL=self.redis,
            S3_ENDPOINT_URL=self.s3_endpoint,
            S3_ACCESS_KEY=self.s3_access,
            S3_SECRET_KEY=self.s3_secret,
            S3_BUCKET_NAME=self.bucket,
            JWT_SECRET_KEY=JWT_SECRET,
            LOGS_ROOT_PATH=str(self.directory / "logs"),
            JSON_LOGGING="false",
            LOG_LEVEL="info",
            QUOTA_ENABLED="false",
            DEBUG="false",
            PYTHONPATH=str(BACKEND),
            TRACING_ENABLED="false",
            SENTRY_DSN="",
            # Nothing may leave the machine: the rank collector's schedule is admin-gated and off in a fresh database, and
            # its base URL points at a closed loopback port as a second guard.
            OVERFAST_BASE_URL="http://127.0.0.1:9",
        )
        env.pop("STATS_DISCIPLINES", None)
        env.update(extra)
        return env

    @property
    def secrets(self) -> list[str]:
        return [self.amqp_password, self.s3_secret, JWT_SECRET, self.pg["password"]]

    def start(self, name: str, argv: list[str], *, cwd: Path, env: dict[str, str]) -> Proc:
        assert name not in self.procs or not self.procs[name].alive(), f"{name} is already running"
        log = self.directory / f"{name}.raw.log"
        handle = open(log, "wb")  # noqa: SIM115 - owned by the child for its lifetime
        popen = subprocess.Popen(
            argv,
            cwd=cwd,
            env=env,
            stdout=handle,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        proc = Proc(name, argv, str(cwd), popen, log, time.monotonic())
        self.procs[name] = proc
        self.evidence.record("process_pids", name, popen.pid)
        self.evidence.append(
            "commands",
            {
                "process": name,
                "cwd": str(cwd.relative_to(REPO)),
                "argv": [Path(argv[0]).name, *argv[1:]],
                "pid": popen.pid,
            },
        )
        return proc

    def faststream(self, name: str, service: str, module: str, *, port: int, **extra: str) -> Proc:
        assert_port_free(port)
        self.ports[name] = port
        return self.start(
            name,
            [sys.executable, "-m", "faststream", "run", f"{module}:app"],
            cwd=BACKEND / service,
            env=self.env(WORKER_METRICS_PORT=str(port), **extra),
        )

    def worker_env(self, disciplines: str | None) -> dict[str, str]:
        # A short, test-only reaper: a claim older than 12s is reclaimed on the next 2s tick, and a request that was
        # delivered to a frozen consumer is re-requested after 15s (production keeps the pending window above the
        # 5-minute queue TTL; claim fencing is what makes a double delivery safe).
        extra = {
            "LOG_REAPER_TICK_SECONDS": "2",
            "LOG_REAPER_PROCESSING_AFTER_SECONDS": "12",
            "LOG_REAPER_PENDING_AFTER_SECONDS": "15",
        }
        if disciplines is not None:
            extra["STATS_DISCIPLINES"] = disciplines
        return extra

    def build_gateway(self) -> Path:
        binary = self.directory / ("gateway.exe" if os.name == "nt" else "gateway")
        result = subprocess.run(
            ["go", "build", "-o", str(binary), "./cmd/gateway"],
            cwd=REPO / "gateway",
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )
        self.evidence.append("commands", {"cmd": "go build ./cmd/gateway", "exit": result.returncode})
        if result.returncode:
            pytest.fail(f"gateway build failed:\n{result.stderr[-2000:]}")
        self.gateway_binary = binary
        return binary

    def start_gateway(self) -> Proc:
        binary = self.gateway_binary or self.build_gateway()
        port, metrics = free_port(), free_port()
        assert_port_free(port)
        assert_port_free(metrics)
        self.ports["gateway"], self.ports["gateway_metrics"] = port, metrics
        env = self.env(
            GATEWAY_PORT=str(port),
            GATEWAY_METRICS_PORT=str(metrics),
            GATEWAY_ENV="development",
            LOG_FILE=str(self.directory / "logs" / "gateway.log"),
            GATEWAY_API_KEY_RATE_LIMIT="10000",
            GATEWAY_AUTH_RATE_LIMIT="10000",
            GATEWAY_ANON_RATE_LIMIT="0",
        )
        return self.start("gateway", [str(binary)], cwd=REPO / "gateway", env=env)

    @property
    def gateway(self) -> str:
        return f"http://127.0.0.1:{self.ports['gateway']}"

    def health(self, name: str) -> tuple[int, str]:
        response = (
            http("GET", f"http://127.0.0.1:{self.ports[name]}/health", timeout=5)
            if name != "gateway"
            else http("GET", f"{self.gateway}/health", timeout=5)
        )
        return response.status, response.raw.decode(errors="replace")

    def ready(self, name: str, what: str, predicate: Callable[[], Any], *, timeout: float = 120) -> Any:
        proc = self.procs[name]

        def check() -> Any:
            if not proc.alive():
                pytest.fail(
                    f"{name} exited with {proc.popen.returncode} before becoming ready ({what}); see {proc.log.name}"
                )
            return predicate()

        result = wait_until(check, f"{name}: {what}", timeout=timeout)
        proc.tree = process_tree(proc.pid)
        self.evidence.record("process_pids", name, proc.tree)
        self.evidence.append(
            "ready_checks",
            {
                "process": name,
                "pid": proc.pid,
                "tree": proc.tree,
                "check": what,
                "seconds": round(time.monotonic() - proc.started_at, 1),
            },
        )
        return result

    def rpc(self, subject: str, payload: dict, *, timeout: float = 30) -> dict:
        from faststream.rabbit import RabbitBroker

        from shared.messaging.rpc import request_dict

        async def call() -> dict:
            broker = RabbitBroker(self.vhost_url)
            await broker.start()
            try:
                return await request_dict(broker, payload, subject, timeout=timeout)
            finally:
                await broker.stop()

        return asyncio.run(call())

    def stop(self, name: str, *, grace: float = 45) -> int | None:
        """Ask the process (and its whole group) to stop; anything left after ``grace`` is killed."""
        proc = self.procs[name]
        if proc.popen.poll() is None:
            proc.tree = process_tree(proc.pid)
            proc.reaped = False
            if os.name == "nt":
                proc.popen.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                proc.popen.terminate()
            try:
                proc.popen.wait(timeout=grace)
            except subprocess.TimeoutExpired:
                self.kill(name)
        elif not proc.reaped:
            # The launcher exited by itself earlier: pids cached while it ran may belong to someone else now.
            proc.tree = []
        self._reap_tree(proc)
        proc.exit_code = proc.popen.returncode
        self.evidence.record("exit_codes", name, proc.exit_code)
        return proc.exit_code

    def kill(self, name: str) -> int | None:
        """Hard-kill the process tree (no graceful shutdown): what a crashed worker looks like."""
        proc = self.procs[name]
        launcher_alive = proc.popen.poll() is None
        tree = process_tree(proc.pid) if launcher_alive else []
        if launcher_alive:
            proc.tree, proc.reaped = tree, False
        if not launcher_alive:
            pass  # the launcher is gone: its pid may be reused, so nothing is signalled by pid
        elif os.name == "nt":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True, check=False)
        else:
            for pid in reversed(tree):
                os.kill(pid, signal.SIGKILL)
        proc.popen.wait(timeout=30)
        self._reap_tree(proc)
        proc.exit_code = proc.popen.returncode
        self.evidence.record("exit_codes", name, proc.exit_code)
        return proc.exit_code

    def _reap_tree(self, proc: Proc) -> None:
        """A launcher can exit before the interpreter it spawned: nothing of a stopped process may keep running.

        Survivors get a short grace, then are force-killed; one that still lives is an error.
        """

        def alive(pid: int) -> bool:
            return _alive_windows(pid) if os.name == "nt" else _alive_posix(pid)

        if proc.reaped:
            return
        survivors = [pid for pid in proc.tree if pid != proc.pid and alive(pid)]
        deadline = time.monotonic() + 10
        while survivors and time.monotonic() < deadline:
            time.sleep(0.25)
            survivors = [pid for pid in survivors if alive(pid)]
        for pid in survivors:
            if os.name == "nt":
                subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)], capture_output=True, check=False)
            else:
                os.kill(pid, signal.SIGKILL)
        deadline = time.monotonic() + 10
        while survivors and time.monotonic() < deadline:
            time.sleep(0.25)
            survivors = [pid for pid in survivors if alive(pid)]
        if survivors:
            raise RuntimeError(f"processes {survivors} of {proc.name} survived a forced kill")
        proc.tree, proc.reaped = [], True

    def pause(self, name: str) -> None:
        """Freeze every process of the tree (SIGSTOP / NtSuspendProcess): a worker stuck inside a job."""
        proc = self.procs[name]
        proc.tree = process_tree(proc.pid)
        for pid in proc.tree:
            if os.name == "nt":
                _suspend_windows(pid, True)
            else:
                os.kill(pid, signal.SIGSTOP)

    def resume(self, name: str) -> None:
        proc = self.procs[name]
        for pid in reversed(proc.tree):
            if os.name == "nt":
                _suspend_windows(pid, False)
            else:
                os.kill(pid, signal.SIGCONT)

    def log_text(self, name: str) -> str:
        return redact(self.procs[name].log.read_text(errors="replace"), self.secrets)

    # -- subprocess helpers that live in another service's ``src`` package --------------------------------------

    def run_script(self, script: str, service: str, marker: str, *, stdin: dict | None = None) -> dict:
        service_dir = BACKEND / service
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name(script)), str(service_dir)],
            cwd=service_dir,
            env=self.env(),
            input=json.dumps(stdin) if stdin is not None else None,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
        line = next((x for x in result.stdout.splitlines() if x.startswith(marker)), None)
        if result.returncode or line is None:
            pytest.fail(
                f"{script} failed:\n{redact(result.stdout[-2500:], self.secrets)}\n{redact(result.stderr[-3500:], self.secrets)}"
            )
        self.evidence.append("commands", {"script": script, "service": service, "exit": result.returncode})
        return json.loads(line.removeprefix(marker))

    # -- teardown ---------------------------------------------------------------------------------------------

    def close(self) -> Path:
        """Stop what is still running, drop only what this fixture created, redact logs, write the evidence."""
        problems: list[str] = []
        for name, proc in self.procs.items():
            try:
                if not proc.reaped:
                    self.stop(name)
            except Exception as exc:  # one stuck process must not leave the database, bucket or vhost behind
                problems.append(f"stop {name}: {exc!r}")
                try:
                    self.kill(name)
                except Exception as again:
                    problems.append(f"kill {name}: {again!r}")
        steps: list[tuple[str, Callable[[], None]]] = []
        if self._created["db"]:
            steps.append(("database", self._drop_database))
        if self._created["bucket"]:
            steps.append(("bucket", lambda: asyncio.run(self._drop_bucket())))
        if self._created["redis"]:
            steps.append(("redis", self._flush_redis))
        if self._created["vhost"]:
            steps.append(("vhost", self._delete_vhost))
        for what, step in steps:
            try:
                step()
            except Exception as exc:  # report every leftover, never mask the first failure
                problems.append(f"{what}: {exc!r}")
        try:
            for proc in self.procs.values():
                if proc.log.exists():
                    target = self.directory / "logs" / f"{proc.name}.log"
                    target.write_text(redact(proc.log.read_text(errors="replace"), self.secrets), encoding="utf-8")
                    proc.log.unlink()
            # The services also write their own file logs under LOGS_ROOT_PATH: redact those in place too.
            for log in (self.directory / "logs").glob("*.log"):
                log.write_text(redact(log.read_text(errors="replace"), self.secrets), encoding="utf-8")
            if self.gateway_binary and self.gateway_binary.exists():
                self.gateway_binary.unlink()
        except Exception as exc:
            problems.append(f"logs: {exc!r}")
        self.evidence.append(
            "ready_checks", {"check": "teardown", "dropped": [what for what, _ in steps], "problems": problems}
        )
        path = self.evidence.write()
        if problems:
            pytest.fail("teardown left resources behind: " + "; ".join(problems))
        return path

    def _drop_database(self) -> None:
        assert DB_NAME.fullmatch(self.db)
        with self._admin() as admin:
            admin.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(self.db)))

    def _flush_redis(self) -> None:
        client = self._redis_client(self.redis_db)
        if client.get(REDIS_OWNER_KEY) != self.redis_token.encode():
            raise RuntimeError(f"Redis database {self.redis_db} is not owned by this session; not flushing it")
        client.flushdb()

    def _delete_vhost(self) -> None:
        assert VHOST_NAME.fullmatch(self.vhost)
        response = self.mgmt(f"vhosts/{urllib.parse.quote(self.vhost, safe='')}", method="DELETE")
        assert response.status in (204, 404), response.status
