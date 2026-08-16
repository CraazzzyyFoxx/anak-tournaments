"""Which channels the poll tick asks Twitch about, and where they come from.

Read-only, always. This service owns no table in ``tournament.*``, ``balancer.*``
or ``players.*`` and writes to none of them — the boundary rule in
``backend/docs/tournament-service-write-path-inventory.md``. Everything here is a
``SELECT``.

**The visibility JOIN is a privacy control, not a filter.** A player's Twitch
account is public only when a ``social_account_visibility`` row with
``workspace_id IS NULL`` exists (that is what ``visible_only`` means everywhere
else — ``backend/app-service/src/services/user/flows.py``). It is enforced in the
``SELECT`` rather than in a serializer on purpose: a serializer-level check is one
new code path away from being forgotten, and forgetting it publishes a channel a
player deliberately hid from their profile. ``test_target_queries`` asserts the
JOIN is present in the compiled SQL.

Two consented sources, deliberately no third:

- **self-declared** — ``registration.twitch_nick`` behind ``stream_pov``, the
  per-tournament "yes, show my POV" checkbox players already tick;
- **verified** — an OAuth-proven ``social_account`` that is globally visible.

Verified wins a login collision: it carries ``provider_user_id``, which survives a
channel rename, and a typo'd self-declared nick must never shadow the proven one.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final
from urllib.parse import urlparse

import sqlalchemy as sa

from shared import models
from shared.core import enums
from shared.core.social import SocialProvider

__all__ = (
    "POLLED_TOURNAMENT_STATUSES",
    "TWITCH_HOSTS",
    "ActiveTournament",
    "ParticipantChannel",
    "active_tournament_ids",
    "official_stream_links",
    "participant_channels",
    "platform_from_url",
    "twitch_channel_from_url",
)

#: ``check_in`` and ``draft`` are in on purpose: the official broadcast goes live
#: before the first map, and an organizer whose stream badge only appears at
#: ``live`` would rather not have the feature. ``registration`` is out — it can
#: run for weeks and would burn the shared Helix bucket on an empty hall.
#: ``completed``/``archived`` are never polled.
#:
#: Keyed on ``status``, NOT on ``Tournament.is_finished``: that flag is set by
#: separate code paths and is not kept in sync with the status enum.
POLLED_TOURNAMENT_STATUSES: Final[tuple[enums.TournamentStatus, ...]] = (
    enums.TournamentStatus.CHECK_IN,
    enums.TournamentStatus.DRAFT,
    enums.TournamentStatus.LIVE,
    enums.TournamentStatus.PLAYOFFS,
)

TWITCH_HOSTS: Final[frozenset[str]] = frozenset({"twitch.tv", "www.twitch.tv", "m.twitch.tv", "player.twitch.tv"})

_YOUTUBE_HOSTS: Final[frozenset[str]] = frozenset(
    {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtube-nocookie.com"}
)

#: Twitch paths that look like a channel but are not one. ``/videos/123`` is a
#: VOD, ``/directory/...`` a category page: pollable channel names, all of them
#: wrong.
_NON_CHANNEL_TWITCH_SEGMENTS: Final[frozenset[str]] = frozenset(
    {"videos", "directory", "collections", "team", "downloads", "p", "settings"}
)


@dataclass(frozen=True, slots=True)
class ActiveTournament:
    """A tournament worth polling.

    ``is_hidden`` travels with it because the poller must treat it differently at
    exactly one point — it still polls and still writes Redis, but it must not
    publish to the public ``tournament:{id}:streams`` topic, or an anonymous
    subscriber learns a preview tournament exists.
    """

    tournament_id: int
    workspace_id: int
    is_hidden: bool


@dataclass(frozen=True, slots=True)
class ParticipantChannel:
    """One player's Twitch channel, with the consent path that produced it."""

    player_id: int
    login: str
    provider_user_id: str | None
    source: str  # "self_declared" | "verified"


def platform_from_url(url: str) -> str:
    """``twitch`` / ``youtube`` / ``other`` from the URL host.

    Shared with the RPC read so an official link and a polled channel never
    disagree about what platform they are on.
    """
    host = (urlparse(url).hostname or "").casefold()
    if host in TWITCH_HOSTS:
        return "twitch"
    if host in _YOUTUBE_HOSTS:
        return "youtube"
    return "other"


def twitch_channel_from_url(url: str) -> str | None:
    """The channel login in a Twitch URL, or ``None`` when there is nothing to poll.

    ``None`` for a non-Twitch host, a bare ``twitch.tv/``, and for VOD/category
    paths — a caller must render those with ``live=None`` ("no detection"), never
    ``live=False`` ("checked, offline").
    """
    parsed = urlparse(url)
    if (parsed.hostname or "").casefold() not in TWITCH_HOSTS:
        return None
    segments = [segment for segment in parsed.path.split("/") if segment]
    if len(segments) != 1:
        return None
    login = segments[0].casefold()
    if login in _NON_CHANNEL_TWITCH_SEGMENTS:
        return None
    return login


