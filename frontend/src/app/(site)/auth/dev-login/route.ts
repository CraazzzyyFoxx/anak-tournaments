import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/error";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/auth/cookie-names";
import { devLoginCredentials } from "@/lib/auth/dev-login";
import { getForwardedClientHeaders } from "@/lib/auth/forward-client-headers";
import { getTokenMaxAgeSeconds } from "@/lib/auth/jwt";
import {
  FALLBACK_ACCESS_COOKIE_MAX_AGE_SECONDS,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  safeRedirectTarget
} from "@/lib/auth/oauth-callback";
import { publicOrigin } from "@/lib/site/request-origin";
import { authService } from "@/services/auth.service";

// Dev-only sign-in (see lib/auth/dev-login.ts). 404 unless configured and not
// a production build, so it cannot exist on a deployed site. Cookies are
// host-only and non-Secure, same as every other cookie `next dev` sets.
export async function GET(request: Request) {
  const credentials = devLoginCredentials();
  if (!credentials) return new NextResponse(null, { status: 404 });

  try {
    const tokens = await authService.login(
      credentials.email,
      credentials.password,
      getForwardedClientHeaders(request)
    );
    const next = new URL(request.url).searchParams.get("next") ?? "";
    const response = NextResponse.redirect(safeRedirectTarget(next, publicOrigin(request)));

    response.cookies.set(ACCESS_TOKEN_COOKIE, tokens.access_token, {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: getTokenMaxAgeSeconds(tokens.access_token, FALLBACK_ACCESS_COOKIE_MAX_AGE_SECONDS)
    });
    response.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refresh_token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS
    });
    return response;
  } catch (error) {
    // Plain error page, not a redirect: the admin guard sends signed-out
    // visitors here, so redirecting back would loop on bad credentials.
    const status = error instanceof ApiError ? error.status : 502;
    const message = error instanceof Error ? error.message : String(error);
    return new NextResponse(`Dev login failed (${status}): ${message}`, { status: 502 });
  }
}
