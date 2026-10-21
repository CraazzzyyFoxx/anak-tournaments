import { type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Api } from "./api";
import { BASE_URL, COOKIE_PREFIX, sql } from "./env";

export type TestUser = {
  id: number;
  email: string;
  username: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  api: Api;
};

export const PASSWORD = "E2e-Passw0rd";

/** Registers a fresh identity (optionally a platform superuser) and signs it in. */
export async function createUser(opts: { superuser?: boolean; prefix?: string } = {}): Promise<TestUser> {
  const tag = `${opts.prefix ?? "e2e"}${randomUUID().slice(0, 8)}`;
  const email = `${tag}@e2e-owt.dev`;
  const anon = await Api.create();
  await anon.post("/api/v1/auth/register", { email, username: tag, password: PASSWORD }, 201);
  if (opts.superuser) {
    sql(`UPDATE auth."user" SET is_superuser = true, is_verified = true WHERE email = '${email}'`);
  }
  const tokens = await anon.post<{ access_token: string; refresh_token: string }>("/api/v1/auth/login", {
    email,
    password: PASSWORD,
  });
  await anon.dispose();
  const api = await Api.create(tokens.access_token);
  const me = await api.get<{ id: number; username: string }>("/api/v1/auth/me");
  return {
    id: me.id,
    email,
    username: me.username,
    password: PASSWORD,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    api,
  };
}

/** Same cookies `/auth/dev-login` sets: host-only, non-Secure. */
export function sessionCookies(user: Pick<TestUser, "accessToken" | "refreshToken">) {
  const { hostname } = new URL(BASE_URL);
  const base = { domain: hostname, path: "/", sameSite: "Lax" as const, secure: false, expires: -1 };
  return [
    { ...base, name: `${COOKIE_PREFIX}_access_token`, value: user.accessToken, httpOnly: false },
    { ...base, name: `${COOKIE_PREFIX}_refresh_token`, value: user.refreshToken, httpOnly: true },
  ];
}

export async function signIn(context: BrowserContext, user: Pick<TestUser, "accessToken" | "refreshToken">) {
  await context.clearCookies();
  await context.addCookies(sessionCookies(user));
}
