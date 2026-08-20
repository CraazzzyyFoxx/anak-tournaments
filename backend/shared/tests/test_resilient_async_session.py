"""``ResilientAsyncSession`` teardown must not replace the real failure.

``statement_timeout`` (and a pooler dropping a connection mid-transaction) leaves
the asyncpg socket closed. The session's exit path then emits ``ROLLBACK`` on the
dead socket, and the resulting ``InterfaceError: cannot call
Transaction.rollback(): the underlying connection is closed`` escapes from
``__aexit__`` -- which in production accounted for 2675 Sentry events, all of them
naming the ``async with`` line rather than whatever actually broke.

Nothing there is recoverable: the transaction died with the connection. These
tests pin that a gone-connection teardown is absorbed (and the session state
discarded) while any *other* teardown failure still propagates.
"""

from __future__ import annotations

from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

from sqlalchemy.exc import InterfaceError, ProgrammingError

from shared.core.db import ResilientAsyncSession, _connection_already_gone


class _AsyncpgInterfaceError(Exception):
    """Stand-in for ``asyncpg.exceptions._base.InterfaceError``."""


def _closed_connection_error() -> InterfaceError:
    return InterfaceError(
        "ROLLBACK",
        None,
        _AsyncpgInterfaceError("cannot call Transaction.rollback(): the underlying connection is closed"),
    )


class ConnectionGoneDetectionTests(IsolatedAsyncioTestCase):
    def test_matches_driver_closed_connection_message(self) -> None:
        self.assertTrue(_connection_already_gone(_closed_connection_error()))

    def test_matches_invalidated_connection(self) -> None:
        exc = ProgrammingError("SELECT 1", None, _AsyncpgInterfaceError("something else"))
        exc.connection_invalidated = True
        self.assertTrue(_connection_already_gone(exc))

    def test_rejects_unrelated_driver_error(self) -> None:
        exc = ProgrammingError("SELECT 1", None, _AsyncpgInterfaceError('column "x" does not exist'))
        self.assertFalse(_connection_already_gone(exc))


class ResilientCloseTests(IsolatedAsyncioTestCase):
    async def test_absorbs_rollback_on_a_dead_connection_and_discards_state(self) -> None:
        session = ResilientAsyncSession()
        invalidate = AsyncMock()

        with (
            patch("sqlalchemy.ext.asyncio.AsyncSession.close", side_effect=_closed_connection_error()),
            patch.object(ResilientAsyncSession, "invalidate", invalidate),
        ):
            await session.close()

        invalidate.assert_awaited_once()

    async def test_async_with_exit_does_not_mask_the_original_error(self) -> None:
        """The regression: the caller's own exception must survive teardown."""
        with (
            patch("sqlalchemy.ext.asyncio.AsyncSession.close", side_effect=_closed_connection_error()),
            patch.object(ResilientAsyncSession, "invalidate", AsyncMock()),
            self.assertRaises(ZeroDivisionError),
        ):
            async with ResilientAsyncSession():
                raise ZeroDivisionError("the real failure")

    async def test_reraises_a_teardown_failure_that_is_not_a_dead_connection(self) -> None:
        boom = ProgrammingError("ROLLBACK", None, _AsyncpgInterfaceError("syntax error"))

        with (
            patch("sqlalchemy.ext.asyncio.AsyncSession.close", side_effect=boom),
            self.assertRaises(ProgrammingError),
        ):
            await ResilientAsyncSession().close()

    async def test_a_healthy_close_is_left_alone(self) -> None:
        close = AsyncMock()

        with patch("sqlalchemy.ext.asyncio.AsyncSession.close", close):
            await ResilientAsyncSession().close()

        close.assert_awaited_once()
