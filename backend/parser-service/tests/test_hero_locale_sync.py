from __future__ import annotations

import importlib
import inspect
import os
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase, mock
from urllib.parse import parse_qs, urlparse

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))

os.environ["DEBUG"] = "true"
os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

models = importlib.import_module("src.models")
hero_flows = importlib.import_module("src.services.hero.flows")

# Two heroes, three of the thirteen locales carrying a distinct name; every
# other locale falls back to the canonical spelling, exactly like OverFast does
# for names Blizzard does not localise (e.g. "Genji" in de-de).
LOCALIZED_NAMES: dict[str, dict[str, str]] = {
    "ana": {"en-us": "Ana", "ru-ru": "Ана", "ja-jp": "アナ", "ko-kr": "아나"},
    "genji": {"en-us": "Genji", "ru-ru": "Гэндзи", "ja-jp": "ゲンジ"},
}
ROLES = {"ana": "support", "genji": "damage"}


class _FakeResponse:
    def __init__(self, payload: list[dict[str, str]]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> list[dict[str, str]]:
        return self._payload


class _RecordingClient:
    """Stand-in for ``httpx.AsyncClient`` that records every requested URL."""

    def __init__(self, urls: list[str]) -> None:
        self._urls = urls

    async def __aenter__(self) -> _RecordingClient:
        return self

    async def __aexit__(self, *_: object) -> bool:
        return False

    async def get(self, url: str) -> _FakeResponse:
        self._urls.append(url)
        locale = parse_qs(urlparse(url).query)["locale"][0]
        return _FakeResponse(
            [
                {
                    "key": key,
                    "name": names.get(locale, names["en-us"]),
                    "portrait": f"https://cdn/{key}.png",
                    "role": ROLES[key],
                }
                for key, names in LOCALIZED_NAMES.items()
            ]
        )


class _FakeSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.commits = 0

    def add_all(self, objects: list[object]) -> None:
        self.added.extend(objects)

    async def commit(self) -> None:
        self.commits += 1


class HeroLocaleSyncTests(IsolatedAsyncioTestCase):
    def test_all_thirteen_blizzard_locales_are_covered(self) -> None:
        self.assertEqual(
            {
                "de-de",
                "en-gb",
                "en-us",
                "es-es",
                "es-mx",
                "fr-fr",
                "it-it",
                "ja-jp",
                "ko-kr",
                "pl-pl",
                "pt-br",
                "ru-ru",
                "zh-tw",
            },
            {hero_flows.CANONICAL_LOCALE, *hero_flows.ALIAS_LOCALES},
        )
        self.assertNotIn(hero_flows.CANONICAL_LOCALE, hero_flows.ALIAS_LOCALES)
        self.assertEqual(12, len(hero_flows.ALIAS_LOCALES), "no duplicate alias locales")

    def test_the_request_is_keyed_on_locale_not_role(self) -> None:
        # Scoped to the request line, not the whole body: the surrounding comment
        # legitimately explains why the `role` filter went away.
        request_line = next(
            line for line in inspect.getsource(hero_flows.fetch_heroes).splitlines() if "client.get(" in line
        )
        self.assertIn("locale={locale}", request_line)
        self.assertNotIn("role=", request_line)

    def test_aliases_union_existing_and_exclude_the_canonical_name(self) -> None:
        merged = hero_flows.merge_aliases(existing=["Ана"], localized={"Ana", "アナ", "Ана"}, canonical="Ana")
        self.assertEqual(["Ана", "アナ"], merged)

    def test_a_manual_alias_survives_a_sync(self) -> None:
        merged = hero_flows.merge_aliases(existing=["Анка"], localized={"Ана"}, canonical="Ana")
        self.assertIn("Анка", merged)

    async def test_fetch_heroes_requests_the_locale_endpoint(self) -> None:
        urls: list[str] = []
        with mock.patch("httpx.AsyncClient", lambda **_: _RecordingClient(urls)):
            heroes = await hero_flows.fetch_heroes("ru-ru")

        self.assertEqual(1, len(urls))
        self.assertTrue(urls[0].endswith("/heroes?locale=ru-ru"), urls[0])
        self.assertEqual(["Ана", "Гэндзи"], [hero.name for hero in heroes])

    async def test_initial_create_hits_every_locale_exactly_once(self) -> None:
        urls: list[str] = []
        session = _FakeSession()
        with (
            mock.patch("httpx.AsyncClient", lambda **_: _RecordingClient(urls)),
            mock.patch.object(hero_flows.service, "get_by_slugs", mock.AsyncMock(return_value={})),
        ):
            await hero_flows.initial_create(session)  # type: ignore[arg-type]

        self.assertEqual(13, len(urls), f"one round-trip per Blizzard locale, got {urls}")
        self.assertEqual(
            {f"?locale={locale}" for locale in (hero_flows.CANONICAL_LOCALE, *hero_flows.ALIAS_LOCALES)},
            {url[url.index("?") :] for url in urls},
        )
        self.assertEqual(hero_flows.CANONICAL_LOCALE, parse_qs(urlparse(urls[0]).query)["locale"][0])

    async def test_initial_create_creates_new_heroes_with_localized_aliases(self) -> None:
        urls: list[str] = []
        session = _FakeSession()
        with (
            mock.patch("httpx.AsyncClient", lambda **_: _RecordingClient(urls)),
            mock.patch.object(hero_flows.service, "get_by_slugs", mock.AsyncMock(return_value={})),
        ):
            await hero_flows.initial_create(session)  # type: ignore[arg-type]

        created = {hero.slug: hero for hero in session.added}
        self.assertEqual({"ana", "genji"}, set(created))
        self.assertEqual("Ana", created["ana"].name)
        self.assertEqual("support", created["ana"].type)
        self.assertEqual("https://cdn/ana.png", created["ana"].image_path)
        self.assertEqual(["Ана", "アナ", "아나"], created["ana"].aliases)
        self.assertNotIn("Ana", created["ana"].aliases, "canonical name never lands in aliases")

    async def test_initial_create_refreshes_aliases_of_existing_heroes_without_touching_the_rest(self) -> None:
        existing = models.Hero(
            slug="ana",
            name="Ana (stale)",
            image_path="https://cdn/old-ana.png",
            type="support",  # type: ignore[arg-type]
            aliases=["Анка"],
        )
        urls: list[str] = []
        session = _FakeSession()
        with (
            mock.patch("httpx.AsyncClient", lambda **_: _RecordingClient(urls)),
            mock.patch.object(hero_flows.service, "get_by_slugs", mock.AsyncMock(return_value={"ana": existing})),
        ):
            await hero_flows.initial_create(session)  # type: ignore[arg-type]

        # Pre-existing row is not re-inserted and keeps its own columns.
        self.assertEqual(["genji"], [hero.slug for hero in session.added])
        self.assertEqual("Ana (stale)", existing.name)
        self.assertEqual("https://cdn/old-ana.png", existing.image_path)
        # The hand-added alias survives, the localisations are appended, and the
        # canonical OverFast name is excluded.
        self.assertEqual(["Ana", "Ана", "Анка", "アナ", "아나"], existing.aliases)
        self.assertGreaterEqual(session.commits, 1)
