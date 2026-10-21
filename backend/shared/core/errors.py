from pydantic import BaseModel

__all__ = (
    "ApiExc",
    "BaseAPIException",
    "ApiHTTPException",
)


class ApiExc(BaseModel):
    msg: str
    code: str
    #: The answer key (or schema path) the error is about, when there is one.
    field: str | None = None


class BaseAPIException(Exception):
    """Framework-neutral HTTP-ish error raised across the RPC + service layers.

    Mirrors the ``fastapi.HTTPException`` constructor (``status_code`` / ``detail``
    / ``headers``) so the RPC envelope helpers can map ``status_code`` to an error
    code (``status_to_code``) and flatten ``detail`` to a message — without the
    codebase importing FastAPI. RPC-path modules import this as ``HTTPException``
    (``from shared.core.errors import BaseAPIException as HTTPException``) so the
    existing ``raise HTTPException(...)`` / ``except HTTPException`` sites are
    drop-in unchanged.
    """

    def __init__(
        self,
        status_code: int,
        detail: object = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self.detail = detail
        self.headers = headers
        super().__init__(detail)


class ApiHTTPException(BaseAPIException):
    def __init__(
        self,
        status_code: int,
        detail: list[ApiExc],
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(
            status_code=status_code,
            detail=[e.model_dump(mode="json") for e in detail],
            headers=headers,
        )
