"""Publish one discipline-owned image to object storage (operator CLI).

The source must live under ``frontend/public/disciplines/<discipline>/`` of an installed discipline and the key under
``assets/<discipline>/``: the two forms ``shared.domain.roles.validate_presentation`` accepts for a role icon besides
``https://`` URLs. Without ``--publish`` the file is only inspected and nothing is uploaded. A published receipt is
printed only after the upload succeeded **and** the public URL served back the exact bytes.

Usage (from ``backend/``)::

    uv run python scripts/publish_discipline_assets.py --discipline overwatch \\
        --file ../frontend/public/disciplines/overwatch/roles/tank.svg \\
        --key assets/overwatch/roles/tank.svg            # inspect only
    uv run python scripts/publish_discipline_assets.py ... --publish
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

import click
import httpx
from pydantic_settings import SettingsConfigDict

from shared.clients.s3 import MAX_ASSET_SIZE, S3Client
from shared.core.config import BaseServiceSettings
from shared.disciplines import DISCIPLINES

_BACKEND = Path(__file__).resolve().parent.parent
ASSET_ROOT = _BACKEND.parent / "frontend" / "public" / "disciplines"
MIME_BY_SUFFIX = {".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp"}
_UNSAFE_SVG = re.compile(rb"<script|javascript:|<foreignObject|\bon[a-z]+\s*=", re.IGNORECASE)


class AssetError(Exception):
    """The request is refused or the publication did not complete; the CLI exits nonzero."""


@dataclass(frozen=True)
class Asset:
    discipline: str
    source: Path
    key: str
    mime: str
    data: bytes

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()


def _sniff(suffix: str, data: bytes) -> bool:
    if suffix == ".png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if suffix == ".webp":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return b"<svg" in data and not _UNSAFE_SVG.search(data)


def load_asset(discipline: str, file: Path, key: str, *, root: Path | None = None) -> Asset:
    if discipline not in DISCIPLINES:
        raise AssetError(f"discipline {discipline!r} is not installed")
    module_dir = ((root or ASSET_ROOT) / discipline).resolve()
    source = Path(file).resolve()
    if not source.is_relative_to(module_dir):
        raise AssetError(f"{file} is outside the {discipline} asset directory {module_dir}")
    if not source.is_file():
        raise AssetError(f"{source} is not a file")
    suffix = source.suffix.lower()
    mime = MIME_BY_SUFFIX.get(suffix)
    if mime is None:
        raise AssetError(f"unsupported image type {suffix!r}; allowed: {', '.join(MIME_BY_SUFFIX)}")
    if not re.fullmatch(rf"assets/{re.escape(discipline)}/[a-z0-9_-]+(/[a-z0-9_-]+)*\.(svg|png|webp)", key):
        raise AssetError(f"key {key!r} must match assets/{discipline}/<path>.<svg|png|webp>")
    if not key.endswith(suffix):
        raise AssetError(f"key {key!r} extension differs from the source {suffix!r}")
    data = source.read_bytes()
    if not 0 < len(data) <= MAX_ASSET_SIZE:
        raise AssetError(f"{source} must be 1..{MAX_ASSET_SIZE} bytes, got {len(data)}")
    if not _sniff(suffix, data):
        raise AssetError(f"{source} content is not a safe {mime} image")
    return Asset(discipline, source, key, mime, data)


async def fetch_public(url: str) -> bytes:
    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as http:
        response = await http.get(url)
        response.raise_for_status()
        return response.content


async def publish(
    client: S3Client,
    asset: Asset,
    fetch: Callable[[str], Awaitable[bytes]] | None = None,
) -> str:
    """Upload through ``client`` and prove the public URL serves the same bytes; returns that URL."""
    if not await client.put_object(asset.key, asset.data, asset.mime, public=True):
        raise AssetError(f"upload of {asset.key} failed")
    try:
        url = client.get_public_url(asset.key)
    except ValueError as exc:
        raise AssetError(f"{asset.key} uploaded but no public URL is configured: {exc}") from exc
    try:
        served = await (fetch or fetch_public)(url)
    except httpx.HTTPError as exc:
        raise AssetError(f"{asset.key} uploaded but {url} is not publicly readable: {exc}") from exc
    if hashlib.sha256(served).hexdigest() != asset.sha256:
        raise AssetError(f"{asset.key} uploaded but {url} served different bytes")
    return url


class _ScriptSettings(BaseServiceSettings):
    model_config = SettingsConfigDict(
        env_file=(str(_BACKEND / "env" / "common.env"), ".env", ".env.prod"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


async def _run(asset: Asset, do_publish: bool) -> None:
    describe = f"key={asset.key} mime={asset.mime} sha256={asset.sha256} bytes={len(asset.data)}"
    if not do_publish:
        click.echo(f"inspect-only (nothing uploaded): {describe}")
        return
    try:
        client = S3Client.from_settings(_ScriptSettings())
    except ValueError as exc:
        raise AssetError(str(exc)) from exc
    await client.start()
    try:
        url = await publish(client, asset)
    finally:
        await client.close()
    click.echo(f"published: {describe} url={url}")


@click.command()
@click.option("--discipline", required=True, help="Installed discipline code owning the asset.")
@click.option(
    "--file", "file", required=True, type=click.Path(path_type=Path), help="Source under the module's asset dir."
)
@click.option("--key", required=True, help="Object key, assets/<discipline>/<path>.<svg|png|webp>.")
@click.option("--publish", "do_publish", is_flag=True, help="Upload and verify; default is inspect-only.")
def main(discipline: str, file: Path, key: str, do_publish: bool) -> None:
    try:
        asyncio.run(_run(load_asset(discipline, file, key), do_publish))
    except AssetError as exc:
        click.echo(f"error: {exc}", err=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
