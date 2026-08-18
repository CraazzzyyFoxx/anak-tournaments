"""Shared error-response builder for the draft services.

``lifecycle``, ``selection``, ``export``, and ``role_edit`` each raise
``ApiHTTPException`` inline (the caller's HTTP status IS the outcome of these
synchronous request/response calls -- see module docstrings). All four
previously carried a byte-identical private ``_err()`` copy; this is the
single implementation each module imports as ``_err``.
"""

from __future__ import annotations

from shared.core.errors import ApiExc, ApiHTTPException


def err(code: str, msg: str, *, status_code: int = 409) -> ApiHTTPException:
    return ApiHTTPException(status_code=status_code, detail=[ApiExc(code=code, msg=msg)])
