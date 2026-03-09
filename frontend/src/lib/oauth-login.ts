import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authService } from "@/services/auth.service";
import type { OAuthProviderName } from "@/types/auth.types";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "/";

export async function startOAuthLogin(request: Request, provider: OAuthProviderName): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const nextParam = searchParams.get("next");
  const action = searchParams.get("action") === "link" ? "link" : "login";

  let next = SITE_URL;
  if (nextParam) {
    try {
      const nextUrl = new URL(nextParam, origin);
      if (nextUrl.origin === origin) {
        next = nextUrl.pathname + nextUrl.search;
      }
    } catch {
      if (nextParam.startsWith("/")) {
        next = nextParam;
      }
    }
  } else if (action === "link") {
    next = "/account";
  } else if (SITE_URL) {
    next = SITE_URL;
  }

  const { url, state } = await authService.getOAuthUrl(provider);

  await cookies();

  const response = NextResponse.redirect(url);
  response.cookies.set("aqt_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60
  });

  response.cookies.set("aqt_post_login_redirect", next, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60
  });

  response.cookies.set("aqt_oauth_action", action, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60
  });

  response.cookies.set("aqt_oauth_provider", provider, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60
  });

  return response;
}
