import asyncio
import typing

from loguru import logger

from src.core import db


class Parser:
    def __init__(
        self,
        gatherer: typing.AsyncGenerator,
        func: typing.Callable,
        entity: str,
        *,
        count_workers: int = 1,
    ):
        self.gatherer = gatherer
        self.func = func
        self.count_workers = count_workers
        self.entity = entity
        self._queue: asyncio.Queue[typing.Any] = asyncio.Queue(
            maxsize=self.count_workers
        )

    async def start(self):
        await asyncio.gather(self.start_gatherer(), self.start_workers())

    async def start_gatherer(self):
        try:
            async for data in self.gatherer:
                await self._queue.put(data)
        except Exception as ex:
            logger.exception(ex)
        finally:
            for _ in range(self.count_workers):
                await self._queue.put({})

    async def start_workers(self):
        await asyncio.gather(
            *[asyncio.create_task(self.worker()) for _ in range(self.count_workers)]
        )

    async def worker(self):
        while True:
            task = await self._queue.get()
            if task == {}:
                return
            async with db.async_session_maker() as session:
                try:
                    await self.func(session, *task["args"], **task["kwargs"])
                except Exception as ex:
                    logger.exception(ex)
                    break
