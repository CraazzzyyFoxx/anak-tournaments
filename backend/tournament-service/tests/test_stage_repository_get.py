"""A list page resolves the same few stages once per row: the second lookup is free."""

from __future__ import annotations

import sqlalchemy as sa

from shared.repository import StageItemRepository, StageRepository
from tests._encounter_layer import EncounterLayerCase


class StageLookupTests(EncounterLayerCase):
    """``get`` without eager-load options is ``session.get``."""

    async def test_a_plain_get_is_an_identity_map_hit(self) -> None:
        statements: list[str] = []

        def record(_conn, _cursor, statement, *_rest) -> None:
            statements.append(statement)

        sa.event.listen(self.engine.sync_engine, "before_cursor_execute", record)
        try:
            async with self.Session() as s:
                for repo, row_id in ((StageRepository(), self.stage_id), (StageItemRepository(), self.item_id)):
                    first = await repo.get(s, row_id)
                    before = len(statements)
                    self.assertIs(first, await repo.get(s, row_id))
                    self.assertEqual(before, len(statements))
        finally:
            sa.event.remove(self.engine.sync_engine, "before_cursor_execute", record)
