from __future__ import annotations

import typing

from src.config_presets import ConfigPresets
from src.core.config import AlgorithmConfig
from src.domain.balancer.public_contract import (
    drop_legacy_public_config_keys,
    normalize_config_overrides as normalize_external_config_overrides,
    normalize_persisted_config_payload,
    serialize_algorithm_config,
)

CONFIG_LIMITS: dict[str, dict[str, int | float]] = {
    "population_size": {"min": 10, "max": 1000},
    "generation_count": {"min": 10, "max": 5000},
    "mutation_rate": {"min": 0.0, "max": 1.0},
    "mutation_strength": {"min": 1, "max": 100},
    "average_mmr_balance_weight": {"min": 0.0, "max": 10000.0},
    "team_total_balance_weight": {"min": 0.0, "max": 10000.0},
    "role_discomfort_weight": {"min": 0.0, "max": 10000.0},
    "intra_team_variance_weight": {"min": 0.0, "max": 10000.0},
    "max_role_discomfort_weight": {"min": 0.0, "max": 10000.0},
    "role_line_balance_weight": {"min": 0.0, "max": 10000.0},
    "role_spread_weight": {"min": 0.0, "max": 10000.0},
    "intra_team_std_weight": {"min": 0.0, "max": 10000.0},
    "internal_role_spread_weight": {"min": 0.0, "max": 10000.0},
    "sub_role_collision_weight": {"min": 0.0, "max": 10000.0},
    "max_team_gap_weight": {"min": 0.0, "max": 10000.0},
    "max_result_variants": {"min": 1, "max": 200},
    "team_variance_weight": {"min": 0.0, "max": 10.0},
    "team_spread_weight": {"min": 0.0, "max": 10.0},
    "sub_role_penalty_weight": {"min": 0.0, "max": 10.0},
}

EDITABLE_CONFIG_FIELD_KEYS = {
    "role_mask",
    "algorithm",
    "population_size",
    "generation_count",
    "mutation_rate",
    "mutation_strength",
    "average_mmr_balance_weight",
    "team_total_balance_weight",
    "max_team_gap_weight",
    "role_discomfort_weight",
    "intra_team_variance_weight",
    "max_role_discomfort_weight",
    "role_line_balance_weight",
    "role_spread_weight",
    "intra_team_std_weight",
    "internal_role_spread_weight",
    "sub_role_collision_weight",
    "use_captains",
    "max_result_variants",
    "team_variance_weight",
    "team_spread_weight",
    "sub_role_penalty_weight",
}

SYSTEM_CONFIG_FIELD_KEYS = {
    "workspace_id",
    "tournament_id",
    "division_grid",
    "division_scope",
    "mixtura_queue",
}

