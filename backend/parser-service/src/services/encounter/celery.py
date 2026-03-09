import asyncio

from src.core.celery import celery

from . import tasks


@celery.task(max_retries=None, name="bulk_create_encounters")
def bulk_create_encounters():
    loop = asyncio.get_event_loop()
    loop.run_until_complete(tasks.bulk_create())