async def active_tournament_ids(session: Any) -> list[ActiveTournament]:
    """Tournaments in a phase where somebody could be broadcasting."""
    stmt = (
        sa.select(
            models.Tournament.id,
            models.Tournament.workspace_id,
            models.Tournament.is_hidden,
        )
        .where(models.Tournament.status.in_(POLLED_TOURNAMENT_STATUSES))
        .order_by(models.Tournament.id)
    )
    rows = (await session.execute(stmt)).all()
    return [
        ActiveTournament(tournament_id=int(tid), workspace_id=int(workspace_id), is_hidden=bool(is_hidden))
        for tid, workspace_id, is_hidden in rows
    ]


async def official_stream_links(session: Any, tournament_id: int) -> list[models.TournamentLink]:
    """Active ``kind='stream'`` links for a tournament, in organizer order.

    ORM rows, not URLs: the RPC read renders ``label`` beside the link, and a
    second query there to fetch it would be the same JOIN twice.
    """
    stmt = (
        sa.select(models.TournamentLink)
        .where(
            models.TournamentLink.tournament_id == tournament_id,
            models.TournamentLink.kind == "stream",
            models.TournamentLink.is_active.is_(True),
        )
        .order_by(models.TournamentLink.sort_order.asc(), models.TournamentLink.id.asc())
    )
    return list((await session.execute(stmt)).scalars().all())


def _approved_registration_filters(tournament_id: int) -> list[Any]:
    """The "this player is actually in this tournament" predicate, shared by both
    sources so a change to what counts as participation cannot drift between them."""
    registration = models.BalancerRegistration
    return [
        registration.tournament_id == tournament_id,
        registration.deleted_at.is_(None),
        registration.status == "approved",
    ]


def _stream_veto_filters() -> list[Any]:
    """The owner's "do not broadcast me" veto, shared by both sources for the same
    reason ``_approved_registration_filters`` is: a veto honoured by one of the two
    queries and not the other is not a veto at all.

    Outranks both opt-ins. Self-declared channels pass ``stream_pov``, verified ones
    pass a global visibility row — neither may resurrect a player who said no.

    Requires ``models.User`` to be joined by the caller. ``is_(True)`` (not
    ``isnot(False)``) because the column is NOT NULL, so the positive form is
    equivalent and reads like the flag it tests.
    """
    return [models.User.stream_visible.is_(True)]


def _self_declared_stmt(tournament_id: int) -> Any:
    registration = models.BalancerRegistration
    member = models.WorkspaceMember
    user = models.User
    return (
        sa.select(member.player_id, registration.twitch_nick)
        .select_from(registration)
        .join(member, registration.workspace_member_id == member.id)
        # PRIVACY: joined only to reach ``stream_visible``. Inner, so a player row
        # that vanished cannot smuggle a channel through on the registration alone.
        .join(user, member.player_id == user.id)
        .where(
            *_approved_registration_filters(tournament_id),
            *_stream_veto_filters(),
            registration.stream_pov.is_(True),
            registration.twitch_nick.isnot(None),
            member.player_id.isnot(None),
        )
        .distinct()
    )


def _verified_stmt(tournament_id: int) -> Any:
    registration = models.BalancerRegistration
    member = models.WorkspaceMember
    user = models.User
    account = models.SocialAccount
    visibility = models.SocialAccountVisibility
    return (
        sa.select(user.id, account.username, account.username_normalized, account.provider_user_id)
        .select_from(registration)
        .join(member, registration.workspace_member_id == member.id)
        .join(user, member.player_id == user.id)
        .join(account, account.user_id == user.id)
        # PRIVACY: an inner join on the GLOBAL visibility scope. Dropping it, or
        # relaxing it to `workspace_id == tournament workspace`, publishes accounts
        # the player hid from their public profile.
        .join(
            visibility,
            sa.and_(visibility.account_id == account.id, visibility.workspace_id.is_(None)),
        )
        .where(
            *_approved_registration_filters(tournament_id),
            *_stream_veto_filters(),
            account.provider == SocialProvider.TWITCH,
            account.is_verified.is_(True),
        )
        .distinct()
    )


async def participant_channels(session: Any, tournament_id: int) -> list[ParticipantChannel]:
    """Every participant channel this tournament may broadcast, deduped by login.

    Two queries rather than a UNION: they select different columns, and keeping
    them apart is what lets the verified row win a collision by construction
    instead of by a CASE expression nobody would read again.
    """
    by_login: dict[str, ParticipantChannel] = {}

    for player_id, twitch_nick in (await session.execute(_self_declared_stmt(tournament_id))).all():
        login = str(twitch_nick or "").strip().casefold()
        if not login or player_id is None:
            continue
        by_login[login] = ParticipantChannel(
            player_id=int(player_id),
            login=login,
            provider_user_id=None,
            source="self_declared",
        )

    for player_id, username, username_normalized, provider_user_id in (
        await session.execute(_verified_stmt(tournament_id))
    ).all():
        login = str(username_normalized or username or "").strip().casefold()
        if not login or player_id is None:
            continue
        # Overwrites a self-declared entry for the same login: same channel, better
        # identifier (provider_user_id survives a rename, a login does not).
        by_login[login] = ParticipantChannel(
            player_id=int(player_id),
            login=login,
            provider_user_id=str(provider_user_id) if provider_user_id else None,
            source="verified",
        )

    return [by_login[login] for login in sorted(by_login)]
