"""DB-backed reconciliation tests for ``ensure_player_identity`` (identity/workspace
refactor Task 5, P7 owner-provider root).

``ensure_player_identity`` resolves the player from the OWNING tournament's identity
provider only. It prefers a player already linked to the registering auth account
(``players.user.auth_user_id``) over the handle lookup, and collapses a colliding
shadow player's duplicate onto the account-owned player ONLY with ownership proof
(the account-owned player already holds that handle verified, subject-backed);
otherwise it refuses with ``409 game_identity_conflict`` and writes nothing.

These are real-DB integration tests (mirroring the skip pattern used by
``identity-service/tests/test_player_link_service.py``): the DB is probed once
per test and any connection failure (e.g. anak_dev unreachable) skips cleanly
instead of failing, and the tests refuse to run against a production database.
The narrower precedence/wiring behaviour is covered without a DB in
``test_registration_sheet_sync_identity.py``.
"""

import asyncio
import os
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


def _ensure_test_env() -> None:
    env = {
        "DEBUG": "true",
    }
    for key, value in env.items():
        os.environ.setdefault(key, value)


_ensure_test_env()

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

import pytest  # noqa: E402

from shared.core.errors import ApiHTTPException  # noqa: E402
from shared.core.social import SocialProvider, normalize_social_handle  # noqa: E402
from shared.models.identity.auth_user import AuthUser  # noqa: E402
from shared.models.identity.user import User  # noqa: E402
from shared.repository import SocialAccountRepository  # noqa: E402
from shared.services.social_identity import social_identity_service  # noqa: E402
from shared.testing import real_db_sessionmaker as _db_sessions  # noqa: E402
from src.services.registration import service as reg_service  # noqa: E402

BATTLENET = SocialProvider.BATTLENET
RIOT = SocialProvider.RIOT


async def _make_auth_user(session, suffix: str) -> AuthUser:
    auth_user = AuthUser(
        email=f"epi-{suffix}@example.com",
        username=f"epi_{suffix}",
        hashed_password="x",
    )
    session.add(auth_user)
    await session.flush()
    return auth_user


async def _make_player(session, suffix: str, *, auth_user_id: int | None = None) -> User:
    player = User(name=f"epi_player_{suffix}", auth_user_id=auth_user_id)
    session.add(player)
    await session.flush()
    return player


async def _account(
    session, *, user_id: int, handle: str, provider: str = BATTLENET, verified_subject: str | None = None
):
    return await social_identity_service.upsert(
        session,
        user_id=user_id,
        provider=provider,
        username=handle,
        provider_user_id=verified_subject,
        is_verified=True if verified_subject is not None else None,
    )


async def _owners(session, provider: str, handle: str) -> list[int]:
    players = await SocialAccountRepository().find_players_by_handle(
        session, provider=provider, username_normalized=normalize_social_handle(provider, handle)
    )
    return sorted(player.id for player in players)


def _registration(
    *,
    battlenet: list[str] | None = None,
    riot: list[str] | None = None,
    discord: str | None = None,
):
    # BalancerRegistration no longer carries auth_user_id or user_id (identity is
    # anchored via workspace_member_id — dbarch02); ensure_player_identity takes
    # the registering account's auth_user_id as an explicit keyword argument
    # instead of reading it off the row. tournament_id=None makes the member
    # anchoring a no-op (no workspace resolvable), which keeps these tests
    # focused on player reconciliation without provisioning workspaces.
    #
    # Handles live on `identities` rows (position 0 = primary), never on a
    # `battle_tag` column.
    identities = [
        SimpleNamespace(provider=provider, position=index, handle=handle)
        for provider, handles in ((BATTLENET, battlenet), (RIOT, riot))
        for index, handle in enumerate(handles or [])
    ]
    if discord is not None:
        identities.append(SimpleNamespace(provider=SocialProvider.DISCORD, position=0, handle=discord))
    return SimpleNamespace(
        id=None,
        tournament_id=None,
        identities=identities,
        workspace_member_id=None,
        deleted_at=None,
    )


async def _ensure(session, registration, *, provider: str, auth_user_id: int | None = None):
    return await reg_service.registration_service.ensure_player_identity(
        session, registration, provider=provider, auth_user_id=auth_user_id
    )


