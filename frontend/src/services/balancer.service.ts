import {
  BalanceJobCreateResponse,
  BalanceJobEvent,
  BalanceJobResult,
  BalanceJobStatusResponse,
  BalancerConfig,
  BalancerConfigResponse
} from "@/types/balancer.types";
import { apiFetch } from "@/lib/api-fetch";
import { getTokenFromCookies } from "@/lib/auth-tokens";

const BALANCER_STREAM_PREFIX = (
  process.env.NEXT_PUBLIC_BALANCER_API_URL || "http://localhost/api/balancer"
).replace(/\/$/, "");

const SUPPORTED_CONFIG_FIELD_TYPES = new Set([
  "boolean",
  "float",
  "integer",
  "role_mask",
  "select"
]);

function stripLegacyConfigKeys(
  config: BalancerConfig | Record<string, unknown> | null | undefined
): BalancerConfig {
  if (!config || typeof config !== "object") {
    return {};
  }

  const { input_role_mapping: _legacyRoleMapping, ...rest } = config as Record<string, unknown> & {
    input_role_mapping?: unknown;
  };

  return rest as BalancerConfig;
}

function normalizeConfigResponse(payload: BalancerConfigResponse): BalancerConfigResponse {
  return {
    ...payload,
    defaults: stripLegacyConfigKeys(payload.defaults),
    presets: Object.fromEntries(
      Object.entries(payload.presets).map(([presetName, presetConfig]) => [
        presetName,
        stripLegacyConfigKeys(presetConfig)
      ])
    ),
    fields: payload.fields.filter(
      (field) =>
        field.key !== "input_role_mapping" &&
        SUPPORTED_CONFIG_FIELD_TYPES.has(field.type as string)
    )
  };
}

export default class balancerService {
  static async getConfig(): Promise<BalancerConfigResponse> {
    try {
      const response = await apiFetch("balancer", "config", { timeout: 10_000 });
      const payload = (await response.json()) as BalancerConfigResponse;
      return normalizeConfigResponse(payload);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Failed to load balancer config: request timed out");
      }
      throw error;
    }
  }

  static async createBalanceJob(file: File, config?: BalancerConfig): Promise<BalanceJobCreateResponse> {
    const formData = new FormData();
    formData.append("player_data_file", file);

    if (config && Object.keys(config).length > 0) {
      formData.append("config_overrides", JSON.stringify(config));
    }

    try {
      const response = await apiFetch("balancer", "jobs", { method: "POST", body: formData, timeout: 20_000 });
      return response.json();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Failed to create balancer job: request timed out");
      }
      throw error;
    }
  }

  static async getBalanceJobStatus(jobId: string): Promise<BalanceJobStatusResponse> {
    const response = await apiFetch("balancer", `jobs/${jobId}`, { timeout: 10_000 });
    return response.json();
  }

  static async getBalanceJobResult(jobId: string): Promise<BalanceJobResult> {
    const response = await apiFetch("balancer", `jobs/${jobId}/result`, { timeout: 20_000 });
    return response.json();
  }

  static async streamBalanceJob(
    jobId: string,
    handlers: {
      onEvent: (event: BalanceJobEvent) => void;
      onError?: (message: string) => void;
      onOpen?: () => void;
    }
  ): Promise<() => void> {
    const token = await getTokenFromCookies("aqt_access_token");
    const url = new URL(`${BALANCER_STREAM_PREFIX}/jobs/${jobId}/stream`, window.location.origin);

    if (token) {
      url.searchParams.set("token", token);
    }

    const source = new EventSource(url.toString(), {
      withCredentials: true
    });
    let isClosed = false;

    const close = () => {
      if (isClosed) {
        return;
      }

      isClosed = true;
      source.close();
    };

    source.onopen = () => {
      handlers.onOpen?.();
    };

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as BalanceJobEvent;
        handlers.onEvent(payload);

        if (payload.status === "succeeded" || payload.status === "failed") {
          close();
        }
      } catch {
        handlers.onError?.("Failed to parse balancer stream event");
      }
    };

    source.onerror = () => {
      if (isClosed) {
        return;
      }

      handlers.onError?.("Lost connection to balancer stream");
    };

    return close;
  }
}
