"""One DM per captain when a mix lobby's ban room or draft starts (spec §12.1 R3-3).

Through ``notify()``: the row lands in the captain's inbox and app-service repeats it in Discord unless they muted
the ``matches`` group. The callers are the two starts and a captain replaced into a started (live or paused) draft
-- never a pick, a seed or a resume -- and the dedupe key (one per room and member) makes a repeated call write
nothing.
"""

from __future__ import annotations

from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.domain.mix_lobby import LOBBY_LETTERS
from shared.services.notifications import notify

__all__ = ("notify_mix_captain",)


async def notify_mix_captain(
    session: AsyncSession,
    *,
    kind: Literal["mix.ban_room_opened", "mix.draft_started"],
    game: models.CustomGame,
    lobby_index: int,
    auth_user_id: int | None,
    dedupe_key: str,
) -> None:
    """Tell one captain their lobby's room is open, linked to that lobby's page. Never commits. A captain with no
    site account behind their seat has no inbox and is skipped."""
    if auth_user_id is None:
        return
    await notify(
        session,
        kind=kind,
        recipient_auth_user_id=auth_user_id,
        source_workspace_id=game.workspace_id,
        payload={"custom_game_id": game.id, "mix_name": game.name, "lobby": LOBBY_LETTERS[lobby_index]},
        dedupe_key=dedupe_key,
    )
