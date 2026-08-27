"""Unified test-environment defaults for every backend service.

Every service's ``Settings`` extends ``BaseServiceSettings``, which requires
``POSTGRES_*``/``PROJECT_URL``/``REDIS_URL`` (plus whatever fields the service
itself adds) just to *construct* -- before a test ever imports ``src.core.db``
or ``src.core.config``, those env vars must already exist. Every service used
to hand-roll an identical block of ``os.environ.setdefault(...)`` calls (some
services with an inline ``sys.path.insert`` alongside it) at the top of nearly
every test file. Call :func:`apply_test_env_defaults` once, from each
service's ``tests/conftest.py`` -- conftest.py always imports before sibling
test modules in the same directory, so the environment is ready before any
test module runs its own top-level imports.

``os.environ.setdefault`` never overrides a real environment / loaded ``.env``
value, so this is safe to call even against a fully configured dev environment
or CI job that injects real secrets.

Deliberately excluded: ``DEBUG``. Different suites pin it to different values
on purpose (some force ``"false"`` to avoid debug-only branches, others rely
on the default ``"true"``); that is test-specific behavior, not connectivity
plumbing, so each file keeps setting it explicitly.
"""

from __future__ import annotations

import os

#: Superset of every env var some service's ``Settings`` needs to construct,
#: or that its imported modules read at import time. Harmless to default vars
#: a given service doesn't declare -- pydantic-settings (``extra="ignore"``)
#: only reads the fields the service's ``Settings`` actually defines.
_DEFAULTS: dict[str, str] = {
    # Common to every service (BaseServiceSettings).
    "PROJECT_URL": "http://localhost",
    "REDIS_URL": "redis://localhost:6379/0",
    "RABBITMQ_URL": "amqp://guest:guest@localhost:5672",
    "POSTGRES_USER": "postgres",
    "POSTGRES_PASSWORD": "postgres",
    "POSTGRES_DB": "postgres",
    "POSTGRES_HOST": "localhost",
    "POSTGRES_PORT": "5432",
    # S3 / MinIO (app-service, analytics-service, parser-service, ...).
    "S3_ACCESS_KEY": "test",
    "S3_SECRET_KEY": "test",
    "S3_ENDPOINT_URL": "http://localhost",
    "S3_BUCKET_NAME": "test",
    # Challonge sync (app-service, tournament-service).
    "CHALLONGE_USERNAME": "test",
    "CHALLONGE_API_KEY": "test",
    # identity-service OAuth providers + JWT.
    "JWT_SECRET_KEY": "test-secret",
    "DISCORD_CLIENT_ID": "discord-client",
    "DISCORD_CLIENT_SECRET": "discord-secret",
    "TWITCH_CLIENT_ID": "twitch-client",
    "TWITCH_CLIENT_SECRET": "twitch-secret",
    "BATTLENET_CLIENT_ID": "battlenet-client",
    "BATTLENET_CLIENT_SECRET": "battlenet-secret",
    "OAUTH_REDIRECT": "http://localhost:3000/auth/callback",
    # discord-service: bot token + gateway service-to-service client creds.
    "DISCORD_TOKEN": "dummy_token",
    "PARSER_URL": "http://parser:8002",
    "SERVICE_CLIENT_ID": "dummy_id",
    "SERVICE_CLIENT_SECRET": "dummy_secret",
}


def apply_test_env_defaults(**overrides: str) -> None:
    """Seed ``os.environ`` with test defaults for every service's ``Settings``.

    ``overrides`` lets a service/file pin a value beyond the shared defaults
    (or override one) without hand-rolling the whole block again::

        apply_test_env_defaults(POSTGRES_DB="anak_dev")
    """
    for key, value in {**_DEFAULTS, **overrides}.items():
        os.environ.setdefault(key, value)
