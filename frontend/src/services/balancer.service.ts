import {
  BalanceJobCreateResponse,
  BalanceJobEvent,
  BalanceJobResult,
  BalanceJobStatusResponse,
  BalancerConfig,
  BalancerConfigResponse
} from "@/types/balancer.types";
import { fetchWithAuth } from "@/lib/fetch-with-auth";

const BALANCER_API_PREFIX = (
  process.env.NEXT_PUBLIC_BALANCER_API_URL || "http://localhost/api/balancer"
).replace(/\/$/, "");

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const error = await response.json();
    return error?.detail || error?.message || "Request failed";
  } catch {
    return "Request failed";
  }
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetchWithAuth(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

export default class balancerService {
  static async getConfig(): Promise<BalancerConfigResponse> {
    let response: Response;
    try {
      response = await fetchWithTimeout(`${BALANCER_API_PREFIX}/config`, { method: "GET" }, 10_000);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Failed to load balancer config: request timed out");
      }
      throw error;
    }

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }

    return response.json();
  }

  static async createBalanceJob(file: File, config?: BalancerConfig): Promise<BalanceJobCreateResponse> {
    const formData = new FormData();
    formData.append("file", file);

    if (config && Object.keys(config).length > 0) {
      formData.append("config", JSON.stringify(config));
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(`${BALANCER_API_PREFIX}/jobs`, { method: "POST", body: formData }, 20_000);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Failed to create balancer job: request timed out");
      }
      throw error;
    }

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }

    return response.json();
  }

  static async getBalanceJobStatus(jobId: string): Promise<BalanceJobStatusResponse> {
    const response = await fetchWithTimeout(
      `${BALANCER_API_PREFIX}/jobs/${jobId}`,
      {
        method: "GET"
      },
      10_000
    );

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }

    return response.json();
  }

  static async getBalanceJobResult(jobId: string): Promise<BalanceJobResult> {
    const response = await fetchWithTimeout(
      `${BALANCER_API_PREFIX}/jobs/${jobId}/result`,
      {
        method: "GET"
      },
      20_000
    );

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }

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
    const source = new EventSource(`${BALANCER_API_PREFIX}/jobs/${jobId}/stream`, {
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
