"""
Configuration presets and utilities for the balancing algorithm.

This module provides pre-configured settings for common use cases
and utilities to help build custom configurations.
"""

from typing import Any


class ConfigPresets:
    """Pre-configured settings for common balancing scenarios"""

    # Default configuration
    DEFAULT: dict[str, Any] = {
        "MASK": {"Tank": 1, "Damage": 2, "Support": 2},
        "POPULATION_SIZE": 200,
        "GENERATIONS": 750,
        "ELITISM_RATE": 0.2,
        "MUTATION_RATE": 0.4,
        "MUTATION_STRENGTH": 3,
        "MMR_DIFF_WEIGHT": 3.0,
        "DISCOMFORT_WEIGHT": 0.25,
        "INTRA_TEAM_VAR_WEIGHT": 0.8,
        "MAX_DISCOMFORT_WEIGHT": 1.0,
        "USE_CAPTAINS": True,
        "ROLE_MAPPING": {"tank": "Tank", "dps": "Damage", "damage": "Damage", "support": "Support"},
    }

    # Competitive tournament: prioritize fair matches
    COMPETITIVE: dict[str, Any] = {
        "POPULATION_SIZE": 300,
        "GENERATIONS": 1000,
        "ELITISM_RATE": 0.15,
        "MUTATION_RATE": 0.5,
        "MUTATION_STRENGTH": 4,
        "MMR_DIFF_WEIGHT": 5.0,
        "DISCOMFORT_WEIGHT": 0.2,
        "INTRA_TEAM_VAR_WEIGHT": 1.0,
        "MAX_DISCOMFORT_WEIGHT": 1.5,
        "USE_CAPTAINS": True,
    }

    # Casual event: balance speed and satisfaction
    CASUAL: dict[str, Any] = {
        "POPULATION_SIZE": 150,
        "GENERATIONS": 400,
        "ELITISM_RATE": 0.25,
        "MUTATION_RATE": 0.35,
        "MUTATION_STRENGTH": 3,
        "MMR_DIFF_WEIGHT": 2.0,
        "DISCOMFORT_WEIGHT": 0.5,
        "INTRA_TEAM_VAR_WEIGHT": 0.5,
        "MAX_DISCOMFORT_WEIGHT": 0.8,
        "USE_CAPTAINS": False,
    }

    # Quick draft: fast balancing
    QUICK: dict[str, Any] = {
        "POPULATION_SIZE": 50,
        "GENERATIONS": 200,
        "ELITISM_RATE": 0.3,
        "MUTATION_RATE": 0.3,
        "MUTATION_STRENGTH": 2,
        "MMR_DIFF_WEIGHT": 3.0,
        "DISCOMFORT_WEIGHT": 0.25,
        "INTRA_TEAM_VAR_WEIGHT": 0.8,
        "MAX_DISCOMFORT_WEIGHT": 1.0,
        "USE_CAPTAINS": False,
    }

    # Player preference priority: maximize role satisfaction
    PREFERENCE_FOCUSED: dict[str, Any] = {
        "POPULATION_SIZE": 200,
        "GENERATIONS": 750,
        "ELITISM_RATE": 0.2,
        "MUTATION_RATE": 0.4,
        "MUTATION_STRENGTH": 3,
        "MMR_DIFF_WEIGHT": 2.0,
        "DISCOMFORT_WEIGHT": 1.0,
        "INTRA_TEAM_VAR_WEIGHT": 0.5,
        "MAX_DISCOMFORT_WEIGHT": 2.0,
        "USE_CAPTAINS": True,
    }

    # High quality: slow but optimal
    HIGH_QUALITY: dict[str, Any] = {
        "POPULATION_SIZE": 500,
        "GENERATIONS": 2000,
        "ELITISM_RATE": 0.1,
        "MUTATION_RATE": 0.5,
        "MUTATION_STRENGTH": 5,
        "MMR_DIFF_WEIGHT": 4.0,
        "DISCOMFORT_WEIGHT": 0.3,
        "INTRA_TEAM_VAR_WEIGHT": 1.0,
        "MAX_DISCOMFORT_WEIGHT": 1.5,
        "USE_CAPTAINS": True,
    }


