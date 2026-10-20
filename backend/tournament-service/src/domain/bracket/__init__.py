"""Pure bracket generation: seeds in, a ``BracketSkeleton`` of pairings and advancement edges out.

Persisting a skeleton and moving results along its edges take a session, so they live in services.
"""

from src.domain.bracket.engine import generate_bracket, placeholder_bracket, placeholder_seeds
from src.domain.bracket.swiss import SwissPairingImpossibleError, SwissStanding
from src.domain.bracket.template import (
    BracketTemplate,
    TemplateMatch,
    TemplateProblem,
    TemplateSlot,
    skeleton_to_template,
    template_to_skeleton,
    validate_template,
)
from src.domain.bracket.types import AdvancementEdge, BracketSkeleton, Pairing

__all__ = (
    "AdvancementEdge",
    "BracketSkeleton",
    "BracketTemplate",
    "Pairing",
    "SwissPairingImpossibleError",
    "SwissStanding",
    "TemplateMatch",
    "TemplateProblem",
    "TemplateSlot",
    "generate_bracket",
    "placeholder_bracket",
    "placeholder_seeds",
    "skeleton_to_template",
    "template_to_skeleton",
    "validate_template",
)
