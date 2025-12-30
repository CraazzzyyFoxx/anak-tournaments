import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authService } from "@/services/auth.service";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("aqt_oauth_state")?.value;
  const postLoginRedirect =
    cookieStore.get("aqt_post_login_redirect")?.value || (SITE_URL ? `${SITE_URL}/` : "/");

  if (!code || !state || !expectedState || state !== expectedState) {
    const response = NextResponse.redirect(new URL(`/?auth_error=invalid_state`, request.url));
    response.cookies.delete("aqt_oauth_state");
    response.cookies.delete("aqt_post_login_redirect");
    return response;
  }

  const tokens = await authService.exchangeDiscordCode(code, state);

  const response = NextResponse.redirect(new URL(postLoginRedirect, request.url));

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

  response.cookies.delete("aqt_oauth_state");
  response.cookies.delete("aqt_post_login_redirect");
  return response;
}