def test_reuses_account_owned_player_and_attaches_new_battle_tag() -> None:
    """Case (a): the auth account already owns a player (no prior battletag) —
    the new battletag is attached to that player, not a fresh one."""
    suffix = uuid.uuid4().hex[:10]

    async def _run():
        async with _db_sessions() as session_maker:
            battle_tag = f"Acct{suffix}#111"

            async with session_maker() as session:
                auth_user = await _make_auth_user(session, suffix)
                player = await _make_player(session, suffix, auth_user_id=auth_user.id)
                await session.commit()
                auth_user_id, player_id = auth_user.id, player.id

            async with session_maker() as session:
                resolved = await _ensure(
                    session, _registration(battlenet=[battle_tag]), provider=BATTLENET, auth_user_id=auth_user_id
                )
                await session.commit()

            async with session_maker() as session:
                return player_id, resolved, await _owners(session, BATTLENET, battle_tag)

    player_id, resolved, owners = asyncio.run(_run())
    assert resolved == player_id
    assert owners == [player_id]


def test_unproven_shadow_handle_is_refused_and_nothing_moves() -> None:
    """Case (b): a shadow player owns the handle and the account-owned player holds no
    verified proof of it — a typed handle is not authority to take it. 409, no write."""
    suffix = uuid.uuid4().hex[:10]

    async def _run():
        async with _db_sessions() as session_maker:
            battle_tag = f"Collide{suffix}#222"

            async with session_maker() as session:
                auth_user = await _make_auth_user(session, suffix)
                owned_player = await _make_player(session, f"owned{suffix}", auth_user_id=auth_user.id)
                shadow_player = await _make_player(session, f"shadow{suffix}")
                await _account(session, user_id=shadow_player.id, handle=battle_tag)
                await session.commit()
                auth_user_id = auth_user.id
                owned_id, shadow_id = owned_player.id, shadow_player.id

            async with session_maker() as session:
                with pytest.raises(ApiHTTPException) as refused:
                    await _ensure(
                        session, _registration(battlenet=[battle_tag]), provider=BATTLENET, auth_user_id=auth_user_id
                    )
                await session.rollback()

            async with session_maker() as session:
                return owned_id, shadow_id, refused.value, await _owners(session, BATTLENET, battle_tag)

    owned_id, shadow_id, refused, owners = asyncio.run(_run())
    assert refused.status_code == 409
    assert refused.detail[0]["code"] == "game_identity_conflict"
    assert owners == [shadow_id]
    assert owned_id not in owners


def test_verified_handle_drops_only_the_shadows_duplicate() -> None:
    """Case (b'): the account-owned player holds the very handle verified (OAuth subject) —
    that is the proof. Only the shadow's unverified duplicate of THAT handle goes; the
    shadow's other accounts and the owner's verified flag/subject stay put."""
    suffix = uuid.uuid4().hex[:10]

    async def _run():
        async with _db_sessions() as session_maker:
            battle_tag = f"Proven{suffix}#333"
            other_tag = f"Other{suffix}#444"

            async with session_maker() as session:
                auth_user = await _make_auth_user(session, suffix)
                owned_player = await _make_player(session, f"owned{suffix}", auth_user_id=auth_user.id)
                shadow_player = await _make_player(session, f"shadow{suffix}")
                await _account(session, user_id=owned_player.id, handle=battle_tag, verified_subject=f"sub-{suffix}")
                await _account(session, user_id=shadow_player.id, handle=battle_tag)
                await _account(session, user_id=shadow_player.id, handle=other_tag)
                await session.commit()
                auth_user_id = auth_user.id
                owned_id, shadow_id = owned_player.id, shadow_player.id

            async with session_maker() as session:
                resolved = await _ensure(
                    session, _registration(battlenet=[battle_tag]), provider=BATTLENET, auth_user_id=auth_user_id
                )
                await session.commit()

            async with session_maker() as session:
                owned_account = await social_identity_service.find_by_handle(
                    session, provider=BATTLENET, username=battle_tag, user_id=owned_id
                )
                return (
                    owned_id,
                    shadow_id,
                    resolved,
                    await _owners(session, BATTLENET, battle_tag),
                    await _owners(session, BATTLENET, other_tag),
                    (owned_account.is_verified, owned_account.provider_user_id),
                    f"sub-{suffix}",
                )

    owned_id, shadow_id, resolved, tag_owners, other_owners, owned_state, subject = asyncio.run(_run())
    assert resolved == owned_id
    assert tag_owners == [owned_id]
    assert other_owners == [shadow_id]
    assert owned_state == (True, subject)


