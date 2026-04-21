"""Canonical balancer configuration presets."""

from __future__ import annotations

from typing import Any


class ConfigPresets:
    """Pre-configured settings for common balancing scenarios."""

    DEFAULT: dict[str, Any] = {
        "algorithm": "moo",
        "role_mask": {"Tank": 1, "Damage": 2, "Support": 2},
        "population_size": 200,
        "generation_count": 750,
        "mutation_rate": 0.4,
        "mutation_strength": 3,
        "average_mmr_balance_weight": 3.0,
        "team_total_balance_weight": 1.0,
        "max_team_gap_weight": 1.0,
        "role_discomfort_weight": 1.5,
        "intra_team_variance_weight": 0.8,
        "max_role_discomfort_weight": 1.5,
        "role_line_balance_weight": 1.0,
        "role_spread_weight": 1.0,
        "intra_team_std_weight": 1.0,
        "internal_role_spread_weight": 0.5,
        "sub_role_collision_weight": 5.0,
        "use_captains": True,
        "max_result_variants": 10,
    }

    COMPETITIVE: dict[str, Any] = {
        "population_size": 150,
        "generation_count": 1000,
        "mutation_rate": 0.5,
        "mutation_strength": 4,
        "average_mmr_balance_weight": 5.0,
        "role_discomfort_weight": 0.2,
        "intra_team_variance_weight": 1.0,
        "max_role_discomfort_weight": 1.5,
        "team_total_balance_weight": 1.0,
        "max_team_gap_weight": 1.0,
        "role_line_balance_weight": 1.0,
        "role_spread_weight": 1.0,
        "intra_team_std_weight": 1.0,
        "internal_role_spread_weight": 0.5,
        "sub_role_collision_weight": 10.0,
        "use_captains": True,
    }

    CASUAL: dict[str, Any] = {
        "population_size": 150,
        "generation_count": 400,
        "mutation_rate": 0.35,
        "mutation_strength": 3,
        "average_mmr_balance_weight": 2.0,
        "role_discomfort_weight": 0.5,
        "intra_team_variance_weight": 0.5,
        "max_role_discomfort_weight": 0.8,
        "team_total_balance_weight": 1.0,
        "max_team_gap_weight": 1.0,
        "role_line_balance_weight": 1.0,
        "role_spread_weight": 1.0,
        "intra_team_std_weight": 1.0,
        "internal_role_spread_weight": 0.5,
        "sub_role_collision_weight": 0.0,
        "use_captains": False,
    }

    QUICK: dict[str, Any] = {
        "population_size": 50,
        "generation_count": 200,
        "mutation_rate": 0.3,
        "mutation_strength": 2,
        "average_mmr_balance_weight": 3.0,
        "role_discomfort_weight": 0.25,
        "intra_team_variance_weight": 0.8,
        "max_role_discomfort_weight": 1.0,
        "team_total_balance_weight": 1.0,
        "max_team_gap_weight": 1.0,
        "role_line_balance_weight": 1.0,
        "role_spread_weight": 1.0,
        "intra_team_std_weight": 1.0,
        "internal_role_spread_weight": 0.5,
        "sub_role_collision_weight": 0.0,
        "use_captains": False,
    }

    PREFERENCE_FOCUSED: dict[str, Any] = {
        "population_size": 200,
        "generation_count": 750,
        "mutation_rate": 0.4,
        "mutation_strength": 3,
        "average_mmr_balance_weight": 2.0,
        "role_discomfort_weight": 1.0,
        "intra_team_variance_weight": 0.5,
        "max_role_discomfort_weight": 2.0,
        "team_total_balance_weight": 1.0,
        "max_team_gap_weight": 1.0,
        "role_line_balance_weight": 1.0,
        "role_spread_weight": 1.0,
        "intra_team_std_weight": 1.0,
        "internal_role_spread_weight": 0.5,
        "sub_role_collision_weight": 5.0,
        "use_captains": True,
    }

    MOO: dict[str, Any] = {
        "algorithm": "moo",
        "population_size": 200,
        "generation_count": 750,
        "mutation_rate": 0.6,
        "mutation_strength": 3,
        "max_result_variants": 10,
        "average_mmr_balance_weight": 3.0,
        "role_discomfort_weight": 1.5,
        "intra_team_variance_weight": 0.8,
        "max_role_discomfort_weight": 1.5,
        "team_total_balance_weight": 1.0,
        "max_team_gap_weight": 1.0,
        "role_line_balance_weight": 1.0,
        "role_spread_weight": 1.0,
        "intra_team_std_weight": 1.0,
        "internal_role_spread_weight": 0.5,
        "sub_role_collision_weight": 5.0,
        "use_captains": True,
    }

    CPSAT: dict[str, Any] = {
        "algorithm": "cpsat",
        "max_result_variants": 3,
    }

    MIXTURA_BALANCER: dict[str, Any] = {
        "algorithm": "mixtura_balancer",
        "population_size": 200,
        "generation_count": 1000,
        "max_result_variants": 10,
        "team_variance_weight": 1.0,
        "role_spread_weight": 0.0,
        "team_spread_weight": 0.1,
        "sub_role_penalty_weight": 0.1,
        "intra_team_std_weight": 0.0,
    }

    HIGH_QUALITY: dict[str, Any] = {
        "population_size": 300,
        "generation_count": 1000,
        "mutation_rate": 0.85,
        "mutation_strength": 4,
        "max_team_gap_weight": 60.0,
        "team_total_balance_weight": 40.0,
        "average_mmr_balance_weight": 30.0,
        "max_role_discomfort_weight": 150.0,
        "role_discomfort_weight": 80.0,
        "intra_team_variance_weight": 0.0,
        "role_spread_weight": 0.0,
        "intra_team_std_weight": 1.0,
        "internal_role_spread_weight": 0.5,
        "role_line_balance_weight": 5.0,
        "sub_role_collision_weight": 10.0,
        "use_captains": True,
    }


