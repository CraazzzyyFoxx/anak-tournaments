"""Error-value builder shared by the draft domain and services.

``ApiHTTPException`` is a plain value (no I/O to build one), so the domain may
raise it: ``domain/draft/rules.py`` validates with it and ``services/draft/*``
import it as ``_err``.
"""

from __future__ import annotations

from shared.core.errors import ApiExc, ApiHTTPException


def err(code: str, msg: str, *, status_code: int = 409) -> ApiHTTPException:
    return ApiHTTPException(status_code=status_code, detail=[ApiExc(code=code, msg=msg)])
