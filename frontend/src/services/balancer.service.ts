import {
  BalanceJobCreateResponse,
  BalanceJobEvent,
  BalanceJobResult,
  BalanceJobStatusResponse,
  BalancerConfig,
  BalancerConfigResponse
} from "@/types/balancer.types";
import { apiFetch } from "@/lib/api-fetch";

const BALANCER_STREAM_PREFIX = (
  process.env.NEXT_PUBLIC_BALANCER_API_URL || "http://localhost/api/balancer"
).replace(/\/$/, "");

export default class balancerService {
  static async getConfig(): Promise<BalancerConfigResponse> {
    try {
      const response = await apiFetch("balancer", "config", { timeout: 10_000 });
      return response.json();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Failed to load balancer config: request timed out");
      }
      throw error;
    }
  }

  static async createBalanceJob(file: File, config?: BalancerConfig): Promise<BalanceJobCreateResponse> {
    const formData = new FormData();
    formData.append("file", file);

    if (config && Object.keys(config).length > 0) {
      formData.append("config", JSON.stringify(config));
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

  static streamBalanceJob(
    jobId: string,
    handlers: {
      onEvent: (event: BalanceJobEvent) => void;
      onError?: (message: string) => void;
      onOpen?: () => void;
    }
  ): () => void {
    const source = new EventSource(`${BALANCER_STREAM_PREFIX}/jobs/${jobId}/stream`, {
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
