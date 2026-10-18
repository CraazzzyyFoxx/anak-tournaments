"""``owt.match/1``: the canonical match document a producer submits to the ingest trust boundary (P5, D95, D96).

Structure only. Everything here is decidable from the document alone: shapes, bounds, local uniqueness and references
between its own parts. Whether a map/stat/event/role/provider/hint exists *for this workspace and discipline* is the
semantic validator's job (``parser-service`` ``services/ingest/validation.py``); nothing here touches a database.

Every object forbids unknown fields. ``segments[].attrs``, ``events[].data`` and ``facts`` values are the deliberate
extension points: JSON objects / finite numbers, checked recursively. Identifiers are preserved exactly (no strip, no
case fold); blank, NUL-bearing or non-UTF-8-encodable text never reaches persistence.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any, NoReturn

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    field_validator,
    model_validator,
)
from pydantic_core import InitErrorDetails, PydanticCustomError

from shared.core.social import matches_handle_pattern, normalize_social_handle
from shared.schemas.role import RoleRef

__all__ = (
    "MAX_ISSUES",
    "MAX_MATCH_DOC_BYTES",
    "PROTOCOL",
    "IngestIssue",
    "MatchDoc",
    "MatchDocError",
    "MatchEventDoc",
    "MatchFactDoc",
    "MatchHint",
    "MatchIdentity",
    "MatchParticipantDoc",
    "MatchSegmentDoc",
    "MatchSource",
    "MatchTeamDoc",
    "parse_match_doc",
)

PROTOCOL = "owt.match/1"
#: Mirrors the parser's ``max_match_log_bytes`` default: one body cap for every ingest route.
MAX_MATCH_DOC_BYTES = 25 * 1024 * 1024
#: Bound on issues reported for one document: a hostile document must not make diagnostics unbounded.
MAX_ISSUES = 200
_MAX_JSON_DEPTH = 32
_INT64_MAX = 2**63 - 1
_SEGMENT_MAX = 32767


@dataclass(frozen=True, slots=True)
class IngestIssue:
    """One located problem: ``path`` into the document, a stable ``code``, and for vocabulary misses their key."""

    path: list[str | int]
    code: str
    message: str
    kind: str | None = None
    raw_name: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"path": list(self.path), "code": self.code, "message": self.message}
        if self.kind is not None:
            out["kind"] = self.kind
        if self.raw_name is not None:
            out["raw_name"] = self.raw_name
        return out


class MatchDocError(ValueError):
    """The bytes are not a valid ``owt.match/1`` document; ``issues`` are bounded and located."""

    def __init__(self, issues: list[IngestIssue]) -> None:
        self.issues = tuple(issues[:MAX_ISSUES])
        first = self.issues[0] if self.issues else None
        super().__init__(f"{first.code}: {first.message}" if first else "invalid document")


def _text(value: str) -> str:
    if "\x00" in value:
        raise ValueError("must not contain NUL")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        raise ValueError("must be valid unicode text") from None
    return value


def _clean(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return _text(value)


def _code(limit: int) -> Any:
    return Annotated[str, StringConstraints(strict=True, min_length=1, max_length=limit), AfterValidator(_clean)]


def _json_object(value: dict[str, Any]) -> dict[str, Any]:
    """JSON-representable, finite, NUL-free, bounded depth -- iteratively, so hostile nesting cannot recurse."""
    stack: list[tuple[Any, int]] = [(value, 0)]
    while stack:
        node, depth = stack.pop()
        if depth > _MAX_JSON_DEPTH:
            raise ValueError(f"nesting deeper than {_MAX_JSON_DEPTH}")
        if isinstance(node, dict):
            for key, item in node.items():
                if not isinstance(key, str):
                    raise ValueError("object keys must be strings")
                _text(key)
                stack.append((item, depth + 1))
        elif isinstance(node, list):
            stack.extend((item, depth + 1) for item in node)
        elif isinstance(node, str):
            _text(node)
        elif isinstance(node, float):
            if not math.isfinite(node):
                raise ValueError("numbers must be finite")
        elif node is not None and not isinstance(node, (bool, int)):
            raise ValueError("must be JSON data")
    return value


def _aware_timestamp(value: object) -> object:
    if not isinstance(value, (str, datetime)):
        raise PydanticCustomError("timestamp_type", "must be an ISO 8601 timestamp with a timezone")
    return value


Code32 = _code(32)
Code64 = _code(64)
Code128 = _code(128)
Code255 = _code(255)
Code16 = _code(16)
Number = Annotated[float, Field(strict=True, allow_inf_nan=False)]
NonNegative = Annotated[float, Field(strict=True, allow_inf_nan=False, ge=0)]
JsonObject = Annotated[dict[str, Any], AfterValidator(_json_object)]
SegmentIndex = Annotated[int, Field(strict=True, ge=1, le=_SEGMENT_MAX)]
SegmentRef = Annotated[int, Field(strict=True, ge=0, le=_SEGMENT_MAX)]
PositiveId = Annotated[int, Field(strict=True, ge=1, le=_INT64_MAX)]

_Issue = tuple[tuple[str | int, ...], str, str]


def _fail(title: str, issues: list[_Issue]) -> NoReturn:
    raise ValidationError.from_exception_data(
        title,
        [
            InitErrorDetails(type=PydanticCustomError(code, message), loc=loc, input=None)
            for loc, code, message in issues[:MAX_ISSUES]
        ],
    )


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class MatchSource(_Strict):
    kind: Code32
    external_id: Code128 | None = None


class MatchHint(_Strict):
    """Candidate constraints only: never authority, never a workspace selector."""

    encounter_game_id: PositiveId | None = None
    encounter_id: PositiveId | None = None
    tournament_id: PositiveId | None = None


class MatchIdentity(_Strict):
    provider: Code32
    id: Code255

    @model_validator(mode="after")
    def _normalizes(self) -> MatchIdentity:
        if not normalize_social_handle(self.provider, self.id):
            _fail("MatchIdentity", [(("id",), "blank_identity", "identity id must not normalize to empty")])
        # Known providers carry a handle grammar; unknown ones are the semantic layer's to refuse.
        if not matches_handle_pattern(self.provider, self.id):
            _fail(
                "MatchIdentity", [(("id",), "invalid_identity", "identity id is not a valid handle for the provider")]
            )
        return self


class MatchTeamDoc(_Strict):
    key: Code64
    placement: Annotated[int, Field(strict=True, ge=1)] | None = None


class MatchParticipantDoc(_Strict):
    key: Code64
    team: Code64
    identity: MatchIdentity
    role: RoleRef | None = None

    @field_validator("role", mode="before")
    @classmethod
    def _role_keys(cls, value: Any) -> Any:
        """The shared model ignores extras; the canonical wire must not: only dimension/role (+ derived parent)."""
        if isinstance(value, dict):
            extra = sorted(str(key) for key in value.keys() - {"dimension", "role", "parent"})
            if extra:
                _fail("RoleRef", [((key,), "extra_forbidden", "Extra inputs are not permitted") for key in extra])
        return value

    @field_validator("role", mode="after")
    @classmethod
    def _role_leaf(cls, value: RoleRef | None) -> RoleRef | None:
        """``parent`` is never authority; the semantic layer derives it from the resolved ontology."""
        if value is None:
            return None
        _clean(value.dimension)
        _clean(value.role)
        return RoleRef(dimension=value.dimension, role=value.role)


class MatchSegmentDoc(_Strict):
    index: SegmentIndex
    kind: Code16
    attrs: JsonObject = Field(default_factory=dict)


class MatchFactDoc(_Strict):
    participant: Code64 | None = None
    team: Code64 | None = None
    entity: Code64 | None = None
    stat: Code64
    value: Number
    segment: SegmentRef = 0

    @model_validator(mode="after")
    def _one_owner(self) -> MatchFactDoc:
        if (self.participant is None) == (self.team is None):
            _fail("MatchFactDoc", [((), "fact_owner", "exactly one of participant or team is required")])
        return self


class MatchEventDoc(_Strict):
    t: NonNegative
    type: Code64
    actor: Code64 | None = None
    target: Code64 | None = None
    actor_team: Code64 | None = None
    target_team: Code64 | None = None
    entity: Code64 | None = None
    related_entity: Code64 | None = None
    segment: SegmentRef = 0
    data: JsonObject = Field(default_factory=dict)


class MatchDoc(_Strict):
    protocol: str
    discipline: Code32
    source: MatchSource
    hint: MatchHint | None = None
    played_at: Annotated[AwareDatetime, BeforeValidator(_aware_timestamp)]
    duration_s: NonNegative
    map: Code64
    teams: Annotated[list[MatchTeamDoc], Field(min_length=1)]
    participants: list[MatchParticipantDoc]
    segments: list[MatchSegmentDoc] = Field(default_factory=list)
    facts: list[MatchFactDoc] = Field(default_factory=list)
    events: list[MatchEventDoc] = Field(default_factory=list)

    @field_validator("protocol", mode="before")
    @classmethod
    def _protocol(cls, value: Any) -> Any:
        if value != PROTOCOL:
            raise PydanticCustomError("unsupported_protocol", "protocol must be exactly 'owt.match/1'")
        return value

    @model_validator(mode="after")
    def _references(self) -> MatchDoc:
        issues: list[_Issue] = []
        teams = _unique(issues, "teams", [team.key for team in self.teams], "duplicate_team_key")
        for index, team in enumerate(self.teams):
            if team.placement is not None and team.placement > len(self.teams):
                issues.append((("teams", index, "placement"), "placement_out_of_range", "placement exceeds team count"))
        people = _unique(issues, "participants", [p.key for p in self.participants], "duplicate_participant_key")
        owner_team = {p.key: p.team for p in self.participants}
        identities: set[tuple[str, str]] = set()
        for index, person in enumerate(self.participants):
            if person.team not in teams:
                issues.append((("participants", index, "team"), "unknown_team", "team key is not declared in teams"))
            identity = (person.identity.provider, normalize_social_handle(person.identity.provider, person.identity.id))
            if identity in identities:
                issues.append((("participants", index, "identity"), "duplicate_identity", "identity occurs twice"))
            identities.add(identity)
        segments = _unique(issues, "segments", [s.index for s in self.segments], "duplicate_segment_index")

        def ref(loc: tuple[str | int, ...], value: str | None, known: set[Any], code: str, what: str) -> None:
            if value is not None and value not in known:
                issues.append((loc, code, f"{what} is not declared"))

        def segment(loc: tuple[str | int, ...], value: int) -> None:
            if value != 0 and value not in segments:
                issues.append((loc, "unknown_segment", "segment index is not declared in segments"))

        natural: set[tuple[Any, ...]] = set()
        for index, fact in enumerate(self.facts):
            at = ("facts", index)
            ref((*at, "participant"), fact.participant, people, "unknown_participant", "participant key")
            ref((*at, "team"), fact.team, teams, "unknown_team", "team key")
            segment((*at, "segment"), fact.segment)
            team = fact.team if fact.participant is None else owner_team.get(fact.participant)
            key = (fact.segment, team, fact.participant, fact.entity, fact.stat)
            if key in natural:
                issues.append((at, "duplicate_fact", "fact repeats (segment, team, participant, entity, stat)"))
            natural.add(key)
        for index, event in enumerate(self.events):
            at = ("events", index)
            if event.t > self.duration_s:
                issues.append(((*at, "t"), "event_after_end", "t exceeds duration_s"))
            segment((*at, "segment"), event.segment)
            for role, person, team in (
                ("actor", event.actor, event.actor_team),
                ("target", event.target, event.target_team),
            ):
                ref((*at, role), person, people, "unknown_participant", "participant key")
                ref((*at, f"{role}_team"), team, teams, "unknown_team", "team key")
                if person in owner_team and team in teams and owner_team[person] != team:
                    issues.append(
                        ((*at, f"{role}_team"), "event_team_mismatch", f"{role}_team disagrees with the participant")
                    )
        if issues:
            _fail("MatchDoc", issues)
        return self


def _unique(issues: list[_Issue], field: str, values: list[Any], code: str) -> set[Any]:
    seen: set[Any] = set()
    for index, value in enumerate(values):
        if value in seen:
            issues.append(((field, index, "key" if field != "segments" else "index"), code, f"duplicate {field} entry"))
        seen.add(value)
    return seen


class _DuplicateKey(Exception):
    pass


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    seen: dict[str, Any] = {}
    for key, value in pairs:  # single pass: linear however many keys a hostile object carries
        if key in seen:
            raise _DuplicateKey(key)
        seen[key] = value
    return seen


def _no_constant(name: str) -> Any:
    raise ValueError(f"{name} is not valid JSON")


def _finite_float(text: str) -> float:
    value = float(text)
    if not math.isfinite(value):
        raise ValueError("number is out of range")
    return value


def parse_match_doc(raw: bytes, *, max_bytes: int = MAX_MATCH_DOC_BYTES) -> MatchDoc:
    """Strict JSON then strict structure. Raises :class:`MatchDocError`; never returns a partial document."""
    if len(raw) > max_bytes:
        raise MatchDocError([IngestIssue([], "document_too_large", f"document exceeds {max_bytes} bytes")])
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise MatchDocError([IngestIssue([], "invalid_utf8", "document is not valid UTF-8")]) from None
    try:
        data = json.loads(text, object_pairs_hook=_pairs, parse_constant=_no_constant, parse_float=_finite_float)
    except _DuplicateKey as exc:
        raise MatchDocError([IngestIssue([], "duplicate_key", f"object repeats key {str(exc)[:64]!r}")]) from None
    except RecursionError:
        raise MatchDocError([IngestIssue([], "invalid_json", "document nests too deeply")]) from None
    except ValueError as exc:  # JSONDecodeError (incl. trailing data), NaN/Infinity, oversized integer literals
        raise MatchDocError([IngestIssue([], "invalid_json", str(exc)[:200])]) from None
    if not isinstance(data, dict):
        raise MatchDocError([IngestIssue([], "invalid_document", "document must be a JSON object")])
    try:
        return MatchDoc.model_validate(data)
    except ValidationError as exc:
        raise MatchDocError(
            [IngestIssue(list(error["loc"]), error["type"], error["msg"]) for error in exc.errors()]
        ) from None
