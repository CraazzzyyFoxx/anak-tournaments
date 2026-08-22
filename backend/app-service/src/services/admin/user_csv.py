"""Bulk user creation from CSV / Google Sheets.

Identities are written to the unified ``social_account`` via the shared
``social_identity`` helper; player matching/dedup uses normalized handles.

The whole import is one transaction: ``bulk_create_users_from_csv`` owns the
single ``commit()``, and the per-row helper only flushes. It used to commit once
per row, which turned a 500-row sheet into 500 round trips and left a partial
import behind on any mid-file database error anyway. Unparseable rows are still
logged and skipped without ever reaching the database, so the "skip the bad row,
import the rest" behaviour the importer actually documents is unchanged.
"""

from __future__ import annotations

import csv
import re

from loguru import logger
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.social import SocialProvider
from shared.repository import UserRepository
from shared.services import social_identity
from src import models, schemas
from src.core import config

__all__ = ("UserCsvImportService", "csv_import")

battle_tag_validator = re.compile(config.settings.battle_tag_regex, re.UNICODE)


class UserCsvImportService:
    def __init__(self, *, players: UserRepository = UserRepository()) -> None:
        self.players = players

    async def _find_existing_player(self, session: AsyncSession, data_in: schemas.UserCSV) -> int | None:
        """Resolve an existing player id from any of the row's handles (normalized match)."""
        candidates: list[tuple[str, str]] = []
        if data_in.battle_tag:
            candidates.append((SocialProvider.BATTLENET, data_in.battle_tag))
        if data_in.discord:
            candidates.append((SocialProvider.DISCORD, data_in.discord))
        if data_in.twitch:
            candidates.append((SocialProvider.TWITCH, data_in.twitch))
        candidates.extend((SocialProvider.BATTLENET, smurf) for smurf in data_in.smurfs if smurf)

        for provider, handle in candidates:
            player_id = await social_identity.find_player_id_by_handle(session, provider=provider, username=handle)
            if player_id is not None:
                return player_id
        return None

    async def _create_from_row(self, session: AsyncSession, data_in: schemas.UserCSV) -> None:
        player_id = await self._find_existing_player(session, data_in)
        if player_id is None:
            player = await self.players.create(session, models.User(name=data_in.battle_tag))
            player_id = player.id

        await social_identity.upsert_social_account(
            session, user_id=player_id, provider=SocialProvider.BATTLENET, username=data_in.battle_tag
        )
        for smurf in data_in.smurfs:
            if smurf:
                await social_identity.upsert_social_account(
                    session, user_id=player_id, provider=SocialProvider.BATTLENET, username=smurf
                )
        if data_in.discord:
            await social_identity.upsert_social_account(
                session, user_id=player_id, provider=SocialProvider.DISCORD, username=data_in.discord
            )
        if data_in.twitch:
            await social_identity.upsert_social_account(
                session, user_id=player_id, provider=SocialProvider.TWITCH, username=data_in.twitch
            )

        # Keep the player's display name aligned with the (latest) battletag, as before.
        player = await self.players.get(session, player_id)
        if player is not None and data_in.battle_tag:
            player.name = data_in.battle_tag
        await session.flush()

    async def bulk_create_users_from_csv(
        self,
        session: AsyncSession,
        filename: str,
        data: list[str],
        start_row: int = 0,
        *,
        battle_tag_row: int,
        discord_row: int,
        twitch_row: int,
        smurf_row: int,
        delimiter: str = ",",
        has_discord: bool = True,
        has_smurf: bool = True,
        has_twitch: bool = True,
    ) -> None:
        file_reader = csv.reader(data, delimiter=delimiter)
        for index, row in enumerate(file_reader, 0):
            if index < start_row:
                continue
            battle_tag = row[battle_tag_row - 1].strip().replace(" #", "#").replace("# ", "#")
            twitch = row[twitch_row - 1].strip() if has_twitch else None
            discord = row[discord_row - 1].strip() if has_discord else None
            smurfs = row[smurf_row - 1] if has_smurf else ""

            try:
                payload = schemas.UserCSV(
                    battle_tag=battle_tag_validator.findall(battle_tag)[0],
                    discord=discord,
                    twitch=twitch,
                    smurfs=battle_tag_validator.findall(smurfs),
                )
            except (IndexError, ValidationError):
                logger.error(
                    f"Invalid data in row {index + 1} of {filename}: "
                    f"Battle Tag: {battle_tag}, Discord: {discord}, Twitch: {twitch}, Smurfs: {smurfs}"
                )
                continue

            await self._create_from_row(session, payload)

        await session.commit()


csv_import = UserCsvImportService()
