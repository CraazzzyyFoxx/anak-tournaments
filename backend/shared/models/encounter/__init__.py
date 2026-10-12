"""The match layer: Postgres schema ``encounter`` (spec §13.3–§13.4).

Game-neutral by construction. An encounter seats ``slot_count`` participations
(``encounter.team``), never a home and an away side; a participation is
immutable once written, so games, rosters, claims, reports and the journal all
reference the participation row rather than the slot number it occupies (D55).
"""
# ruff: noqa: F403

from .audit import *
from .claim import *
from .encounter import *
from .game import *
from .pick_ban import *
from .readiness import *
from .report import *
from .room_event import *
from .scoring_rule import *
from .team import *
