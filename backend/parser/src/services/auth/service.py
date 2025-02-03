import jwt

from fastapi.security import OAuth2PasswordRequestForm

from src.core import config

from . import utils


async def authenticate(credentials: OAuth2PasswordRequestForm) -> bool:
    if credentials.username.lower() != config.app.super_user_email:
        utils.hash_password(credentials.password)
        return False

    verified, updated_password_hash = utils.verify_and_update_password(
        credentials.password, config.app.super_user_password
    )
    return verified


async def verify_access_token(token: str | None) -> bool:
    if token is None:
        return False
    try:
        data = utils.decode_jwt(
            token,
            config.app.access_token_secret,
            ["aqt_parser"],
        )
        email = data["sub"]  # noqa
    except jwt.PyJWTError:
        return False

    return True


async def create_access_token() -> str:
    token_data = {
        "sub": config.app.super_user_email,
        "aud": "aqt_parser",
    }
    access_token = utils.generate_jwt(
        token_data, config.app.access_token_secret, 24 * 3600 * 7
    )
    return access_token
