"""What a discipline module offers canonical ingest (P5, D95/D96): raw-byte decoders and post-binding derivations.

A decoder is pure CPU: ``decode(raw, ctx) -> MatchDoc``. It never sees a session, S3 client or roster callback, and it
never creates an alias, a player or a row; a name it cannot resolve is handed on verbatim so the one semantic validator
reports every miss. ``derive_match`` runs after the core bound the document to an encounter game: it may read shared
data (baselines) but cannot commit or write encounter/roster rows, and it returns a new document that is validated
again.

``INGESTORS`` is assembled by ``shared.disciplines`` from every spec's ``ingestors`` (``(discipline, source kind)``
pairs) and rejects a duplicate pair; an unknown pair is the caller's ``unsupported_ingestor``, never a fallback.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from shared.disciplines.spec import DisciplineSpec
    from shared.schemas.match_doc import MatchDoc, MatchHint, MatchSource

__all__ = (
    "INGESTORS",
    "BoundMatch",
    "BoundParticipant",
    "DecodeContext",
    "DecodeError",
    "Decoder",
    "DeriveMatch",
    "assemble_ingestors",
)


@dataclass(frozen=True, slots=True)
class DecodeContext:
    """Everything a decoder may read besides the bytes; immutable and free of IO handles."""

    discipline: str
    source: MatchSource
    hint: MatchHint | None
    #: When the producer handed the bytes over: the played-at of a log that carries no usable timestamp.
    received_at: datetime
    #: A character as a log spells it (canonical name or alias) -> canonical code.
    characters: Mapping[str, str] = field(default_factory=dict)
    #: ``(mode name or alias, map name or alias)`` -> canonical map code; a log names both.
    maps: Mapping[tuple[str, str], str] = field(default_factory=dict)
    #: Pairs naming more than one map (an alias or name shared inside a mode): refused, never resolved to the first.
    ambiguous_maps: frozenset[tuple[str, str]] = frozenset()
    #: Character code -> catalog ``attrs``, in catalog id order (the order the formulas have always summed in).
    attrs: Mapping[str, Mapping[str, Any]] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class BoundParticipant:
    """A document participant after the core bound it to a workspace member and an encounter seat."""

    member_id: int
    user_id: int
    encounter_team_id: int
    #: The registration rank the discipline's baselines bucket on (D96 keeps the current-registration boundary).
    rank: int
    #: The roster role code the seat was filled as; the fallback when a log shows no playtime to observe one.
    role: str | None


@dataclass(frozen=True, slots=True)
class BoundMatch:
    """The binding ``derive_match`` reads: owner, game and every participant by document key."""

    workspace_id: int
    encounter_id: int
    encounter_game_id: int
    participants: Mapping[str, BoundParticipant]


class DecodeError(ValueError):
    """The bytes are not a finishable log of this discipline; ``code`` is stable, ``misses`` feed the core diagnostics."""

    def __init__(self, code: str, message: str, *, misses: Mapping[str, tuple[str, ...]] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self._misses = dict(misses or {})

    def misses(self) -> dict[str, tuple[str, ...]]:
        """Names the catalog could not resolve by kind, shaped like ``DocumentRejected.misses()``."""
        return dict(self._misses)


Decoder = Callable[[bytes, DecodeContext], "MatchDoc"]
#: ``(session, doc, binding) -> doc``: baseline/rank-context-dependent facts, after binding.
DeriveMatch = Callable[["AsyncSession", "MatchDoc", BoundMatch], Awaitable["MatchDoc"]]

#: ``(discipline, source kind) -> decoder``, filled by ``shared.disciplines`` when the registry is imported.
INGESTORS: dict[tuple[str, str], Decoder] = {}


def assemble_ingestors(specs: Iterable[DisciplineSpec]) -> dict[tuple[str, str], Decoder]:
    ingestors: dict[tuple[str, str], Decoder] = {}
    for spec in specs:
        for kind, decoder in spec.ingestors.items():
            key = (spec.code, kind)
            if key in ingestors:
                raise ValueError(f"duplicate ingestor {key!r}")
            ingestors[key] = decoder
    return ingestors
