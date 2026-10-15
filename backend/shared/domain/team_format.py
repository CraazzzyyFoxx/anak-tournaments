"""A team format (§8.3, D33, D35, D88): what a roster must look like on one event.

``TeamFormat`` is the value of one ``roster.team_format`` row with its dimension modes and role rules. Three uses, all
pure: ``check_team_format`` (an organizer's write), ``slot_shape`` (the slots the balancer and the draft fill, D33) and
``validate_roster`` (a roster against the format, §8.3 steps 1-6). ``shared.services.team_format`` loads and stores it.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from itertools import chain

from shared.disciplines.spec import TeamFormatPreset
from shared.domain.roles import Ontology, RoleNode, UnknownRole
from shared.domain.roster_shape import FLEX_SLOT_CODE, MAX_TEAM_SIZE, RosterShape

__all__ = (
    "DIMENSION_MODES",
    "FormatDimension",
    "FormatRule",
    "RosterVerdict",
    "TeamFormat",
    "TeamFormatError",
    "Violation",
    "check_team_format",
    "slot_shape",
    "validate_roster",
)

DIMENSION_MODES: tuple[str, ...] = ("off", "informational", "preference", "enforced")


class TeamFormatError(ValueError):
    """A format that cannot be stored, carrying the machine-readable ``code`` the frontend localizes."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


@dataclass(frozen=True, slots=True)
class FormatDimension:
    dimension: str
    mode: str
    player_min_assignments: int | None = None
    player_max_assignments: int | None = None


@dataclass(frozen=True, slots=True)
class FormatRule:
    dimension: str
    role: str
    hard_min: int | None = None
    hard_max: int | None = None
    recommended_min: int | None = None
    recommended_max: int | None = None
    include_descendants: bool = True


@dataclass(frozen=True, slots=True)
class TeamFormat:
    discipline: str
    name: str
    starter_min: int
    starter_max: int
    substitute_min: int = 0
    substitute_max: int = 0
    dimensions: tuple[FormatDimension, ...] = ()
    rules: tuple[FormatRule, ...] = ()
    preset_code: str | None = None

    @classmethod
    def from_preset(cls, discipline: str, preset: TeamFormatPreset) -> TeamFormat:
        return cls(
            discipline=discipline,
            name=preset.name,
            starter_min=preset.starter_min,
            starter_max=preset.starter_max,
            substitute_min=preset.substitute_min,
            substitute_max=preset.substitute_max,
            dimensions=tuple(
                FormatDimension(entry.dimension, entry.mode, entry.player_min_assignments, entry.player_max_assignments)
                for entry in preset.dimensions
            ),
            rules=tuple(
                FormatRule(
                    rule.dimension,
                    rule.role,
                    rule.hard_min,
                    rule.hard_max,
                    rule.recommended_min,
                    rule.recommended_max,
                    rule.include_descendants,
                )
                for rule in preset.rules
            ),
            preset_code=preset.code,
        )

    def mode(self, dimension: str) -> str:
        """``off`` for a dimension the format does not list: an unlisted axis is ignored, not forbidden (§8.3)."""
        return next((entry.mode for entry in self.dimensions if entry.dimension == dimension), "off")


@dataclass(frozen=True, slots=True)
class Violation:
    code: str
    detail: str


@dataclass(frozen=True, slots=True)
class RosterVerdict:
    #: Hard: the roster is rejected (§8.3 step 5).
    violations: tuple[Violation, ...] = ()
    #: Soft: recommendations only; never block (§8.3 step 6).
    advisories: tuple[Violation, ...] = ()

    @property
    def ok(self) -> bool:
        return not self.violations


def _bad_range(low: int | None, high: int | None) -> bool:
    return (
        (low is not None and low < 0)
        or (high is not None and high < 0)
        or (low is not None and high is not None and low > high)
    )


