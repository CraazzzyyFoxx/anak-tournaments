interface CustomOptions {
  query?: Record<string, any>;
  token?: string;
  body?: Record<string, any>;
  method?: string;
}

export const API_URL = process.env.NEXT_PUBLIC_API_URL;
export const cachePolicy = process.env.NEXT_PUBLIC_CACHE_POLICY;

let refreshInFlight: Promise<string | undefined> | null = null;

export const getCachePolicy = () => {
  switch (cachePolicy) {
    case "no-cache":
      return "no-cache";
    case "cache":
      return "default";
    case "cache-first":
      return "default";
    case "network-only":
      return "no-store";
    default:
      return "default";
  }
};

async function getTokenFromCookies(cookieName: string): Promise<string | undefined> {
  if (typeof window === "undefined") {
    try {
      const { cookies } = await import("next/headers");
      const cookieStore = await cookies();
      return cookieStore.get(cookieName)?.value;
    } catch {
      return undefined;
    }
  }

  try {
    const Cookies = (await import("js-cookie")).default;
    return Cookies.get(cookieName);
  } catch {
    return undefined;
  }
}

async function refreshAccessToken(): Promise<string | undefined> {
  // In SSR we rely on middleware to keep tokens fresh.
  if (typeof window === "undefined") return undefined;

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch("/auth/refresh", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          }
        });
        if (!res.ok) return undefined;
        const tokens = (await res.json()) as { access_token?: string };
        return tokens.access_token;
      } catch {
        return undefined;
      } finally {
        refreshInFlight = null;
      }
    })();
  }

  return refreshInFlight;
}

export async function customFetch(url: string, options?: CustomOptions): Promise<Response> {
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

  const urlWithParams = `${API_URL}/${url}?${params.toString()}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  const runRequest = async (tokenToUse?: string): Promise<Response> => {
    const requestHeaders: Record<string, string> = { ...headers };
    if (tokenToUse) {
      requestHeaders.Authorization = `Bearer ${tokenToUse}`;
    }

    return fetch(urlWithParams, {
      cache: getCachePolicy(),
      headers: requestHeaders,
      body: JSON.stringify(options.body),
      method: options.method || "GET"
    });
  };

  let response = await runRequest(initialToken);

  // If the cookie-based access token is expired/invalid, try refreshing once.
  if (
    response.status === 401 &&
    !options.token &&
    typeof window !== "undefined"
  ) {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) {
      response = await runRequest(refreshedToken);
    }
  }

  if (!response.ok) {
    let message = "An error occurred";
    try {
      const error = await response.json();
      message = error?.message || message;
    } catch {
      // ignore non-JSON bodies
    }
    throw new Error(message);
  }

  return response;
}
