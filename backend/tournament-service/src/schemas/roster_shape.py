"""Re-export of the shared roster-shape read model.

The class itself lives in ``shared.schemas.roster_slots`` because the draft board
serves the same resolved shape to the same frontend; a second copy here would be
exactly the mirror this feature removes. This module keeps the historical import
path (``src.schemas.RosterShapeRead``) working for the tournament read schemas.
"""

from shared.schemas.roster_slots import RosterShapeRead

__all__ = ("RosterShapeRead",)
