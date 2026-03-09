from fastapi import HTTPException
from pydantic import BaseModel, ValidationError


class ApiExc(BaseModel):
    msg: str
    code: str


class ApiHTTPException(HTTPException):
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


class ValidationErrorDetail(BaseModel):
    location: str
    message: str
    error_type: str


class APIValidationError(BaseModel):
    errors: list[ValidationErrorDetail]

    @classmethod
    def from_pydantic(cls, exc: ValidationError) -> "APIValidationError":
        return cls(
            errors=[
                ValidationErrorDetail(
                    location=" -> ".join(map(str, err["loc"])),
                    message=str(err["msg"]),
                    error_type=str(err["type"]),
                )
                for err in exc.errors()
            ],
        )
