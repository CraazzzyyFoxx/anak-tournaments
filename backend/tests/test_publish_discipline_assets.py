"""The discipline asset publisher: containment, inspect-only, and a receipt only for a verified publication.

The S3Client is replaced by a recording fake at its seam; the HTTP read of the public URL is injected. Real publication
evidence needs a real bucket and is not claimed here.
"""

from __future__ import annotations

import asyncio
import hashlib
import re

import pytest
from click.testing import CliRunner

from scripts import publish_discipline_assets as pub
from shared.clients.s3 import S3Client
from shared.disciplines import DISCIPLINES

SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><path d="M0 0h40v40z"/></svg>'
)
KEY = "assets/overwatch/roles/tank.svg"


@pytest.fixture
def root(tmp_path):
    (tmp_path / "overwatch" / "roles").mkdir(parents=True)
    (tmp_path / "lol").mkdir()
    (tmp_path / "overwatch" / "roles" / "tank.svg").write_bytes(SVG)
    (tmp_path / "outside.svg").write_bytes(SVG)
    return tmp_path


def _load(root, file="overwatch/roles/tank.svg", key=KEY, discipline="overwatch"):
    return pub.load_asset(discipline, root / file, key, root=root)


class FakeS3:
    def __init__(self, *, ok=True, public="https://cdn.example/aqt"):
        self.ok, self.public, self.puts = ok, public, []

    async def start(self):
        pass

    async def close(self):
        pass

    async def put_object(self, key, data, content_type="application/octet-stream", *, public=False):
        self.puts.append((key, data, content_type, public))
        return self.ok

    def get_public_url(self, key):
        if self.public is None:
            raise ValueError("S3Client.public_url is not configured")
        return f"{self.public}/{key}"


@pytest.mark.parametrize(
    ("file", "key", "discipline"),
    [
        ("outside.svg", KEY, "overwatch"),  # outside the module dir
        ("overwatch/../outside.svg", KEY, "overwatch"),  # traversal
        ("overwatch/roles/tank.svg", "assets/lol/roles/tank.svg", "overwatch"),  # another discipline's keys
        ("overwatch/roles/tank.svg", "assets/overwatch/../lol/tank.svg", "overwatch"),
        ("overwatch/roles/tank.svg", "avatars/tank.svg", "overwatch"),
        ("overwatch/roles/tank.svg", "assets/overwatch/roles/tank.png", "overwatch"),  # extension mismatch
        ("overwatch/roles/tank.svg", KEY, "lol"),  # source is another module's
        ("dota/icon.svg", "assets/dota/icon.svg", "dota"),  # no asset directory
        ("overwatch/roles/tank.svg", "assets/../overwatch/roles/tank.svg", ".."),  # not a discipline code
    ],
)
def test_source_and_key_containment(root, file, key, discipline):
    with pytest.raises(pub.AssetError):
        _load(root, file, key, discipline)


def test_the_next_game_publishes_before_its_module_lands(root):
    (root / "deadlock").mkdir()
    (root / "deadlock" / "icon.svg").write_bytes(SVG)
    asset = _load(root, "deadlock/icon.svg", "assets/deadlock/icon.svg", "deadlock")
    assert (asset.discipline, asset.key) == ("deadlock", "assets/deadlock/icon.svg")


def test_every_installed_game_icon_is_a_shipped_publishable_asset():
    for code, spec in DISCIPLINES.items():
        assert spec.icon is not None and spec.icon.startswith(f"assets/{code}/"), code
        pub.load_asset(code, pub.ASSET_ROOT / code / spec.icon.removeprefix(f"assets/{code}/"), spec.icon)


def test_rejects_unsupported_type_and_unsafe_or_mislabelled_content(root):
    (root / "overwatch" / "a.gif").write_bytes(b"GIF89a")
    (root / "overwatch" / "evil.svg").write_bytes(b'<svg onload="x()"></svg>')
    (root / "overwatch" / "fake.png").write_bytes(SVG)
    for name in ("a.gif", "evil.svg", "fake.png"):
        with pytest.raises(pub.AssetError):
            _load(root, f"overwatch/{name}", f"assets/overwatch/{name}")


