from passlib import pwd
from passlib.context import CryptContext
import typing
from datetime import datetime, timedelta, UTC

import jwt

password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_and_update_password(plain_password: str, hashed_password: str) -> tuple[bool, str]:
    hashed_password = hash_password(hashed_password)
    return password_context.verify_and_update(plain_password, hashed_password)  # type: ignore


def hash_password(password: str) -> str:
    return password_context.hash(password)


def generate_password() -> str:
    return pwd.genword()


def generate_jwt(
    data: dict,
    secret: str,
    lifetime_seconds: int | None = None,
) -> str:
    payload = data.copy()
    if lifetime_seconds:
        expire = datetime.now(UTC) + timedelta(seconds=lifetime_seconds)
        payload["exp"] = expire
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_jwt(
    encoded_jwt: str,
    secret: str,
    audience: list[str],
) -> dict[str, typing.Any]:
    return jwt.decode(
        encoded_jwt,
        secret,
        audience=audience,
        algorithms=["HS256"],
    )
