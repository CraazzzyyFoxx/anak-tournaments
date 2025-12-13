from pydantic import BaseModel


__all__ = (
    "HealthCheckResponse",
)


class HealthCheckResponse(BaseModel):
    timestamp: int
    status: str
    service: str
    version: str