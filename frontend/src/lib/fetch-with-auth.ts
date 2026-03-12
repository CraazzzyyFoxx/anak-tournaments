import { getTokenFromCookies } from "./auth-tokens";
import { retryWithRefreshOnUnauthorized } from "./auth-request";

export async function fetchWithAuth(
  url: string,
  options: Parameters<typeof fetch>[1] = {}
): Promise<Response> {
  const accessToken = await getTokenFromCookies("aqt_access_token");

  const runRequest = async (token?: string) => {
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    } else {
      headers.delete("Authorization");
    }

    return fetch(url, {
      ...options,
      credentials: "include",
      headers,
    });
  };

  return retryWithRefreshOnUnauthorized({
    response: await runRequest(accessToken),
    runRequest,
  });
}
