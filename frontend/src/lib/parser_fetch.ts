import { getTokenFromCookies } from "./auth-tokens";
import { retryWithRefreshOnUnauthorized } from "./auth-request";

interface ParserFetchOptions {
  query?: Record<string, any>;
  token?: string;
  body?: any; // Can be JSON or FormData
  method?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export const PARSER_API_URL = process.env.NEXT_PUBLIC_PARSER_API_URL;

export async function parserFetch(url: string, options?: ParserFetchOptions): Promise<Response> {
  const params = new URLSearchParams();

  const appendParams = (key: string, value: any) => {
    if (typeof value === "object" && !Array.isArray(value)) {
      for (const subKey in value) {
        appendParams(`${key}`, value[subKey]);
      }
    } else if (Array.isArray(value)) {
      value.forEach((item) => {
        params.append(`${key}`, item);
      });
    } else {
      if (value !== undefined) {
        params.append(key, value);
      }
    }
  };

  if (!options) {
    options = {};
  }

  if (options.query) {
    for (const key in options.query) {
      appendParams(key, options.query[key]);
    }
  }

  const initialToken = options.token ?? (await getTokenFromCookies("aqt_access_token"));

  // On the client, route through Next.js rewrite proxy (/api/parser/*) to avoid CORS.
  // On the server, call the external API directly (server-to-server, no CORS).
  const baseUrl = typeof window !== "undefined" ? "/api/parser" : PARSER_API_URL;
  const urlWithParams = params.toString()
    ? `${baseUrl}/${url}?${params.toString()}`
    : `${baseUrl}/${url}`;

  const isFormData = options.body instanceof FormData;

  const headers: Record<string, string> = { ...options.headers };
  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }

  const runRequest = async (tokenToUse?: string): Promise<Response> => {
    const requestHeaders: Record<string, string> = { ...headers };
    if (tokenToUse) {
      requestHeaders.Authorization = `Bearer ${tokenToUse}`;
    }

    return fetch(urlWithParams, {
      cache: "no-store", // Admin operations should not be cached
      headers: requestHeaders,
      body: isFormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
      method: options.method || "GET",
      signal: options.signal
    });
  };

  const response = await retryWithRefreshOnUnauthorized({
    response: await runRequest(initialToken),
    token: options.token,
    runRequest
  });

  if (!response.ok) {
    let message = "An error occurred";
    try {
      const error = await response.json();
      message = error?.detail || error?.message || message;
    } catch {
      // ignore non-JSON bodies
    }
    throw new Error(message);
  }

  return response;
}
