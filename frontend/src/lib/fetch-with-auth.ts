import { getTokenFromCookies, refreshAccessToken } from "./auth-tokens";

export async function fetchWithAuth(
  url: string,
  options: Parameters<typeof fetch>[1] = {}
): Promise<Response> {
  const accessToken = await getTokenFromCookies("aqt_access_token");

  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...options.headers,
      ...(accessToken && { Authorization: `Bearer ${accessToken}` })
    }
  });

  if (res.status === 401 && typeof window !== "undefined") {
    const refreshedToken = await refreshAccessToken();

    if (refreshedToken) {
      return fetch(url, {
        ...options,
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...options.headers,
          Authorization: `Bearer ${refreshedToken}`
        }
      });
    }
  }

  return res;
}
