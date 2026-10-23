import { oauthLoginRoute } from "@/lib/auth/oauth-login";

export async function GET(request: Request) {
  return oauthLoginRoute(request, "discord");
}
