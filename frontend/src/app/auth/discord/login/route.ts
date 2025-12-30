import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authService } from "@/services/auth.service";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "/";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const nextParam = searchParams.get("next");

  // Validate and sanitize the next parameter
  // Only allow relative paths or same-origin URLs to prevent open redirect
  let next = SITE_URL;
  if (nextParam) {
    try {
      const nextUrl = new URL(nextParam, origin);
      // Only use the path if it's same-origin
      if (nextUrl.origin === origin) {
        next = nextUrl.pathname + nextUrl.search;
      }
    } catch {
      // If nextParam is a relative path, use it directly
      if (nextParam.startsWith("/")) {
        next = nextParam;
      }
    }
  } else if (SITE_URL) {
    next = SITE_URL;
  }

  try {
    const { url, state } = await authService.getDiscordOAuthUrl();

    // Touch cookies() so Next treats this route as dynamic.
    await cookies();

    const response = NextResponse.redirect(url);
    response.cookies.set("aqt_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: SITE_URL,
      maxAge: 10 * 60
    });

    response.cookies.set("aqt_post_login_redirect", next, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: SITE_URL,
      maxAge: 10 * 60
    });

    return response;
  } catch (err) {
    console.error("Failed to get Discord OAuth URL:", err);
    // Redirect to home with error
    const errorUrl = new URL("/?auth_error=oauth_init_failed", request.url);
    return NextResponse.redirect(errorUrl);
  }
}