def test_inspect_only_never_builds_a_client_or_uploads(root, monkeypatch):
    def boom(*_a, **_k):
        raise AssertionError("inspect-only must not touch storage")

    monkeypatch.setattr(S3Client, "from_settings", boom)
    monkeypatch.setattr(pub, "ASSET_ROOT", root)
    result = CliRunner().invoke(
        pub.main, ["--discipline", "overwatch", "--file", str(root / "overwatch/roles/tank.svg"), "--key", KEY]
    )
    assert result.exit_code == 0, result.output
    assert "inspect-only (nothing uploaded)" in result.output
    assert hashlib.sha256(SVG).hexdigest() in result.output
    assert "published" not in result.output
    assert "http" not in result.output


def test_publish_passes_exact_bytes_and_mime_and_returns_verified_url(root):
    asset, s3, fetched = _load(root), FakeS3(), []

    async def fetch(url):
        fetched.append(url)
        return SVG

    url = asyncio.run(pub.publish(s3, asset, fetch))
    assert s3.puts == [(KEY, SVG, "image/svg+xml", True)]
    assert url == fetched[0] == f"https://cdn.example/aqt/{KEY}"


def test_failed_upload_is_an_error_without_public_read(root):
    async def fetch(_url):
        raise AssertionError("must not verify an upload that failed")

    with pytest.raises(pub.AssetError, match="upload"):
        asyncio.run(pub.publish(FakeS3(ok=False), _load(root), fetch))


def test_public_byte_mismatch_or_unreadable_url_is_an_error(root):
    async def other(_url):
        return SVG + b" "

    with pytest.raises(pub.AssetError, match="different bytes"):
        asyncio.run(pub.publish(FakeS3(), _load(root), other))

    async def missing(_url):
        raise pub.httpx.HTTPError("404")

    with pytest.raises(pub.AssetError, match="not publicly readable"):
        asyncio.run(pub.publish(FakeS3(), _load(root), missing))
    with pytest.raises(pub.AssetError, match="no public URL"):
        asyncio.run(pub.publish(FakeS3(public=None), _load(root), other))


def _invoke_publish(root, monkeypatch, s3, fetch):
    monkeypatch.setattr(S3Client, "from_settings", lambda _settings: s3)
    monkeypatch.setattr(pub, "_ScriptSettings", lambda: None)
    monkeypatch.setattr(pub, "ASSET_ROOT", root)
    monkeypatch.setattr(pub, "fetch_public", fetch)
    return CliRunner().invoke(
        pub.main,
        ["--discipline", "overwatch", "--file", str(root / "overwatch/roles/tank.svg"), "--key", KEY, "--publish"],
    )


def test_cli_prints_receipt_only_for_verified_publication(root, monkeypatch):
    async def good(_url):
        return SVG

    ok = _invoke_publish(root, monkeypatch, FakeS3(), good)
    assert ok.exit_code == 0, ok.output
    assert re.search(rf"published: key={KEY} mime=image/svg\+xml sha256={hashlib.sha256(SVG).hexdigest()}", ok.output)
    assert f"url=https://cdn.example/aqt/{KEY}" in ok.output

    failed = _invoke_publish(root, monkeypatch, FakeS3(ok=False), good)
    assert failed.exit_code != 0
    assert "published" not in failed.output


def test_shipped_overwatch_role_artwork_is_publishable_and_fixed_size():
    for role in ("tank", "damage", "support"):
        for suffix in ("svg", "png"):
            asset = pub.load_asset(
                "overwatch",
                pub.ASSET_ROOT / "overwatch" / "roles" / f"{role}.{suffix}",
                f"assets/overwatch/roles/{role}.{suffix}",
            )
            if suffix == "svg":
                head = asset.data.decode()
                assert 'viewBox="0 0 40 40"' in head and 'width="40"' in head and 'height="40"' in head
