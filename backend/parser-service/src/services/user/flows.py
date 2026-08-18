import re

from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import config


def _usernames(player: models.User, provider: str) -> list[str]:
    """Usernames the player already has for a provider (from the unified table)."""
    return [a.username for a in player.social_accounts if a.provider == provider]


battle_tag_validator = re.compile(config.settings.battle_tag_regex, re.UNICODE)


_IDENTITY_ENTITIES = ("social_accounts", "battle_tag", "discord", "twitch")


async def to_pydantic(session: AsyncSession, user: models.User, entities: list[str]) -> schemas.UserRead:
    """Convert a ``User`` to ``UserRead``. Identities come from the unified
    ``user.social_accounts`` relationship and are only accessed when an identity
    entity was requested (and therefore eager-loaded), so this never triggers a
    lazy load outside the async greenlet. Legacy entity tokens are still honored.
    """
    social_accounts: list[schemas.SocialAccountRead] = []
    if any(name in entities for name in _IDENTITY_ENTITIES):
        social_accounts = [
            schemas.SocialAccountRead.model_validate(account, from_attributes=True)
            for account in sorted(user.social_accounts, key=lambda a: (a.provider, not a.is_primary, a.id))
        ]
    return schemas.UserRead(
        id=user.id,
        name=user.name,
        avatar_url=user.avatar_url,
        social_accounts=social_accounts,
    )