CONFIG_FIELD_DEFINITIONS: list[dict[str, typing.Any]] = [
    {
        "key": "role_mask",
        "label": "Role mask",
        "description": "Required player count per team role. Default Overwatch format is 1 Tank, 2 Damage, 2 Support.",
        "type": "role_mask",
        "group": "Roles",
        "applies_to": ["moo", "cpsat", "mixtura_balancer"],
    },
    {
        "key": "algorithm",
        "label": "Algorithm",
        "description": "Selects the solver used to produce teams.",
        "type": "select",
        "group": "Algorithm",
        "options": ["moo", "cpsat", "mixtura_balancer"],
        "applies_to": ["moo", "cpsat", "mixtura_balancer"],
    },
    {
        "key": "population_size",
        "label": "Population size",
        "description": "Number of candidate balances kept per generation. Higher values improve search coverage and cost more time.",
        "type": "integer",
        "group": "Algorithm",
        "applies_to": ["moo", "mixtura_balancer"],
    },
    {
        "key": "generation_count",
        "label": "Generations",
        "description": "Maximum optimization iterations. Higher values can improve quality and increase runtime.",
        "type": "integer",
        "group": "Algorithm",
        "applies_to": ["moo", "mixtura_balancer"],
    },
    {
        "key": "mutation_rate",
        "label": "Mutation rate",
        "description": "Probability that a solution is changed while producing the next generation.",
        "type": "float",
        "group": "Algorithm",
        "applies_to": ["moo"],
    },
    {
        "key": "mutation_strength",
        "label": "Mutation strength",
        "description": "Number of swap/change operations attempted during a mutation.",
        "type": "integer",
        "group": "Algorithm",
        "applies_to": ["moo"],
    },
    {
        "key": "average_mmr_balance_weight",
        "label": "Average MMR balance",
        "description": "Penalty weight for differences between team average MMR values.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["moo"],
    },
    {
        "key": "team_total_balance_weight",
        "label": "Team total consistency",
        "description": "Penalty weight for standard deviation of total team rating sums.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["moo"],
    },
    {
        "key": "max_team_gap_weight",
        "label": "Max team gap",
        "description": "Penalty weight for the rating gap between the strongest and weakest teams.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["moo"],
    },
    {
        "key": "role_discomfort_weight",
        "label": "Role discomfort",
        "description": "Penalty weight for assigning players away from their preferred roles.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["moo"],
    },
    {
        "key": "intra_team_variance_weight",
        "label": "In-team variance",
        "description": "Penalty weight for rating spread inside each team.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["moo"],
    },
    {
        "key": "max_role_discomfort_weight",
        "label": "Worst discomfort",
        "description": "Penalty weight for the single worst role discomfort assignment in a solution.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["moo"],
    },
    {
        "key": "role_line_balance_weight",
        "label": "Role line balance",
        "description": "Penalty weight for uneven rating strength between the same role across teams.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["moo"],
    },
    {
        "key": "role_spread_weight",
        "label": "Role spread",
        "description": "Penalty weight for uneven role-line strength inside a team.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["moo", "mixtura_balancer"],
    },
    {
        "key": "sub_role_collision_weight",
        "label": "Subrole collision",
        "description": "Penalty weight per pair of players in the same team sharing the same role subclass.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["moo"],
    },
    {
        "key": "intra_team_std_weight",
        "label": "Intra-team rating std",
        "description": "Weight for rating spread inside each team. Used by Rust MOO and as a blend coefficient in mixtura-balancer.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["moo", "mixtura_balancer"],
    },
    {
        "key": "internal_role_spread_weight",
        "label": "Internal role spread",
        "description": "Penalty weight for uneven average strength between roles inside the same team.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["moo"],
    },
    {
        "key": "use_captains",
        "label": "Use captains",
        "description": "Marks top-rated players as captains and uses them as team anchors when supported by the solver.",
        "type": "boolean",
        "group": "Strategy",
        "applies_to": ["moo"],
    },
    {
        "key": "max_result_variants",
        "label": "Result variants",
        "description": "Maximum number of solution variants returned by the selected solver.",
        "type": "integer",
        "group": "Solver output",
        "applies_to": ["moo", "cpsat", "mixtura_balancer"],
    },
    {
        "key": "team_variance_weight",
        "label": "Team variance weight",
        "description": "Weight of team rating variance in the mixtura-balancer objective.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["mixtura_balancer"],
    },
    {
        "key": "team_spread_weight",
        "label": "Team spread blend",
        "description": "Blend coefficient for per-team player spread variance in the folded balance objective.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["mixtura_balancer"],
    },
    {
        "key": "sub_role_penalty_weight",
        "label": "Subrole blend",
        "description": "Blend coefficient for subrole penalty in the folded balance objective.",
        "type": "float",
        "group": "Quality weights",
        "applies_to": ["mixtura_balancer"],
    },
]


def normalize_config_overrides(config_overrides: dict[str, typing.Any]) -> dict[str, typing.Any]:
    return normalize_external_config_overrides(config_overrides)


def normalize_tournament_config_payload(config_payload: dict[str, typing.Any] | None) -> dict[str, typing.Any]:
    from src.schemas.balancer import ConfigOverrides

    sanitized_payload = drop_legacy_public_config_keys(config_payload)
    if not sanitized_payload:
        return {}

    editable_payload: dict[str, typing.Any] = {}
    unknown_keys: dict[str, typing.Any] = {}

    for key, value in sanitized_payload.items():
        if key in EDITABLE_CONFIG_FIELD_KEYS:
            if value is not None:
                editable_payload[key] = value
            continue
        if key in SYSTEM_CONFIG_FIELD_KEYS:
            continue
        unknown_keys[key] = value

    if unknown_keys:
        ConfigOverrides.model_validate(unknown_keys)

    validated = ConfigOverrides.model_validate(editable_payload)
    return validated.model_dump(exclude_none=True)


def serialize_saved_config_payload(config_payload: dict[str, typing.Any] | None) -> dict[str, typing.Any]:
    return normalize_persisted_config_payload(config_payload)


def build_config_fields(defaults: dict[str, typing.Any]) -> list[dict[str, typing.Any]]:
    fields: list[dict[str, typing.Any]] = []
    for definition in CONFIG_FIELD_DEFINITIONS:
        key = definition["key"]
        fields.append(
            {
                **definition,
                "default": defaults.get(key),
                "limits": CONFIG_LIMITS.get(key),
            }
        )
    return fields


def get_balancer_config_payload() -> dict[str, typing.Any]:
    presets = {
        name: normalize_persisted_config_payload(value.copy())
        for name, value in ConfigPresets.__dict__.items()
        if name.isupper() and isinstance(value, dict)
    }
    defaults = serialize_algorithm_config(AlgorithmConfig())
    return {
        "defaults": defaults,
        "limits": CONFIG_LIMITS,
        "presets": presets,
        "fields": build_config_fields(defaults),
    }


class BalancerConfigService:
    def get_payload(self) -> dict:
        return get_balancer_config_payload()
