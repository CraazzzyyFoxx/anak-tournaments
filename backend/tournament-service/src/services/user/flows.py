"""Minimal user read-model surface for tournament-service.

Profile/overview/hero-compare flows live in app-service (``rpc.app.*``); the
method here is the only one consumed by tournament-service's own flows
(encounter, map, team, tournament) to embed a user into their read models.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas

_IDENTITY_ENTITIES = ("social_accounts", "battle_tag", "discord", "twitch")


def user_to_read(user: models.User, entities: list[str]) -> schemas.UserRead:
    """Sync ``User`` -> ``UserRead``. Identities come from the already-loaded
    ``user.social_accounts`` relationship.
    """
    social_accounts: list[schemas.SocialAccountRead] = []
    if any(name in entities for name in _IDENTITY_ENTITIES):
        social_accounts = [
            schemas.SocialAccountRead.model_validate(account, from_attributes=True)
            for account in sorted(user.social_accounts, key=lambda a: (a.provider, not a.is_primary, a.id))
        ]
    return schemas.UserRead(id=user.id, name=user.name, social_accounts=social_accounts)


class UserFlowsService:
    async def to_pydantic(
        self, session: AsyncSession, user: models.User, entities: list[str]
    ) -> schemas.UserRead:
        """Convert a `User` to ``UserRead``. Identities come from the unified
        ``user.social_accounts`` relationship and are only accessed (and serialized)
        when an identity entity was requested — and therefore eager-loaded — so this
        never triggers a lazy load outside the async greenlet. Legacy entity tokens
        (``battle_tag``/``discord``/``twitch``) are still honored as triggers.
        """
        return user_to_read(user, entities)


flows_service = UserFlowsService()
