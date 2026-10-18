"""Division-grid half of the live ingest smoke world (P3 per-discipline defaults).

Run as a subprocess (``python _live_grids.py <app-service dir>``; the workspace schemas live in app-service's ``src``).
Reads ``{"workspaces": {label: id}}`` from stdin. For every enabled discipline of every workspace it creates a
workspace-owned published grid with its own tier number, activates it through ``WorkspaceRepository.set_default_grid_version``
(the native ``public.workspace_division_grid_default`` row keyed by ``(workspace_id, discipline)``), then serializes the
workspace exactly as the public API does and prints ``__GRIDS__{json}``: ``WorkspaceRead.default_division_grid_versions``
(discipline -> version id) and the tier numbers of ``effective_division_grid_versions`` (discipline -> payload).
"""

from __future__ import annotations

import asyncio
import importlib
import json
import sys
from pathlib import Path

APP = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(APP))
sys.path.insert(0, str(APP.parent))

from shared.testing import apply_test_env_defaults  # noqa: E402

apply_test_env_defaults()

from shared import models  # noqa: E402
from shared.repository.workspace import WorkspaceRepository  # noqa: E402
from src.core import db  # noqa: E402
from src.schemas.workspace import WorkspaceRead  # noqa: E402

TIER_NUMBER = {"overwatch": 4, "lol": 9}
workspaces = importlib.import_module("src.services.workspace.service").workspaces


async def main(ids: dict[str, int]) -> dict:
    out: dict[str, dict] = {}
    async with db.async_session_maker() as session:
        for label, workspace_id in ids.items():
            workspace = await workspaces.get_by_id(session, workspace_id)
            for code in workspace.disciplines_enabled:
                version = models.DivisionGridVersion(
                    grid=models.DivisionGrid(
                        workspace_id=workspace_id,
                        slug=f"p5-{label.lower()}-{code}",
                        name=f"{label} {code}",
                        discipline=code,
                    ),
                    version=1,
                    label=f"{label} {code}",
                    status="published",
                    tiers=[
                        models.DivisionGridTier(
                            slug=code,
                            number=TIER_NUMBER[code],
                            name=code,
                            sort_order=0,
                            rank_min=0,
                            rank_max=None,
                            icon_url="/tier.png",
                        )
                    ],
                )
                session.add(version)
                await session.flush()
                await WorkspaceRepository().set_default_grid_version(
                    session, workspace, discipline=code, version_id=version.id
                )
        await session.commit()
        for label, workspace_id in ids.items():
            loaded = await workspaces.get_by_id(session, workspace_id)
            payload = WorkspaceRead.model_validate(loaded, from_attributes=True).model_dump(mode="json")
            out[label] = {
                "default": payload["default_division_grid_versions"],
                "effective": {
                    code: {"id": data["id"], "tier_numbers": [tier["number"] for tier in data["tiers"]]}
                    for code, data in payload["effective_division_grid_versions"].items()
                },
            }
    return out


if __name__ == "__main__":
    print("__GRIDS__" + json.dumps(asyncio.run(main(json.load(sys.stdin)["workspaces"])), default=str))
