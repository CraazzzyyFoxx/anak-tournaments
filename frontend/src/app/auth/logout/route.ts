import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authService } from "@/services/auth.service";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") || "/";

  const cookieStore = await cookies();
  const accessToken = cookieStore.get("aqt_access_token")?.value;
  const refreshToken = cookieStore.get("aqt_refresh_token")?.value;

  // Best-effort server-side logout (revoke refresh token)
  try {
    if (accessToken && refreshToken) {
      await authService.logout(accessToken, refreshToken);
    }
  } catch {
    // ignore
  }

  // Build redirect URL using SITE_URL to avoid 0.0.0.0 issues
  const redirectUrl = new URL(next, SITE_URL);
  const response = NextResponse.redirect(redirectUrl);
  response.cookies.delete("aqt_access_token");
  response.cookies.delete("aqt_refresh_token");
  return response;
}
