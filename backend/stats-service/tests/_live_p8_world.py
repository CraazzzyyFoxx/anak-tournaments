"""Identity prerequisites of the P8 two-game scenarios: accounts, workspace roles and pre-existing game handles.

Run as a subprocess (``python _live_p8_world.py <identity-service dir>``, through ``LiveStack.run_script``) after
``_live_world.py``; reads ``{"workspaces": {"OFF": id, "ON": id}, "owner_auth_user_id": id}`` from stdin and prints
one ``__P8WORLD__{json}`` line (logins share the P5 world's password; the caller keeps it out of the evidence).

Only what no scenario asserts is seeded here: logins, workspace role grants, a third workspace ``C`` (Overwatch only)
and the game handles of people who are *not* registered through a scenario (the R5 target, a foreign member, a member
who is later removed through the real route, two unlinked owners of one Riot handle, a mix self-joiner with the two
OAuth links self-signup requires). Every registrant's handle is typed later through the real registration routes, so
it is only generated here.
"""

from __future__ import annotations

import asyncio
import json
import random
import string
import sys
from pathlib import Path

IDENTITY = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(IDENTITY))
sys.path.insert(0, str(IDENTITY.parent))

from shared.testing import apply_test_env_defaults  # noqa: E402

apply_test_env_defaults()

import sqlalchemy as sa  # noqa: E402

from shared import models as shared_models  # noqa: E402
from shared.core.social import SocialProvider, normalize_social_handle  # noqa: E402
from shared.rbac import assign_workspace_system_role, ensure_workspace_system_roles  # noqa: E402
from shared.repository import get_or_create_workspace_member  # noqa: E402
from src import models, schemas  # noqa: E402
from src.core import db  # noqa: E402
from src.services.auth import auth  # noqa: E402

PASSWORD = "Correct-horse-battery1!"
RIOT, BATTLENET, DISCORD = SocialProvider.RIOT, SocialProvider.BATTLENET, SocialProvider.DISCORD

#: OW registrant label -> player_role (1 tank / 2 damage / 2 support per team, two teams).
OW_ROLES = {
    "ow1": "tank",
    "ow2": "tank",
    "ow3": "damage",
    "ow4": "damage",
    "ow5": "damage",
    "twin_bn": "damage",
    "ow6": "support",
    "ow7": "support",
    "ow8": "support",
    "dual": "support",
}
#: LoL registrant label -> position (one per position per team, two teams).
LOL_ROLES = {
    "lol1": "top",
    "twin_riot": "top",
    "lol2": "jungle",
    "lol3": "jungle",
    "lol4": "mid",
    "dual": "mid",
    "lol5": "bot",
    "lol6": "bot",
    "lol7": "support",
    "lol8": "support",
}


def handles(tag: str) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for index, label in enumerate(label for label in OW_ROLES if label.startswith("ow")):
        out[label] = {BATTLENET: f"Ow{index + 1}{tag}#{1100 + index}"}
    for index, label in enumerate(label for label in LOL_ROLES if label.startswith("lol")):
        # Riot game names keep their inner spaces (``display_social_handle``); the tag line is 3-5 alphanumerics.
        out[label] = {RIOT: f"P8 Lol{index + 1} {tag}#EUW"}
    out["dual"] = {BATTLENET: f"Dual{tag}#2024", RIOT: f"Dual Riot {tag}#EUW"}
    # The same text under two providers: two different people.
    out["twin_bn"] = {BATTLENET: f"Twin{tag}#4242"}
    out["twin_riot"] = {RIOT: f"Twin{tag}#4242"}
    out["target_u"] = {RIOT: f"Target U {tag}#EUW"}
    out["b_member"] = {RIOT: f"Foreign B {tag}#EUW"}
    out["removed"] = {RIOT: f"Removed A {tag}#EUW"}
    out["joiner"] = {BATTLENET: f"Joiner{tag}#3030", RIOT: f"Joiner {tag}#EUW"}
    out["dup"] = {RIOT: f"Two Owners {tag}#EUW"}
    return out