def check_team_format(team_format: TeamFormat, ontology: Ontology) -> None:
    """Raise ``TeamFormatError`` for a format that cannot be stored for ``ontology``'s discipline and workspace.

    The ontology holds the module's roles and ONE workspace's sub-roles, so a rule on another workspace's sub-role is
    an unknown role here (§14.3: "Подроль воркспейса в правиле — только того же воркспейса, что формат").
    """
    if team_format.discipline != ontology.discipline:
        raise TeamFormatError(
            "team_format_discipline", f"a {team_format.discipline} format checked against {ontology.discipline}"
        )
    if not 1 <= team_format.starter_min <= team_format.starter_max <= MAX_TEAM_SIZE:
        raise TeamFormatError(
            "team_format_sizes",
            f"starters {team_format.starter_min}..{team_format.starter_max} are outside 1..{MAX_TEAM_SIZE}",
        )
    if not 0 <= team_format.substitute_min <= team_format.substitute_max:
        raise TeamFormatError(
            "team_format_sizes", f"substitutes {team_format.substitute_min}..{team_format.substitute_max} are invalid"
        )
    listed: set[str] = set()
    for entry in team_format.dimensions:
        if entry.dimension not in ontology.dimensions:
            raise TeamFormatError(
                "team_format_unknown_dimension", f"{entry.dimension!r} is not a dimension of {ontology.discipline}"
            )
        if entry.dimension in listed:
            raise TeamFormatError("team_format_duplicate_dimension", f"{entry.dimension!r} is listed twice")
        if entry.mode not in DIMENSION_MODES:
            raise TeamFormatError("team_format_mode", f"{entry.mode!r} is not one of {', '.join(DIMENSION_MODES)}")
        if _bad_range(entry.player_min_assignments, entry.player_max_assignments):
            raise TeamFormatError("team_format_assignments", f"assignments on {entry.dimension!r} are an empty range")
        listed.add(entry.dimension)
    ruled: set[tuple[str, str]] = set()
    for rule in team_format.rules:
        if rule.dimension not in listed:
            raise TeamFormatError(
                "team_format_rule_dimension",
                f"the rule on {rule.role!r} names {rule.dimension!r}, a dimension the format does not list",
            )
        try:
            ontology.node(rule.dimension, rule.role)
        except UnknownRole as exc:
            raise TeamFormatError("team_format_unknown_role", str(exc)) from None
        if (rule.dimension, rule.role) in ruled:
            raise TeamFormatError("team_format_duplicate_rule", f"{rule.role!r} has two rules")
        if _bad_range(rule.hard_min, rule.hard_max) or _bad_range(rule.recommended_min, rule.recommended_max):
            raise TeamFormatError("team_format_rule_range", f"the rule on {rule.role!r} is an empty or negative range")
        ruled.add((rule.dimension, rule.role))
    slot_shape(team_format, ontology)


def slot_shape(team_format: TeamFormat, ontology: Ontology) -> RosterShape:
    """The slots the balancer and the draft fill (D33).

    Only an ``enforced`` rated dimension makes role slots: every top-level role with a ``hard_min`` gets that many
    (``n..n`` and ``n..∞`` alike). The rest of the starting line-up is open slots under the ``flex`` key -- a slot without
    a constraint, not a role (D86). ``hard_max``, sub-role rules and the other dimensions are checked on the result
    (``validate_roster``); an open slot holds no assignment, so it never counts toward a ``hard_max``.
    """
    rated = ontology.rated.code
    entries: list[tuple[str, int]] = []
    if team_format.mode(rated) == "enforced":
        minimum = {rule.role: rule.hard_min for rule in team_format.rules if rule.dimension == rated and rule.hard_min}
        entries = [(role.code, minimum[role.code]) for role in ontology.roots(rated) if role.code in minimum]
    open_slots = team_format.starter_max - sum(count for _, count in entries)
    if open_slots < 0:
        raise TeamFormatError(
            "team_format_slots_exceed_starters",
            f"role slots need {team_format.starter_max - open_slots} players; the format starts {team_format.starter_max}",
        )
    if open_slots:
        entries.append((FLEX_SLOT_CODE, open_slots))
    return RosterShape(entries=tuple(entries))


