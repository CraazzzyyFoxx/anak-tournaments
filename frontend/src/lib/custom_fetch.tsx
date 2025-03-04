interface CustomOptions {
  query?: Record<string, any>;
  token?: string;
  body?: Record<string, any>;
  method?: string;
}

export const API_URL = process.env.NEXT_PUBLIC_API_URL;
export const cachePolicy = process.env.NEXT_PUBLIC_CACHE_POLICY;

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

  for (const key in options["query"]) {
    appendParams(key, options["query"][key]);
  }

  const urlWithParams = `${API_URL}/${url}?${params.toString()}`;

  const response = await fetch(urlWithParams, {
    cache: getCachePolicy(),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.token}`
    },
    body: JSON.stringify(options.body),
    method: options.method || "GET"
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "An error occurred");
  }

  return response;
}
