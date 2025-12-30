import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authService } from "@/services/auth.service";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const next = searchParams.get("next") || (SITE_URL ? `${SITE_URL}/` : "/");

  const { url, state } = await authService.getDiscordOAuthUrl();

  // Touch cookies() so Next treats this route as dynamic.
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

  return response;
}