class ConfigBuilder:
    """Helper class to build custom configurations with validation"""

    def __init__(self, preset: str | None = None):
        """
        Initialize config builder with optional preset

        Args:
            preset: Name of preset to start from ('default', 'competitive',
                   'casual', 'quick', 'preference_focused', 'high_quality')
        """
        self.config = {}

        if preset:
            preset_upper = preset.upper()
            if hasattr(ConfigPresets, preset_upper):
                self.config = getattr(ConfigPresets, preset_upper).copy()
            else:
                raise ValueError(f"Unknown preset: {preset}")
        else:
            self.config = ConfigPresets.DEFAULT.copy()

    def with_role_mask(self, mask: dict[str, int]) -> "ConfigBuilder":
        """Set custom role mask"""
        if not mask or not any(v > 0 for v in mask.values()):
            raise ValueError("Role mask must have at least one role with count > 0")
        self.config["MASK"] = mask
        return self

    def with_population(self, size: int, generations: int) -> "ConfigBuilder":
        """Set population size and generation count"""
        if not 10 <= size <= 1000:
            raise ValueError("Population size must be between 10 and 1000")
        if not 10 <= generations <= 5000:
            raise ValueError("Generations must be between 10 and 5000")
        self.config["POPULATION_SIZE"] = size
        self.config["GENERATIONS"] = generations
        return self

    def with_ga_parameters(
        self,
        elitism_rate: float | None = None,
        mutation_rate: float | None = None,
        mutation_strength: int | None = None,
    ) -> "ConfigBuilder":
        """Set genetic algorithm parameters"""
        if elitism_rate is not None:
            if not 0 <= elitism_rate <= 1:
                raise ValueError("Elitism rate must be between 0 and 1")
            self.config["ELITISM_RATE"] = elitism_rate

        if mutation_rate is not None:
            if not 0 <= mutation_rate <= 1:
                raise ValueError("Mutation rate must be between 0 and 1")
            self.config["MUTATION_RATE"] = mutation_rate

        if mutation_strength is not None:
            if not 1 <= mutation_strength <= 10:
                raise ValueError("Mutation strength must be between 1 and 10")
            self.config["MUTATION_STRENGTH"] = mutation_strength

        return self

    def with_weights(
        self,
        mmr_diff: float | None = None,
        discomfort: float | None = None,
        intra_var: float | None = None,
        max_discomfort: float | None = None,
    ) -> "ConfigBuilder":
        """Set cost function weights"""
        if mmr_diff is not None:
            if mmr_diff < 0:
                raise ValueError("MMR diff weight must be >= 0")
            self.config["MMR_DIFF_WEIGHT"] = mmr_diff

        if discomfort is not None:
            if discomfort < 0:
                raise ValueError("Discomfort weight must be >= 0")
            self.config["DISCOMFORT_WEIGHT"] = discomfort

        if intra_var is not None:
            if intra_var < 0:
                raise ValueError("Intra-team variance weight must be >= 0")
            self.config["INTRA_TEAM_VAR_WEIGHT"] = intra_var

        if max_discomfort is not None:
            if max_discomfort < 0:
                raise ValueError("Max discomfort weight must be >= 0")
            self.config["MAX_DISCOMFORT_WEIGHT"] = max_discomfort

        return self

    def with_captains(self, use_captains: bool) -> "ConfigBuilder":
        """Enable or disable captain assignment"""
        self.config["USE_CAPTAINS"] = use_captains
        return self

    def with_role_mapping(self, mapping: dict[str, str]) -> "ConfigBuilder":
        """Set custom role name mapping"""
        self.config["ROLE_MAPPING"] = mapping
        return self

    def build(self) -> dict[str, Any]:
        """Build and return the configuration dictionary"""
        return self.config.copy()


# Example usage
if __name__ == "__main__":
    # Example 1: Use a preset
    config1 = ConfigPresets.COMPETITIVE
    print("Competitive preset:", config1)

    # Example 2: Build custom config from scratch
    config2 = (
        ConfigBuilder()
        .with_population(300, 1000)
        .with_weights(mmr_diff=4.0, discomfort=0.3)
        .with_captains(True)
        .build()
    )
    print("\nCustom config:", config2)

    # Example 3: Start with preset and customize
    config3 = ConfigBuilder(preset="quick").with_weights(mmr_diff=5.0).with_population(100, 300).build()
    print("\nCustomized quick preset:", config3)

    # Example 4: Custom roles
    config4 = (
        ConfigBuilder()
        .with_role_mask({"Tank": 1, "Damage": 2, "Support": 2})
        .with_role_mapping({"tank": "Tank", "dps": "Damage", "support": "Support", "healer": "Support"})
        .build()
    )
    print("\nCustom roles config:", config4)
