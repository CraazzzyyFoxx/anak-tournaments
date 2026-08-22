"""Backward-compatible module-level binding.

``services/match_logs/flows.py`` (a different work package's file set) still
imports this module and calls ``map_flows.get_by_name_or_alias_and_gamemode``
directly. ``flows.py``'s logic merged into ``service.py``'s ``MapService`` (see
``docs/plans/2026-08-21-parser-service-oop-repositories.md`` rule 6); this file
exists solely to keep that dotted path resolvable, mirroring
``services/achievement/engine/differ.py``'s test-coupling seam. This is the
permanent shape, not a shim to be removed later.
"""

from __future__ import annotations

from .service import map_service

get_by_name_or_alias_and_gamemode = map_service.resolve_by_name_or_alias_and_gamemode
