from __future__ import annotations

import json
import typing
from pathlib import Path

from loguru import logger

from src.application.balancer.runtime_service import balance_teams_moo


def export_teams_to_json_file(teams_data: dict[str, typing.Any], output_path: str | Path) -> None:
    """Export balanced teams data to a JSON file."""
    output_path = Path(output_path)
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("w", encoding="utf-8") as file_handle:
            json.dump(teams_data, file_handle, indent=2, ensure_ascii=False)
        logger.success(f"Teams exported successfully to {output_path}")
    except Exception as exc:
        logger.error(f"Failed to export teams to {output_path}: {exc}")
        raise OSError(f"Failed to export teams to file: {exc}") from exc


def export_captains_to_txt_file(teams_data: dict[str, typing.Any], output_path: str | Path) -> None:
    """Export captain names to a text file."""
    output_path = Path(output_path)
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)

        captain_names: list[str] = []
        for team in teams_data.get("teams", []):
            for players in team.get("roster", {}).values():
                for player in players:
                    if player.get("is_captain", False):
                        captain_names.append(player["name"])

        with output_path.open("w", encoding="utf-8") as file_handle:
            for name in captain_names:
                file_handle.write(f"{name}\n")

        logger.success(f"Exported {len(captain_names)} captain names to {output_path}")
    except Exception as exc:
        logger.error(f"Failed to export captains to {output_path}: {exc}")
        raise OSError(f"Failed to export captains to file: {exc}") from exc


def balance_and_export_teams(
    input_data: dict[str, typing.Any],
    output_path: str | Path,
    config_overrides: dict[str, typing.Any] | None = None,
) -> dict[str, typing.Any]:
    """Balance teams and export the result to a JSON file."""
    teams_data = balance_teams_moo(input_data, config_overrides)[0]
    export_teams_to_json_file(teams_data, output_path)
    return teams_data
