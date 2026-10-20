import re

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

__all__ = (
    "UserRegister",
    "UserLogin",
    "Token",
    "TokenPayload",
    "RefreshTokenRequest",
    "AuthUser",
    "UserUpdate",
)


class UserRegister(BaseModel):
    email: EmailStr
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=8, max_length=100)
    first_name: str | None = Field(None, max_length=100)
    last_name: str | None = Field(None, max_length=100)

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        if not re.match(r"^[a-zA-Z0-9_-]+$", v):
            raise ValueError("Username can only contain letters, numbers, underscores and hyphens")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not re.search(r"[a-z]", v):
            raise ValueError("Password must contain at least one lowercase letter")
        if not re.search(r"\d", v):
            raise ValueError("Password must contain at least one digit")
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    sub: int  # user_id
    email: str
    username: str
    is_superuser: bool = False
    exp: int | None = None


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class AuthUser(BaseModel):
    id: int
    email: str
    username: str
    first_name: str | None = None
    last_name: str | None = None
    is_active: bool
    is_superuser: bool
    is_verified: bool
    created_at: str
    updated_at: str | None = None

    model_config = ConfigDict(from_attributes=True)


class UserUpdate(BaseModel):
    first_name: str | None = Field(None, max_length=100)
    last_name: str | None = Field(None, max_length=100)
    email: EmailStr | None = None
