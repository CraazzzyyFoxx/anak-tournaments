"""Shared error-value builder for the draft domain and services.

``ApiHTTPException`` is a plain value (no I/O to build one), so this is a
domain-safe utility: both ``domain/draft/rules.py`` (validation) and
``services/draft/*.py`` (orchestration) raise these directly. All four
service modules previously carried a byte-identical private ``_err()``
copy; this is the single implementation each imports as ``_err``.
"""

from __future__ import annotations

from shared.core.errors import ApiExc, ApiHTTPException


def err(code: str, msg: str, *, status_code: int = 409) -> ApiHTTPException:
    return ApiHTTPException(status_code=status_code, detail=[ApiExc(code=code, msg=msg)])
