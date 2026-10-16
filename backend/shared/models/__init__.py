"""Aggregator for all shared SQLAlchemy models.

Importing this package loads every model module, so string-based relationship
resolution and ``configure_mappers()`` keep working against the single shared
``db.Base.metadata``. Migration-only legacy tables are intentionally unmapped.
"""
# ruff: noqa: F403

from .achievements import *
from .analytics import *
from .balancer import *
from .custom_game import *
from .catalog import *
from .division_grid import *
from .encounter import *
from .member_rank import *
from .identity import *
from .platform import *
from .preferences import *
from .quota import *
from .ranks import *
from .registration import *
from .roster import *
from .subscriptions import *
from .stats import *
from .tenancy import *
from .tournament import *
