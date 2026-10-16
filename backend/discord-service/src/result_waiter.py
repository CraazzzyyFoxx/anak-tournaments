"""Pre-publication rendezvous keyed by the upload event's correlation id."""

import asyncio

from shared.schemas.events import MatchLogProcessedEvent


class ResultWaiter:
    def __init__(self, timeout: float) -> None:
        self._timeout = timeout
        self._pending: dict[str, asyncio.Future[MatchLogProcessedEvent]] = {}

    def register(self, correlation_id: str) -> asyncio.Future[MatchLogProcessedEvent]:
        if correlation_id in self._pending:
            raise ValueError("upload correlation is already registered")
        future = asyncio.get_running_loop().create_future()
        self._pending[correlation_id] = future
        return future

    async def wait(self, correlation_id: str) -> MatchLogProcessedEvent | None:
        future = self._pending[correlation_id]
        try:
            return await asyncio.wait_for(future, timeout=self._timeout)
        except TimeoutError:
            return None
        finally:
            self.cancel(correlation_id)

    def cancel(self, correlation_id: str) -> None:
        future = self._pending.pop(correlation_id, None)
        if future is not None and not future.done():
            future.cancel()

    def resolve(self, event: MatchLogProcessedEvent) -> None:
        if event.correlation_id is None:
            return
        future = self._pending.get(event.correlation_id)
        if future is not None and not future.done():
            # Keep it registered until wait() consumes it: a result may arrive
            # inside publish(), before the uploader has started awaiting.
            future.set_result(event)