class ConfigBuilder:
    """Helper to compose canonical balancer configuration payloads."""

    def __init__(self, preset: str | None = None) -> None:
        self.config = {}
        if preset:
            preset_upper = preset.upper()
            if not hasattr(ConfigPresets, preset_upper):
                raise ValueError(f"Unknown preset: {preset}")
            self.config = getattr(ConfigPresets, preset_upper).copy()
        else:
            self.config = ConfigPresets.DEFAULT.copy()

    def with_role_mask(self, role_mask: dict[str, int]) -> "ConfigBuilder":
        if not role_mask or not any(value > 0 for value in role_mask.values()):
            raise ValueError("Role mask must have at least one role with count > 0")
        self.config["role_mask"] = role_mask
        return self

    def with_population(self, population_size: int, generation_count: int) -> "ConfigBuilder":
        if not 10 <= population_size <= 1000:
            raise ValueError("Population size must be between 10 and 1000")
        if not 10 <= generation_count <= 5000:
            raise ValueError("Generations must be between 10 and 5000")
        self.config["population_size"] = population_size
        self.config["generation_count"] = generation_count
        return self

    def with_ga_parameters(
        self,
        mutation_rate: float | None = None,
        mutation_strength: int | None = None,
    ) -> "ConfigBuilder":
        if mutation_rate is not None:
            if not 0 <= mutation_rate <= 1:
                raise ValueError("Mutation rate must be between 0 and 1")
            self.config["mutation_rate"] = mutation_rate
        if mutation_strength is not None:
            if not 1 <= mutation_strength <= 10:
                raise ValueError("Mutation strength must be between 1 and 10")
            self.config["mutation_strength"] = mutation_strength
        return self

    def with_weights(
        self,
        average_mmr_balance_weight: float | None = None,
        role_discomfort_weight: float | None = None,
        intra_team_variance_weight: float | None = None,
        max_role_discomfort_weight: float | None = None,
        team_total_balance_weight: float | None = None,
        max_team_gap_weight: float | None = None,
        role_line_balance_weight: float | None = None,
        role_spread_weight: float | None = None,
        intra_team_std_weight: float | None = None,
        internal_role_spread_weight: float | None = None,
    ) -> "ConfigBuilder":
        overrides = {
            "average_mmr_balance_weight": average_mmr_balance_weight,
            "role_discomfort_weight": role_discomfort_weight,
            "intra_team_variance_weight": intra_team_variance_weight,
            "max_role_discomfort_weight": max_role_discomfort_weight,
            "team_total_balance_weight": team_total_balance_weight,
            "max_team_gap_weight": max_team_gap_weight,
            "role_line_balance_weight": role_line_balance_weight,
            "role_spread_weight": role_spread_weight,
            "intra_team_std_weight": intra_team_std_weight,
            "internal_role_spread_weight": internal_role_spread_weight,
        }
        for key, value in overrides.items():
            if value is None:
                continue
            if value < 0:
                raise ValueError(f"{key} must be >= 0")
            self.config[key] = value
        return self

    def with_captains(self, use_captains: bool) -> "ConfigBuilder":
        self.config["use_captains"] = use_captains
        return self

    def build(self) -> dict[str, Any]:
        return self.config.copy()
