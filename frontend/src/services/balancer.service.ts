import {
  BalanceJobCreateResponse,
  BalanceJobResult,
  BalanceJobStatusResponse,
  BalancerConfig,
  BalancerConfigResponse,
  BalancerConfigField,
  SUPPORTED_BALANCER_ALGORITHMS,
  SUPPORTED_BALANCER_CONFIG_KEYS
} from "@/types/balancer.types";
import { apiFetch } from "@/lib/api-fetch";

const SUPPORTED_CONFIG_FIELD_TYPES = new Set<string>([
  "boolean",
  "float",
  "integer",
  "role_mask",
  "select",
  "slider"
]);

type RawBalancerConfigField = Omit<BalancerConfigField, "key"> & {
  key: string;
};

type RawBalancerConfigResponse = Omit<BalancerConfigResponse, "defaults" | "presets" | "fields"> & {
  defaults: Record<string, unknown>;
  presets: Record<string, Record<string, unknown>>;
  fields: RawBalancerConfigField[];
};

const SUPPORTED_BALANCER_ALGORITHM_SET = new Set<string>(SUPPORTED_BALANCER_ALGORITHMS);
const SUPPORTED_BALANCER_CONFIG_KEY_SET = new Set<string>(SUPPORTED_BALANCER_CONFIG_KEYS);

function normalizeAlgorithm(
  value: unknown
): BalancerConfig["algorithm"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return SUPPORTED_BALANCER_ALGORITHM_SET.has(value)
    ? (value as BalancerConfig["algorithm"])
    : undefined;
}

function sanitizeConfigForFrontend(
  config: BalancerConfig | Record<string, unknown> | null | undefined
): BalancerConfig {
  if (!config || typeof config !== "object") {
    return {};
  }

  const entries = Object.entries(config).flatMap(([key, value]) => {
    if (!SUPPORTED_BALANCER_CONFIG_KEY_SET.has(key) || value === undefined || value === null) {
      return [];
    }

    if (key === "algorithm") {
      const algorithm = normalizeAlgorithm(value);
      return algorithm ? [[key, algorithm]] : [];
    }

    return [[key, value]];
  });

  return Object.fromEntries(entries) as BalancerConfig;
}

function normalizeConfigField(
  field: RawBalancerConfigField,
  defaults: BalancerConfig
): BalancerConfigField | null {
  if (
    !SUPPORTED_BALANCER_CONFIG_KEY_SET.has(field.key) ||
    !SUPPORTED_CONFIG_FIELD_TYPES.has(field.type as string)
  ) {
    return null;
  }

  const options =
    field.key === "algorithm"
      ? (field.options ?? []).filter((option) => SUPPORTED_BALANCER_ALGORITHM_SET.has(option))
      : field.options;

  return {
    ...field,
    key: field.key as BalancerConfigField["key"],
    options,
    default: defaults[field.key as keyof BalancerConfig] ?? field.default
  };
}

function normalizeConfigResponse(payload: RawBalancerConfigResponse): BalancerConfigResponse {
  const defaults = sanitizeConfigForFrontend(payload.defaults);
  const presets = Object.fromEntries(
    Object.entries(payload.presets).flatMap(([presetName, presetConfig]) => {
      const algorithm = normalizeAlgorithm(presetConfig.algorithm);
      if (presetConfig.algorithm !== undefined && !algorithm) {
        return [];
      }

      return [[presetName, sanitizeConfigForFrontend(presetConfig)]];
    })
  );

  return {
    ...payload,
    defaults,
    presets,
    fields: payload.fields
      .map((field) => normalizeConfigField(field, defaults))
      .filter((field): field is BalancerConfigField => field !== null)
  };
}

export default class balancerService {
  static async getConfig(): Promise<BalancerConfigResponse> {
    try {
      const response = await apiFetch("/api/balancer/config", { timeout: 10_000 });
      const payload = (await response.json()) as RawBalancerConfigResponse;
      return normalizeConfigResponse(payload);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Failed to load balancer config: request timed out");
      }
      throw error;
    }
  }

  /**
   * Runs the tournament's own pool through the solver. The player payload is
   * assembled server-side from the roster engine — the browser sends only the
   * config it wants, never a rebuilt copy of everyone's roles and ranks.
   *
   * The route is tournament-scoped, so job status fans out over that
   * tournament's realtime topic to everyone with the balancer page open.
   */
  static async createTournamentBalanceJob(params: {
    tournament_id: number;
    config_overrides?: BalancerConfig | null;
  }): Promise<BalanceJobCreateResponse> {
    try {
      const response = await apiFetch(
        `/api/balancer/tournaments/${params.tournament_id}/balance`,
        {
          method: "POST",
          body: { config_overrides: params.config_overrides ?? null },
          timeout: 20_000
        }
      );
      return response.json();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Failed to create balancer job: request timed out");
      }
      throw error;
    }
  }

  static async getBalanceJobStatus(jobId: string): Promise<BalanceJobStatusResponse> {
    const response = await apiFetch(`/api/balancer/jobs/${jobId}`, { timeout: 10_000 });
    return response.json();
  }

  static async getBalanceJobResult(jobId: string): Promise<BalanceJobResult> {
    const response = await apiFetch(`/api/balancer/jobs/${jobId}/result`, { timeout: 20_000 });
    return response.json();
  }
}
