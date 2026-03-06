import { NextResponse } from "next/server";
import { authService } from "@/services/auth.service";

export async function GET() {
  try {
    const providers = await authService.getAvailableOAuthProviders();
    return NextResponse.json(providers, { status: 200 });
  } catch {
    return NextResponse.json({ detail: "Failed to load available OAuth providers" }, { status: 500 });
  }
}
