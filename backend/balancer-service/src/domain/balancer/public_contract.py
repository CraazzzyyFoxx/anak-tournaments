from __future__ import annotations

import typing
from collections.abc import Mapping

from src.core.config import AlgorithmConfig

PUBLIC_CONFIG_KEYS = {
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

LEGACY_PUBLIC_CONFIG_KEYS = {
    "input_role_mapping",
    "elitism_rate",
    "stagnation_threshold",
}


def drop_legacy_public_config_keys(config_payload: Mapping[str, typing.Any] | None) -> dict[str, typing.Any]:
    if not config_payload:
        return {}

    return {
        key: value
        for key, value in dict(config_payload).items()
        if key not in LEGACY_PUBLIC_CONFIG_KEYS
    }


def normalize_persisted_config_payload(config_payload: Mapping[str, typing.Any] | None) -> dict[str, typing.Any]:
    from src.schemas.balancer import ConfigOverrides

    sanitized_payload = drop_legacy_public_config_keys(config_payload)
    if not sanitized_payload:
        return {}

    validated = ConfigOverrides.model_validate(sanitized_payload)
    return validated.model_dump(exclude_none=True)


def normalize_config_overrides(config_overrides: Mapping[str, typing.Any]) -> dict[str, typing.Any]:
    return normalize_persisted_config_payload(config_overrides)


def serialize_algorithm_config(config: AlgorithmConfig | Mapping[str, typing.Any]) -> dict[str, typing.Any]:
    payload = config.model_dump() if hasattr(config, "model_dump") else dict(config)
    return {
        key: value
        for key, value in payload.items()
        if key in PUBLIC_CONFIG_KEYS and value is not None
    }


def normalize_balance_response_payload(balance_payload: Mapping[str, typing.Any]) -> dict[str, typing.Any]:
    from src.schemas.balancer import BalanceResponse

    validated = BalanceResponse.model_validate(dict(balance_payload))
    return validated.model_dump(exclude_none=True)


def normalize_balance_job_result_payload(result_payload: Mapping[str, typing.Any]) -> dict[str, typing.Any]:
    from src.schemas.balancer import BalanceJobResult

    validated = BalanceJobResult.model_validate(dict(result_payload))
    return validated.model_dump(exclude_none=True)
