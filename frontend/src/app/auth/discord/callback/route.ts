import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authService } from "@/services/auth.service";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;

/**
 * Helper to create redirect response with cleaned up OAuth cookies
 */
function createRedirectResponse(
  redirectUrl: URL,
  clearOAuthCookies: boolean = true
): NextResponse {
  const response = NextResponse.redirect(redirectUrl);
  if (clearOAuthCookies) {
    response.cookies.delete("aqt_oauth_state");
    response.cookies.delete("aqt_post_login_redirect");
  }
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // Discord may return an error if user denies access
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("aqt_oauth_state")?.value;
  const postLoginRedirect =
    cookieStore.get("aqt_post_login_redirect")?.value || (SITE_URL ? `${SITE_URL}/` : "/");

  // Build base redirect URL for error cases
  const baseRedirectUrl = new URL("/", request.url);

  // Handle OAuth error response from Discord (e.g., user denied access)
  if (error) {
    const errorUrl = new URL(baseRedirectUrl);
    errorUrl.searchParams.set("auth_error", error);
    if (errorDescription) {
      errorUrl.searchParams.set("auth_error_description", errorDescription);
    }
    return createRedirectResponse(errorUrl);
  }

  // Validate required parameters and state
  if (!code || !state || !expectedState || state !== expectedState) {
    const errorUrl = new URL(baseRedirectUrl);
    errorUrl.searchParams.set("auth_error", "invalid_state");
    return createRedirectResponse(errorUrl);
  }

  try {
    const tokens = await authService.exchangeDiscordCode(code, state);

    // Determine where to redirect after successful login
    // Ensure postLoginRedirect is a valid relative path or same-origin URL
    let redirectUrl: URL;
    try {
      redirectUrl = new URL(postLoginRedirect, request.url);
      // Security: only allow same-origin redirects
      const requestOrigin = new URL(request.url).origin;
      if (redirectUrl.origin !== requestOrigin) {
        redirectUrl = new URL("/", request.url);
      }
    } catch {
      redirectUrl = new URL("/", request.url);
    }

    const response = createRedirectResponse(redirectUrl);

    // Token cookies (used by server components + client components)
    response.cookies.set("aqt_access_token", tokens.access_token, {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // keep slightly under typical 30m expiry to avoid edge cases
      maxAge: 25 * 60
    });

    response.cookies.set("aqt_refresh_token", tokens.refresh_token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 30 * 24 * 60 * 60
    });

    return response;
  } catch (err) {
    // Log error for debugging (server-side)
    console.error("OAuth callback error:", err);

    // Redirect to home with error indication
    const errorUrl = new URL(baseRedirectUrl);
    errorUrl.searchParams.set("auth_error", "exchange_failed");
    return createRedirectResponse(errorUrl);
  }
}
