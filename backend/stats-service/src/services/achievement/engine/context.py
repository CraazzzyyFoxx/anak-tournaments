"""Re-export of ``EvalContext`` — the real definition moved to domain.

``EvalContext`` is pure (zero ``AsyncSession``/``await``) and now lives in
``src.domain.achievement_eval_context``. This module stays as a thin
re-export because roughly two dozen files import it via the relative
``from ..context import EvalContext`` (every ``engine/conditions/*.py`` leaf,
plus ``evaluator.py``, ``runner.py``, ``rpc/achievements.py``, and two test
modules) — moving the class without a compatibility re-export here would
force touching all of them for a change that is otherwise a pure relocation.
"""

from __future__ import annotations

from src.domain.achievement_eval_context import EvalContext

__all__ = ("EvalContext",)
