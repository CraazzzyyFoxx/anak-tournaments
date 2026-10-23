"""Player identity reads: ``UserRead`` mapping, the directory, the autocomplete and the profile-slug resolution.

What a player did (profile statistics, tournaments, matches, characters) is stats-service's ``UserService``.
"""

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import errors, pagination
from src import schemas

from .queries import UserIdentityQueries
from .queries import queries as identity_queries

__all__ = ("UserService", "users")

_IDENTITY_ENTITIES = ("social_accounts",)


def _is_globally_visible(account: models.SocialAccount) -> bool:
    """True when the account is shown on the public profile (has a global,
    workspace-less visibility row). Fail-open when ``visibilities`` isn't
    eager-loaded so a read path that forgot to load it never silently hides
    everything — mirrors the ``visible_global=True`` default in the read model."""
    if "visibilities" in sa.inspect(account).unloaded:
        return True
    return any(v.workspace_id is None for v in account.visibilities)


def _social_account_read(account: models.SocialAccount) -> schemas.SocialAccountRead:
    """Serialize a social account, including display-visibility scopes when the
    ``visibilities`` relationship is eager-loaded (admin profile dialog). When it
    isn't loaded we leave the defaults (``visible_global=True``) and never touch
    the relationship — avoiding a lazy load outside the async greenlet."""
    read = schemas.SocialAccountRead.model_validate(account, from_attributes=True)
    if "visibilities" not in sa.inspect(account).unloaded:
        scopes = list(account.visibilities)
        read.visible_global = any(v.workspace_id is None for v in scopes)
        read.visible_workspace_ids = sorted({v.workspace_id for v in scopes if v.workspace_id is not None})
    return read


class UserService:
    def __init__(self, *, queries: UserIdentityQueries = identity_queries) -> None:
        self.queries = queries

    @staticmethod
    def to_read(user: models.User, entities: list[str], *, visible_only: bool = False) -> schemas.UserRead:
        """Convert a `User` to ``UserRead``. Identities come from the unified
        ``user.social_accounts`` relationship and are only accessed (and serialized)
        when an identity entity was requested — and therefore eager-loaded — so this
        never triggers a lazy load outside the async greenlet. The ``battle_tag``/
        ``discord``/``twitch`` entity tokens count as identity requests too.

        ``visible_only`` is set by public-facing reads (profile, list): accounts the
        owner has hidden from the public profile (no global visibility row) are
        dropped. Admin/self reads leave it False so they see every account.
        """
        social_accounts: list[schemas.SocialAccountRead] = []
        if any(name in entities for name in _IDENTITY_ENTITIES):
            accounts = sorted(user.social_accounts, key=lambda a: (a.provider, not a.is_primary, a.id))
            if visible_only:
                accounts = [account for account in accounts if _is_globally_visible(account)]
            social_accounts = [_social_account_read(account) for account in accounts]
        return schemas.UserRead(
            id=user.id,
            name=user.name,
            avatar_url=user.avatar_url,
            # ``is not False`` rather than a truthiness check: the column default lands
            # at INSERT, so a transient (unflushed) ``User`` reads None here, and
            # reporting that as "hidden" would show the owner a switch that lies about
            # their own state. Same fail-open direction as ``_is_globally_visible``.
            stream_visible=user.stream_visible is not False,
            social_accounts=social_accounts,
        )

    async def get_by_slug(self, session: AsyncSession, slug: str, entities: list[str]) -> schemas.UserRead:
        """The profile a ``/users/<slug>`` link names; 400 when nobody.

        Generated links carry the player's canonical, unique ``players.user.name`` with ``#`` folded to ``-``, so
        that name wins over everything else -- a game handle may collide with another player's name. Only when no
        canonical name matches does an old shared link resolve through a game provider handle, then Discord.
        Canonical candidates invert ``getPlayerSlug``: the ``#`` readings first (suffix hyphen, then every hyphen),
        the literal slug last. ``Name-EUW`` and ``Name#EUW`` share one slug; the ``#`` name takes precedence and
        the hyphen twin is a known limit until slugs are made injective.
        """
        candidates = [slug]
        if "#" not in slug and "-" in slug:
            head, _, tail = slug.rpartition("-")
            candidates = [f"{head}#{tail}", slug.replace("-", "#"), slug]
        candidates = list(dict.fromkeys(candidates))
        for candidate in candidates:
            user = await self.queries.find_by_exact_name(session, candidate, entities)
            if user is not None:
                return self.to_read(user, entities, visible_only=True)
        for candidate in candidates:
            if "#" in candidate:
                user = await self.queries.find_by_battle_tag(session, candidate, entities)
                if user is not None:
                    return self.to_read(user, entities, visible_only=True)
        user = await self.queries.get_by_discord(session, slug, entities)
        if user is None:
            raise errors.ApiHTTPException(
                status_code=400,
                detail=[errors.ApiExc(code="not_found", msg=f"User {slug} not found.")],
            )
        return self.to_read(user, entities, visible_only=True)

    async def get_all(
        self, session: AsyncSession, params: pagination.PaginationSortSearchParams
    ) -> pagination.Paginated[schemas.UserRead]:
        """Paginated users as ``UserRead`` schemas."""
        users, total = await self.queries.get_all(session, params)
        return pagination.Paginated(
            page=params.page,
            per_page=params.per_page,
            total=total,
            results=[self.to_read(user, params.entities, visible_only=True) for user in users],
        )

    async def search_by_name(self, session: AsyncSession, name: str) -> list[schemas.UserSearch]:
        """Player autocomplete matches (profile name, game, Discord or Twitch handle) as ``UserSearch`` rows.

        ``name`` is the player's canonical, unique ``players.user.name`` -- what ``users.by_name`` resolves a
        profile slug by -- not the matched account's handle, which another player's name could collide with.
        Several matching accounts of one player collapse into one row.
        """
        rows = await self.queries.search_by_name(session, name)
        return [schemas.UserSearch(id=user_id, name=user_name) for user_id, user_name in rows]


users = UserService()
