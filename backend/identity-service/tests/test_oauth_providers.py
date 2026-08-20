import os
import sys
from pathlib import Path

import pytest

from shared.core.errors import BaseAPIException as HTTPException


def _ensure_test_env() -> None:
    env = {
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": "5432",
        "POSTGRES_DB": "auth_test",
        "POSTGRES_USER": "postgres",
        "POSTGRES_PASSWORD": "postgres",
        "JWT_SECRET_KEY": "test-secret",
        "DISCORD_CLIENT_ID": "discord-client",
        "DISCORD_CLIENT_SECRET": "discord-secret",
        "TWITCH_CLIENT_ID": "twitch-client",
        "TWITCH_CLIENT_SECRET": "twitch-secret",
        "BATTLENET_CLIENT_ID": "battlenet-client",
        "BATTLENET_CLIENT_SECRET": "battlenet-secret",
        "OAUTH_REDIRECT": "http://localhost:3000/auth/callback",
    }
    for key, value in env.items():
        os.environ.setdefault(key, value)


_ensure_test_env()

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.schemas.oauth import OAuthProvider  # noqa: E402
from src.services.oauth import oauth  # noqa: E402
from src.services.oauth_providers import OAuthProviderRegistry, oauth_providers  # noqa: E402


def test_get_available_providers_returns_only_enabled_and_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("src.services.oauth_providers.settings.DISCORD_OAUTH_ENABLED", True, raising=False)
    monkeypatch.setattr("src.services.oauth_providers.settings.TWITCH_OAUTH_ENABLED", False, raising=False)
    monkeypatch.setattr("src.services.oauth_providers.settings.BATTLENET_OAUTH_ENABLED", True, raising=False)
    monkeypatch.setattr("src.services.oauth_providers.settings.BATTLENET_CLIENT_ID", None, raising=False)

    providers = oauth_providers.available()

    assert providers == [OAuthProvider.DISCORD]


def test_get_provider_raises_not_found_when_provider_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("src.services.oauth_providers.settings.TWITCH_OAUTH_ENABLED", False, raising=False)

    with pytest.raises(HTTPException) as exc_info:
        oauth_providers.get("twitch")

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "OAuth provider 'twitch' is disabled"


def test_get_provider_rejects_an_unknown_provider_name() -> None:
    """An unknown name is a bad request, not a disabled provider: there is no
    enable flag to consult, so it can never become available."""
    with pytest.raises(HTTPException) as exc_info:
        oauth_providers.get("myspace")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Unsupported OAuth provider: myspace"


def test_list_oauth_providers_route_returns_enabled_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("src.services.oauth_providers.settings.DISCORD_OAUTH_ENABLED", True, raising=False)
    monkeypatch.setattr("src.services.oauth_providers.settings.TWITCH_OAUTH_ENABLED", False, raising=False)
    monkeypatch.setattr("src.services.oauth_providers.settings.BATTLENET_OAUTH_ENABLED", True, raising=False)
    monkeypatch.setattr("src.services.oauth_providers.settings.OAUTH_REDIRECT", "http://localhost:3000/auth/callback")

    response = oauth.list_providers()

    assert [item.provider for item in response] == [OAuthProvider.DISCORD, OAuthProvider.BATTLENET]


def test_get_provider_returns_provider_when_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("src.services.oauth_providers.settings.DISCORD_OAUTH_ENABLED", True)
    monkeypatch.setattr("src.services.oauth_providers.settings.OAUTH_REDIRECT", "http://localhost:3000/auth/callback")

    provider = oauth_providers.get("discord")

    assert provider.provider_name == "discord"


def test_all_providers_use_shared_oauth_redirect_setting() -> None:
    redirect_settings = {config["redirect_uri"] for config in OAuthProviderRegistry.PROVIDER_SETTINGS.values()}

    assert redirect_settings == {"OAUTH_REDIRECT"}


def test_list_available_oauth_providers_top_level_route_returns_enabled_providers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("src.services.oauth_providers.settings.DISCORD_OAUTH_ENABLED", True)
    monkeypatch.setattr("src.services.oauth_providers.settings.TWITCH_OAUTH_ENABLED", False)
    monkeypatch.setattr("src.services.oauth_providers.settings.BATTLENET_OAUTH_ENABLED", True)
    monkeypatch.setattr("src.services.oauth_providers.settings.OAUTH_REDIRECT", "http://localhost:3000/auth/callback")

    response = oauth.list_providers()

    assert [item.provider for item in response] == [OAuthProvider.DISCORD, OAuthProvider.BATTLENET]


def test_twitch_authorize_url_requests_the_subscriptions_scope() -> None:
    """The subscription-entitlement module calls Helix
    ``GET /subscriptions/user`` with the patron's own token, which requires
    ``user:read:subscriptions``. Dropping this scope makes every Twitch verdict
    resolve as ``unknown`` (fail-open), silently disabling the gate.

    Reads the registry directly (as ``PROVIDER_SETTINGS`` is read above) so the
    assertion is independent of the enable flags other tests monkeypatch.
    """
    url = oauth_providers.providers["twitch"].get_authorization_url("state-123")

    assert "user%3Aread%3Asubscriptions" in url


def test_twitch_authorize_url_keeps_the_email_scope() -> None:
    """``user:read:email`` predates this feature and the callback still reads
    ``email`` off the profile; adding a scope must not drop it."""
    url = oauth_providers.providers["twitch"].get_authorization_url("state-123")

    assert "user%3Aread%3Aemail" in url
