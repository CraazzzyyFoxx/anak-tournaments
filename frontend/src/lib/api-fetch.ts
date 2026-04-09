import { cache } from "react";
import { getTokenFromCookies } from "./auth-tokens";
import { retryWithRefreshOnUnauthorized } from "./auth-request";
import { parseApiError } from "./api-error";
import { useWorkspaceStore } from "@/stores/workspace.store";

// ─── Types ──────────────────────────────────────────────────────────────────

type ServiceName = "app" | "parser" | "balancer" | "auth";

interface ApiFetchOptions {
  query?: Record<string, unknown>;
  body?: unknown;
  method?: string;
  token?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  cache?: RequestCache;
  timeout?: number;
  skipWorkspace?: boolean;
  throwOnError?: boolean;
}

// ─── Service Configuration ──────────────────────────────────────────────────

interface ServiceConfig {
  clientBase: string;
  serverBase: string | undefined;
  injectWorkspace: boolean;
  defaultCache: RequestCache;
}

const cachePolicy = process.env.NEXT_PUBLIC_CACHE_POLICY;

function resolveAppCache(): RequestCache {
  switch (cachePolicy) {
    case "no-cache":
      return "no-cache";
    case "network-only":
      return "no-store";
    default:
      return "default";
  }
}

const SERVICE_CONFIG: Record<ServiceName, ServiceConfig> = {
  app: {
    clientBase: "/api/v1",
    serverBase: process.env.NEXT_PUBLIC_API_URL,
    injectWorkspace: true,
    defaultCache: resolveAppCache(),
  },
  parser: {
    clientBase: "/api/parser",
    serverBase: process.env.NEXT_PUBLIC_PARSER_API_URL,
    injectWorkspace: true,
    defaultCache: "no-store",
  },
  balancer: {
    clientBase: (process.env.NEXT_PUBLIC_BALANCER_API_URL || "http://localhost/api/balancer").replace(/\/$/, ""),
    serverBase: (process.env.NEXT_PUBLIC_BALANCER_API_URL || "http://localhost/api/balancer").replace(/\/$/, ""),
    injectWorkspace: true,
    defaultCache: "no-store",
  },
  auth: {
    clientBase: (process.env.NEXT_PUBLIC_AUTH_SERVICE_URL || "http://localhost:8001").replace(/\/$/, ""),
    serverBase: (process.env.NEXT_PUBLIC_AUTH_SERVICE_URL || "http://localhost:8001").replace(/\/$/, ""),
    injectWorkspace: false,
    defaultCache: "no-store",
  },
};

// ─── Workspace ID (server-side, cached per request) ─────────────────────────

const getServerWorkspaceId = cache(async (): Promise<string | undefined> => {
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    return cookieStore.get("aqt-workspace-id")?.value;
  } catch {
    return undefined;
  }
});

// ─── Query Param Serialization ──────────────────────────────────────────────

function appendParams(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      params.append(key, String(item));
    }
  } else if (typeof value === "object") {
    for (const subKey in value as Record<string, unknown>) {
      appendParams(params, key, (value as Record<string, unknown>)[subKey]);
    }
  } else {
    params.append(key, String(value));
  }
}

// ─── Main Function ──────────────────────────────────────────────────────────

export async function apiFetch(
  service: ServiceName,
  path: string,
  options: ApiFetchOptions = {},
): Promise<Response> {
  const config = SERVICE_CONFIG[service];
  const throwOnError = options.throwOnError ?? true;

  // Extract inline query params from path (e.g. "admin/users?page=1")
  let cleanPath = path;
  const params = new URLSearchParams();
  const qIndex = path.indexOf("?");
  if (qIndex !== -1) {
    cleanPath = path.slice(0, qIndex);
    const inline = new URLSearchParams(path.slice(qIndex + 1));
    inline.forEach((v, k) => params.append(k, v));
  }

  // Auto-inject workspace_id
  if (
    config.injectWorkspace &&
    !options.skipWorkspace &&
    !options.query?.workspace_id &&
    !params.has("workspace_id")
  ) {
    const workspaceId =
      typeof window !== "undefined"
        ? useWorkspaceStore.getState().currentWorkspaceId
        : await getServerWorkspaceId();

    if (workspaceId != null) {
      params.append("workspace_id", String(workspaceId));
    }
  }

  // Serialize query options
  if (options.query) {
    for (const key in options.query) {
      appendParams(params, key, options.query[key]);
    }
  }

  // Build URL
  const baseUrl =
    typeof window !== "undefined"
      ? config.clientBase
      : (config.serverBase ?? config.clientBase);

  const sep = cleanPath.startsWith("/") ? "" : "/";
  const qs = params.toString();
  const url = qs
    ? `${baseUrl}${sep}${cleanPath}?${qs}`
    : `${baseUrl}${sep}${cleanPath}`;

  // Auth token
  const initialToken = options.token ?? (await getTokenFromCookies("aqt_access_token"));

  // Headers
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = { ...options.headers };
  if (!isFormData && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  // Timeout
  let abortController: AbortController | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let signal = options.signal;

  if (options.timeout && !signal) {
    abortController = new AbortController();
    signal = abortController.signal;
    timeoutId = setTimeout(() => abortController!.abort(), options.timeout);
  }

  // Request runner (for auth retry)
  const runRequest = async (tokenToUse?: string): Promise<Response> => {
    const requestHeaders: Record<string, string> = { ...headers };
    if (tokenToUse) {
      requestHeaders.Authorization = `Bearer ${tokenToUse}`;
    }

    return fetch(url, {
      cache: options.cache ?? config.defaultCache,
      headers: requestHeaders,
      body: isFormData ? (options.body as FormData) : options.body ? JSON.stringify(options.body) : undefined,
      method: options.method || "GET",
      signal,
    });
  };

  try {
    const response = await retryWithRefreshOnUnauthorized({
      response: await runRequest(initialToken),
      token: options.token,
      runRequest,
    });

    if (!response.ok && throwOnError) {
      throw await parseApiError(response);
    }

    return response;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
