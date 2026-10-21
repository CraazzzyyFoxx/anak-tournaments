"""Deadlock's per-participant stat vocabulary (integers) and its one event type."""

from __future__ import annotations

from shared.disciplines.spec import EventTypeSpec, StatDefSpec

__all__ = ("EVENT_TYPES", "STAT_DEFS")

STAT_DEFS: tuple[StatDefSpec, ...] = (
    StatDefSpec("kills", "Kills"),
    StatDefSpec("deaths", "Deaths"),
    StatDefSpec("assists", "Assists"),
    StatDefSpec("net_worth", "Souls"),
    StatDefSpec("last_hits", "Last hits"),
    StatDefSpec("denies", "Denies"),
    #: A hero level is reached, not accumulated: summing it across games means nothing.
    StatDefSpec("level", "Level", aggregation="max"),
    StatDefSpec("player_damage", "Player damage"),
    StatDefSpec("boss_damage", "Boss damage"),
    StatDefSpec("player_healing", "Healing"),
    StatDefSpec("player_damage_taken", "Damage taken"),
)
EVENT_TYPES: tuple[EventTypeSpec, ...] = (EventTypeSpec("kill", "Kill"),)
