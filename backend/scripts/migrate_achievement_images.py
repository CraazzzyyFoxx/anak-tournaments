"""Migrate achievement images from frontend/public/achievements/ to S3.

Uploads each .webp/.png file to assets/achievements/{slug}.{ext} and updates
the achievement.image_url column in the database.

Usage:
    cd backend/
    python -m scripts.migrate_achievement_images --frontend-dir ../frontend/public/achievements

Requires S3 env vars and DB connection via shared config.
"""

import asyncio
import mimetypes
from pathlib import Path

import click
import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.clients.s3 import S3Client
from shared.core.config import BaseServiceSettings

settings = BaseServiceSettings()


async def migrate(frontend_dir: Path) -> None:
    if not frontend_dir.is_dir():
        logger.error(f"Directory not found: {frontend_dir}")
        return

    # Initialize S3 client
    s3 = S3Client(
        access_key=settings.s3_access_key,
        secret_key=settings.s3_secret_key,
        endpoint_url=settings.s3_endpoint_url,
        bucket_name=settings.s3_bucket_name,
        public_url=settings.s3_public_url,
    )
    await s3.start()

    # Initialize DB
    engine = create_async_engine(settings.db_url_asyncpg)
    session_maker = async_sessionmaker(engine, expire_on_commit=False)

    image_files = sorted(
        p for p in frontend_dir.iterdir()
        if p.suffix in (".webp", ".png", ".jpg", ".jpeg", ".gif")
    )
    logger.info(f"Found {len(image_files)} image files in {frontend_dir}")

    uploaded = 0
    skipped = 0

    async with session_maker() as session:
        for image_path in image_files:
            slug = image_path.stem
            ext = image_path.suffix.lstrip(".")
            key = f"assets/achievements/{slug}.{ext}"

            # Check if already uploaded
            if await s3.object_exists(key):
                logger.debug(f"Already exists: {key}")
                skipped += 1
            else:
                content_type = mimetypes.guess_type(str(image_path))[0] or "image/webp"
                data = image_path.read_bytes()
                ok = await s3.put_object(key, data, content_type)
                if not ok:
                    logger.error(f"Failed to upload: {key}")
                    continue
                uploaded += 1

            # Update DB
            public_url = s3.get_public_url(key)
            await session.execute(
                sa.text(
                    "UPDATE achievements.achievement SET image_url = :url WHERE slug = :slug"
                ),
                {"url": public_url, "slug": slug},
            )

        await session.commit()

    await s3.close()
    await engine.dispose()

    logger.info(f"Done: {uploaded} uploaded, {skipped} already existed")


@click.command()
@click.option(
    "--frontend-dir",
    type=click.Path(exists=True, path_type=Path),
    default=Path(__file__).resolve().parent.parent.parent / "frontend" / "public" / "achievements",
    help="Path to frontend/public/achievements/ directory",
)
def main(frontend_dir: Path) -> None:
    asyncio.run(migrate(frontend_dir))


if __name__ == "__main__":
    main()
