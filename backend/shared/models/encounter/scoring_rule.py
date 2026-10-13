"""How a stage or an encounter turns raw game numbers into a standing (§5, D51).

One row holds both levels the engine needs: ``game_formula`` pays a single game,
``end_formula`` says when the series or lobby is over. The ``wins`` preset is the
old duel behaviour written down (``win`` per game, "best of" as the end rule);
``points`` carries what used to live on ``tournament.stage`` as ``ffa_columns`` /
``ffa_formula`` / ``ffa_placement_points``.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import ARRAY, JSON, CheckConstraint, Float, ForeignKey, String, UniqueConstraint, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, column_property, mapped_column

from shared.core import db
from shared.models.encounter.encounter import Encounter

__all__ = ("ScoringRule",)

# float8[] in Postgres, JSON under SQLite -- the same variant ``tournament.stage``
# uses for the columns this one replaces: a PostgreSQL ARRAY has no SQLite bind.
_FLOAT_ARRAY = ARRAY(Float()).with_variant(JSON(), "sqlite")


class ScoringRule(db.TimeStampIntegerMixin):
    __tablename__ = "scoring_rule"
    __table_args__ = (
        # The target of ``fk_encounter_scoring_rule``: an encounter may only
        # point at a rule of its own workspace, and the DB checks it (D62).
        UniqueConstraint("id", "workspace_id", name="uq_scoring_rule_id_workspace"),
        CheckConstraint("preset IN ('wins', 'points')", name="ck_scoring_rule_preset"),
        CheckConstraint("jsonb_typeof(columns) = 'array'", name="ck_scoring_rule_columns"),
        {"schema": "encounter"},
    )

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"))
    #: ``wins`` | ``points``.
    preset: Mapped[str] = mapped_column(String(16))
    #: What the organizer enters per game -- ``{"key", "label", "public", "better"}``
    #: per column. Empty for ``wins``.
    columns: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    #: Points for 1st, 2nd, ... place; empty = placement pays nothing.
    placement_points: Mapped[list[float]] = mapped_column(_FLOAT_ARRAY, default=list, server_default="{}")
    #: Variables: ``place``, ``place_pts``, ``teams``, ``win``, column keys.
    game_formula: Mapped[str] = mapped_column(String(500))
    #: Variables: ``best_of``, ``games`` (confirmed games, draws included), ``max_wins``.
    end_formula: Mapped[str] = mapped_column(String(500))


# The rule's preset, read with the encounter: a reader decides "lobby or duel"
# from how the encounter is SCORED, not from how many seats it has (a two-seat
# lobby is still a lobby). Derived rather than stored for the same reason
# ``Encounter.has_logs`` is -- no second copy to keep in step with the rule --
# and computed in the encounter's own SELECT, so a list page costs no lookups.
Encounter.scoring_preset = column_property(
    select(ScoringRule.preset).where(ScoringRule.id == Encounter.scoring_rule_id).correlate(Encounter).scalar_subquery()
)