def validate_roster(
    team_format: TeamFormat,
    ontology: Ontology,
    starters: Sequence[Sequence[RoleNode]],
    substitutes: Sequence[Sequence[RoleNode]] = (),
) -> RosterVerdict:
    """§8.3: every member is the leaf roles assigned to them (D86); the verdict lists what breaks the format.

    Quotas count distinct starters holding the role -- or, with ``include_descendants``, one of its descendants.
    Assignments on active dimensions must resolve in the ontology with matching dimension ids and codes; invalid
    assignments are violations and do not count toward cardinality or quotas.
    """
    violations: list[Violation] = []
    advisories: list[Violation] = []
    if not team_format.starter_min <= len(starters) <= team_format.starter_max:
        violations.append(
            Violation(
                "starters_out_of_range",
                f"{len(starters)} starters; the format takes {team_format.starter_min}..{team_format.starter_max}",
            )
        )
    if not team_format.substitute_min <= len(substitutes) <= team_format.substitute_max:
        violations.append(
            Violation(
                "substitutes_out_of_range",
                f"{len(substitutes)} substitutes; the format takes {team_format.substitute_min}..{team_format.substitute_max}",
            )
        )
    starter_roles: dict[str, list[set[int]]] = {}
    for entry in team_format.dimensions:
        if entry.mode == "off":
            continue
        dimension = ontology.dimensions[entry.dimension]
        starter_roles[entry.dimension] = []
        # §8.3 step 3: cardinality rejects on every active dimension, whatever its mode.
        single = dimension.selection_mode == "single"
        high = entry.player_max_assignments
        if single:
            high = 1 if high is None else min(high, 1)
        low = entry.player_min_assignments
        for index, member in enumerate(chain(starters, substitutes), start=1):
            assigned: set[int] = set()
            for role in member:
                if role.dimension != entry.dimension:
                    continue
                try:
                    resolved = ontology.by_id(role.id)
                except UnknownRole as exc:
                    violations.append(Violation("unknown_role", f"member {index}: {exc}"))
                    continue
                if (
                    resolved.dimension != role.dimension
                    or resolved.dimension_id != role.dimension_id
                    or resolved.dimension_id != dimension.id
                ):
                    violations.append(
                        Violation(
                            "role_dimension_mismatch",
                            f"member {index}: role {role.id} does not match dimension {entry.dimension!r} (id {dimension.id})",
                        )
                    )
                    continue
                assigned.add(resolved.id)
            if index <= len(starters):
                starter_roles[entry.dimension].append(assigned)
            count = len(assigned)
            if (low is not None and count < low) or (high is not None and count > high):
                violations.append(
                    Violation("assignments_out_of_range", f"member {index} holds {count} {entry.dimension} roles")
                )
    for rule in team_format.rules:
        if team_format.mode(rule.dimension) == "off":
            continue
        target = ontology.node(rule.dimension, rule.role)
        wanted = ontology.subtree(target) if rule.include_descendants else frozenset({target.id})
        count = sum(not member.isdisjoint(wanted) for member in starter_roles[rule.dimension])
        # §8.3 step 5: an explicit hard bound rejects; the mode only decides slots (D33).
        if rule.hard_min is not None and count < rule.hard_min:
            violations.append(Violation("role_below_hard_min", f"{rule.role}: {count} < {rule.hard_min}"))
        if rule.hard_max is not None and count > rule.hard_max:
            violations.append(Violation("role_above_hard_max", f"{rule.role}: {count} > {rule.hard_max}"))
        if rule.recommended_min is not None and count < rule.recommended_min:
            advisories.append(Violation("role_below_recommended_min", f"{rule.role}: {count} < {rule.recommended_min}"))
        if rule.recommended_max is not None and count > rule.recommended_max:
            advisories.append(Violation("role_above_recommended_max", f"{rule.role}: {count} > {rule.recommended_max}"))
    return RosterVerdict(tuple(violations), tuple(advisories))
