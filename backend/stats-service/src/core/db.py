from shared.core.db import create_database_from_settings
from src.core import config

__all__ = ("async_engine", "async_session_maker", "get_async_session")

# The statistics reads are a few large ad-hoc aggregates over facts. jit=off: their plan cost crosses jit_above_cost and
# compiling costs 140-700ms against 13-20ms of execution. force_custom_plan: pgBouncer reuses server-side prepared
# statements across clients, and the generic plans Postgres switches to after five runs estimate these aggregates at
# one row (nested loops re-running whole subtrees, past the 30s statement timeout).
_db = create_database_from_settings(
    config.settings, session_settings={"jit": "off", "plan_cache_mode": "force_custom_plan"}
)

async_engine = _db.async_engine
async_session_maker = _db.async_session_maker
get_async_session = _db.get_async_session
