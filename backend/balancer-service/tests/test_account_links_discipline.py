import asyncio
from types import SimpleNamespace

from shared.core.social import SocialProvider
from src.domain.mix_self_service import mix_self_policy
from src.services import account_links
from src.services.account_links import required_link_providers
from src.services.custom_game import _blocker


def test_a_mix_requires_discord_plus_the_games_oauth_provider() -> None:
    assert required_link_providers("overwatch") == (SocialProvider.DISCORD, SocialProvider.BATTLENET)
    assert required_link_providers("lol") == (SocialProvider.DISCORD, SocialProvider.RIOT)


def test_a_game_whose_identity_cannot_be_oauth_linked_requires_discord_only(monkeypatch) -> None:
    monkeypatch.setattr(account_links, "discipline", lambda code: SimpleNamespace(identity_provider=SocialProvider.VK))
    assert required_link_providers("x") == (SocialProvider.DISCORD,)
    monkeypatch.setattr(account_links, "discipline", lambda code: SimpleNamespace(identity_provider=None))
    assert required_link_providers("x") == (SocialProvider.DISCORD,)


def test_a_missing_game_link_names_its_provider() -> None:
    policy = mix_self_policy(
        status="draft",
        self_signup="pool",
        self_role_edit=True,
        on_roster=False,
        missing_links=frozenset({SocialProvider.RIOT}),
        has_player=True,
        self_join_denied=False,
        roster_size=0,
    )
    assert policy.join_blocker == "riot_not_linked"


def test_any_unlinked_provider_is_a_fix_your_account_403() -> None:
    assert (_blocker("riot_not_linked").status_code, _blocker("riot_not_linked").detail) == (403, "riot_not_linked")
    assert _blocker("steam_not_linked").status_code == 403


def test_a_lol_account_with_discord_and_riot_but_no_player_is_player_not_linked(monkeypatch) -> None:
    """Both links present satisfies the link check; the missing ``players.user`` row
    (e.g. after a player unlink) is the next blocker, and it is game-neutral."""

    class _Linked:
        async def list_by_user_providers(self, _session, *, auth_user_id, providers):
            del auth_user_id
            linked = (SocialProvider.DISCORD, SocialProvider.RIOT)
            return [SimpleNamespace(provider=provider) for provider in linked if provider in providers]

    monkeypatch.setattr(account_links, "_connections", _Linked())
    missing = asyncio.run(account_links.missing_account_links(object(), 42, "lol"))
    assert missing == frozenset()
    policy = mix_self_policy(
        status="draft",
        self_signup="pool",
        self_role_edit=True,
        on_roster=False,
        missing_links=missing,
        has_player=False,
        self_join_denied=False,
        roster_size=0,
    )
    assert policy.join_blocker == "player_not_linked"
    assert _blocker(policy.join_blocker).status_code == 403