def test_a_self_declared_duplicate_on_the_registrant_is_no_proof_against_another_players_account() -> None:
    """The registrant's own player holds the handle only as an UNVERIFIED (self-declared) account while
    a shadow player holds it too: nothing proves which is theirs — 409, and neither side is touched."""
    suffix = uuid.uuid4().hex[:10]

    async def _run():
        async with _db_sessions() as session_maker:
            battle_tag = f"SelfDecl{suffix}#999"

            async with session_maker() as session:
                auth_user = await _make_auth_user(session, suffix)
                owned_player = await _make_player(session, f"owned{suffix}", auth_user_id=auth_user.id)
                shadow_player = await _make_player(session, f"shadow{suffix}")
                await _account(session, user_id=owned_player.id, handle=battle_tag)
                await _account(session, user_id=shadow_player.id, handle=battle_tag)
                await session.commit()
                auth_user_id = auth_user.id
                owned_id, shadow_id = owned_player.id, shadow_player.id

            async with session_maker() as session:
                with pytest.raises(ApiHTTPException) as refused:
                    await _ensure(
                        session, _registration(battlenet=[battle_tag]), provider=BATTLENET, auth_user_id=auth_user_id
                    )
                await session.rollback()

            async with session_maker() as session:
                return refused.value, owned_id, shadow_id, await _owners(session, BATTLENET, battle_tag)

    refused, owned_id, shadow_id, owners = asyncio.run(_run())
    assert (refused.status_code, refused.detail[0]["code"]) == (409, "game_identity_conflict")
    assert owners == sorted([owned_id, shadow_id])


def test_auth_linked_player_holding_the_handle_is_never_collapsed() -> None:
    """Case (b''): even with proof on the registering account, a holder that has its OWN
    auth account is a real person — refused, never merged by a form submission."""
    suffix = uuid.uuid4().hex[:10]

    async def _run():
        async with _db_sessions() as session_maker:
            battle_tag = f"Other{suffix}#555"

            async with session_maker() as session:
                auth_user = await _make_auth_user(session, suffix)
                rival_auth = await _make_auth_user(session, f"rival{suffix}")
                owned_player = await _make_player(session, f"owned{suffix}", auth_user_id=auth_user.id)
                rival_player = await _make_player(session, f"rival{suffix}", auth_user_id=rival_auth.id)
                await _account(session, user_id=owned_player.id, handle=battle_tag, verified_subject=f"sub-{suffix}")
                await _account(session, user_id=rival_player.id, handle=battle_tag)
                await session.commit()
                auth_user_id = auth_user.id
                rival_id = rival_player.id

            async with session_maker() as session:
                with pytest.raises(ApiHTTPException) as refused:
                    await _ensure(
                        session, _registration(battlenet=[battle_tag]), provider=BATTLENET, auth_user_id=auth_user_id
                    )
                await session.rollback()

            async with session_maker() as session:
                return refused.value, rival_id, await _owners(session, BATTLENET, battle_tag)

    refused, rival_id, owners = asyncio.run(_run())
    assert refused.detail[0]["code"] == "game_identity_conflict"
    assert rival_id in owners


def test_shadow_only_no_account_falls_back_to_battle_tag_dedup() -> None:
    """Case (c): no auth account owns a player — behaviour is exactly the
    pre-existing handle dedup (shadow player reused, no auth link)."""
    suffix = uuid.uuid4().hex[:10]

    async def _run():
        async with _db_sessions() as session_maker:
            battle_tag = f"ShadowOnly{suffix}#666"

            async with session_maker() as session:
                shadow_player = await _make_player(session, f"onlyshadow{suffix}")
                await _account(session, user_id=shadow_player.id, handle=battle_tag)
                await session.commit()
                shadow_id = shadow_player.id

            async with session_maker() as session:
                resolved = await _ensure(session, _registration(battlenet=[battle_tag]), provider=BATTLENET)
                await session.commit()

            return shadow_id, resolved

    shadow_id, resolved = asyncio.run(_run())
    assert resolved == shadow_id


def test_non_game_identity_alone_resolves_to_no_player() -> None:
    """Case (d): a discord handle says nothing about WHICH player this is, so a
    registration carrying only non-game identities and no auth account resolves
    to nothing — it must not mint a player named after a discord tag."""

    async def _run():
        async with _db_sessions() as session_maker:
            async with session_maker() as session:
                registration = _registration(discord=f"only_discord_{uuid.uuid4().hex[:10]}")
                resolved = await _ensure(session, registration, provider=BATTLENET)
                await session.rollback()
            return resolved

    assert asyncio.run(_run()) is None


