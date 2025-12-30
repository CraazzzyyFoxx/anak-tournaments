import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authService } from "@/services/auth.service";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") || SITE_URL;

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
  // @ts-ignore
  const response = NextResponse.redirect(new URL(next, request.url));
  response.cookies.delete("aqt_access_token");
  response.cookies.delete("aqt_refresh_token");
  return response;
}
