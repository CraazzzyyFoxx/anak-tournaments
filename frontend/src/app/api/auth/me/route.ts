import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export type MeResponse = {
  username: string;
  avatar_url?: string | null;
  roles: string[];
  permissions: string[];
  is_superuser: boolean;
};

const AUTH_SERVICE_URL =
  process.env.NEXT_PUBLIC_AUTH_SERVICE_URL?.replace(/\/$/, "") || "http://localhost:8001";

export async function GET() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("aqt_access_token")?.value;

  if (!accessToken) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  try {
    const response = await fetch(`${AUTH_SERVICE_URL}/me`, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });

    if (response.status === 401) {
      return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
    }

    if (!response.ok) {
      return NextResponse.json(
        { detail: "Authentication service is temporarily unavailable" },
        { status: response.status >= 500 ? 503 : response.status }
      );
    }

    const me = await response.json();
    const payload: MeResponse = {
      username: me.username,
      avatar_url: me.avatar_url ?? null,
      roles: me.roles ?? [],
      permissions: me.permissions ?? [],
      is_superuser: me.is_superuser ?? false
    };

    return NextResponse.json(payload, { status: 200 });
  } catch {
    return NextResponse.json({ detail: "Authentication service is temporarily unavailable" }, { status: 503 });
  }
}