def test_each_owner_provider_resolves_its_own_players_handle() -> None:
    """One registration carrying a BattleTag and a Riot ID of two DIFFERENT existing
    players: the owner provider picks the player, the other game's handle never does,
    and it is never moved onto the picked player."""
    suffix = uuid.uuid4().hex[:10]

    async def _run():
        async with _db_sessions() as session_maker:
            battle_tag = f"Both{suffix}#777"
            riot_id = f"Both{suffix}#EUW"

            async with session_maker() as session:
                bn_player = await _make_player(session, f"bn{suffix}")
                riot_player = await _make_player(session, f"riot{suffix}")
                await _account(session, user_id=bn_player.id, handle=battle_tag)
                await _account(session, user_id=riot_player.id, handle=riot_id, provider=RIOT)
                await session.commit()
                bn_id, riot_pid = bn_player.id, riot_player.id

            resolved = {}
            for provider in (BATTLENET, RIOT):
                async with session_maker() as session:
                    resolved[provider] = await _ensure(
                        session, _registration(battlenet=[battle_tag], riot=[riot_id]), provider=provider
                    )
                    await session.commit()

            async with session_maker() as session:
                return (
                    bn_id,
                    riot_pid,
                    resolved,
                    await _owners(session, BATTLENET, battle_tag),
                    await _owners(session, RIOT, riot_id),
                )

    bn_id, riot_pid, resolved, bn_owners, riot_owners = asyncio.run(_run())
    assert resolved == {BATTLENET: bn_id, RIOT: riot_pid}
    # Two distinct people were never collapsed onto one profile.
    assert bn_owners == [bn_id]
    assert riot_owners == [riot_pid]


def test_other_games_handle_never_names_or_creates_a_player() -> None:
    """A registration with only a Riot ID, owned by a Battle.net game: no owner-provider
    identity means no player — the other game's handle does not stand in."""
    suffix = uuid.uuid4().hex[:10]

    async def _run():
        async with _db_sessions() as session_maker:
            riot_id = f"Lonely{suffix}#EUW"
            async with session_maker() as session:
                resolved = await _ensure(session, _registration(riot=[riot_id]), provider=BATTLENET)
                await session.commit()
            async with session_maker() as session:
                return resolved, await _owners(session, RIOT, riot_id)

    resolved, owners = asyncio.run(_run())
    assert resolved is None
    assert owners == []


def test_missing_owner_handle_keeps_auth_player_and_attaches_unowned_extra_handle() -> None:
    """Auth account with a player, registration with only the OTHER game's handle: the
    player is still the registrant's own, the unowned handle lands on it as an extra."""
    suffix = uuid.uuid4().hex[:10]

    async def _run():
        async with _db_sessions() as session_maker:
            riot_id = f"Extra{suffix}#EUW"
            async with session_maker() as session:
                auth_user = await _make_auth_user(session, suffix)
                player = await _make_player(session, suffix, auth_user_id=auth_user.id)
                await session.commit()
                auth_user_id, player_id = auth_user.id, player.id
            async with session_maker() as session:
                resolved = await _ensure(
                    session, _registration(riot=[riot_id]), provider=BATTLENET, auth_user_id=auth_user_id
                )
                await session.commit()
            async with session_maker() as session:
                return player_id, resolved, await _owners(session, RIOT, riot_id)

    player_id, resolved, owners = asyncio.run(_run())
    assert resolved == player_id
    assert owners == [player_id]


def test_new_player_is_named_after_the_owner_providers_primary_handle() -> None:
    """Both handles, nobody owns either: the new player is named after the OWNER
    provider's primary handle, not whichever game sorts first."""
    suffix = uuid.uuid4().hex[:10]

    async def _run():
        async with _db_sessions() as session_maker:
            battle_tag = f"Named{suffix}#888"
            riot_id = f"Named{suffix}#EUW"
            async with session_maker() as session:
                resolved = await _ensure(session, _registration(battlenet=[battle_tag], riot=[riot_id]), provider=RIOT)
                await session.commit()
            async with session_maker() as session:
                player = await session.get(User, resolved)
                return player.name, riot_id

    name, riot_id = asyncio.run(_run())
    assert name == riot_id