async def main(payload: dict) -> dict:
    tag = "".join(random.choice(string.ascii_uppercase) for _ in range(4))
    game_handles = handles(tag)
    ws = {label: int(workspace_id) for label, workspace_id in payload["workspaces"].items()}
    users: dict[str, dict] = {}
    async with db.async_session_maker() as session:

        async def account(label: str) -> dict:
            email = f"p8-{label.replace('_', '-')}-{tag.lower()}@example.com"
            created = await auth.register(
                session,
                schemas.UserRegister(email=email, username=f"p8_{label}_{tag.lower()}", password=PASSWORD),
            )
            await session.flush()
            player = await session.scalar(sa.select(models.User).where(models.User.auth_user_id == created.id))
            users[label] = {"auth_user_id": created.id, "player_id": player.id, "email": email}
            return users[label]

        async def social(player_id: int, provider: str, handle: str) -> None:
            session.add(
                shared_models.SocialAccount(
                    user_id=player_id,
                    provider=provider,
                    username=handle,
                    username_normalized=normalize_social_handle(provider, handle),
                    is_primary=True,
                )
            )
            await session.flush()

        async def grant(label: str, workspace: str, role: str) -> int:
            member = await get_or_create_workspace_member(
                session, workspace_id=ws[workspace], player_id=users[label]["player_id"]
            )
            await assign_workspace_system_role(
                session, user_id=users[label]["auth_user_id"], workspace_id=ws[workspace], role_name=role
            )
            users[label].setdefault("members", {})[workspace] = member.id
            return member.id

        # A third workspace: Overwatch only, so "a game this workspace has not enabled" has a home of its own.
        workspace_c = models.Workspace(slug=f"p8-c-{tag.lower()}", name="P8 C", disciplines_enabled=["overwatch"])
        session.add(workspace_c)
        await session.flush()
        await ensure_workspace_system_roles(session, workspace_c.id)
        ws["C"] = workspace_c.id
        owner = await session.scalar(
            sa.select(models.User).where(models.User.auth_user_id == int(payload["owner_auth_user_id"]))
        )
        await get_or_create_workspace_member(session, workspace_id=workspace_c.id, player_id=owner.id)
        await assign_workspace_system_role(
            session, user_id=int(payload["owner_auth_user_id"]), workspace_id=workspace_c.id, role_name="admin"
        )

        for label in sorted({*OW_ROLES, *LOL_ROLES}):
            await account(label)
        # A mix host (``host`` = player reads + custom_game.*) in A and in C.
        await account("host")
        await grant("host", "OFF", "host")
        await grant("host", "C", "host")
        # The R5 target: an account holder with a Riot handle who is a member of no workspace.
        await account("target_u")
        await social(users["target_u"]["player_id"], RIOT, game_handles["target_u"][RIOT])
        # A member of B only, and a member of A the seed's caller removes through the real route.
        await account("b_member")
        await social(users["b_member"]["player_id"], RIOT, game_handles["b_member"][RIOT])
        await grant("b_member", "ON", "player")
        await account("removed")
        await social(users["removed"]["player_id"], RIOT, game_handles["removed"][RIOT])
        await grant("removed", "OFF", "player")
        # Mix self-signup requires Discord and Battle.net OAuth links on the account (shared.services.account_links).
        await account("joiner")
        for provider, handle in game_handles["joiner"].items():
            await social(users["joiner"]["player_id"], provider, handle)
        for provider in (DISCORD, BATTLENET):
            session.add(
                shared_models.OAuthConnection(
                    auth_user_id=users["joiner"]["auth_user_id"],
                    provider=provider,
                    provider_user_id=f"p8-{provider}-{tag.lower()}",
                    username=f"p8joiner{tag.lower()}",
                )
            )
        await session.flush()
        # Two unlinked players holding one Riot handle: a roster upsert of it has several owners.
        dup_players = []
        for index in range(2):
            player = models.User(name=f"P8 Two Owners {tag} {index}")
            session.add(player)
            await session.flush()
            await social(player.id, RIOT, game_handles["dup"][RIOT])
            dup_players.append(player.id)
        await session.commit()

    return {
        "tag": tag,
        "password": PASSWORD,
        "workspaces": ws,
        "users": users,
        "handles": game_handles,
        "ow_roles": OW_ROLES,
        "lol_roles": LOL_ROLES,
        "dup_players": dup_players,
    }


if __name__ == "__main__":
    print("__P8WORLD__" + json.dumps(asyncio.run(main(json.load(sys.stdin))), default=str))
