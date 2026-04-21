import type { BalancerConfig, BalancerConfigResponse } from "@/types/balancer.types";

export const CUSTOM_PRESET = "CUSTOM";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const NUMERIC_CONFIG_KEYS = new Set<string>([
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
  "max_result_variants",
  "team_variance_weight",
  "team_spread_weight",
  "sub_role_penalty_weight"
]);

type SanitizeOptions = {
  preserveDraftStrings?: boolean;
};

function sortJsonValue(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nestedValue]) => nestedValue !== undefined && nestedValue !== null)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)])
    );
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  return null;
}

export function sanitizeBalancerConfig(
  config: BalancerConfig | null | undefined,
  options: SanitizeOptions = {}
): BalancerConfig {
  if (!config) {
    return {};
  }

  const entries = Object.entries(config).flatMap(([key, value]) => {
    if (value === undefined || value === null) {
      return [];
    }

    if (typeof value === "string") {
      const trimmedValue = value.trim();
      if (trimmedValue === "") {
        return options.preserveDraftStrings ? [[key, ""]] : [];
      }

      if (NUMERIC_CONFIG_KEYS.has(key)) {
        if (options.preserveDraftStrings) {
          return [[key, trimmedValue]];
        }

        const numericValue = Number(trimmedValue);
        return Number.isFinite(numericValue) ? [[key, numericValue]] : [];
      }
    }

    return [[key, value]];
  });

  return Object.fromEntries(entries) as BalancerConfig;
}

export function serializeBalancerConfig(config: BalancerConfig | null | undefined): string {
  return JSON.stringify(sortJsonValue(sanitizeBalancerConfig(config)));
}

export function areBalancerConfigsEqual(
  left: BalancerConfig | null | undefined,
  right: BalancerConfig | null | undefined
): boolean {
  return serializeBalancerConfig(left) === serializeBalancerConfig(right);
}

export function resolveInitialBalancerConfig(
  configData: BalancerConfigResponse,
  tournamentConfig: Record<string, unknown> | null | undefined
): BalancerConfig {
  return sanitizeBalancerConfig(
    (tournamentConfig as BalancerConfig | null | undefined) ?? configData.defaults
  );
}

export function findMatchingPreset(
  config: BalancerConfig,
  presets: Record<string, BalancerConfig>
): string | null {
  for (const [presetName, presetConfig] of Object.entries(presets)) {
    if (areBalancerConfigsEqual(config, presetConfig)) {
      return presetName;
    }
  }

  return null;
}

export function getRunConfig(
  draftConfig: BalancerConfig,
  configData: BalancerConfigResponse | undefined,
  selectedPreset: string
): BalancerConfig | undefined {
  const sanitizedDraft = sanitizeBalancerConfig(draftConfig);

  if (Object.keys(sanitizedDraft).length > 0) {
    return sanitizedDraft;
  }

  if (!configData) {
    return undefined;
  }

  if (selectedPreset !== CUSTOM_PRESET && configData.presets[selectedPreset]) {
    return sanitizeBalancerConfig(configData.presets[selectedPreset]);
  }

  return sanitizeBalancerConfig(configData.defaults);
}
