import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authService } from "@/services/auth.service";

export type MeResponse = {
  username: string;
  avatar_url?: string | null;
};

export async function GET() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("aqt_access_token")?.value;

  if (!accessToken) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  try {
    const me = await authService.me(accessToken);
    const payload: MeResponse = {
      username: me.username,
      avatar_url: me.avatar_url ?? null
    };

    return NextResponse.json(payload, { status: 200 });
  } catch {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }
}
