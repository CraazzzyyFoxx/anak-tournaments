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
  const tokens = await login(anon, email);
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

type Tokens = { access_token: string; refresh_token: string };

function login(anon: Api, email: string) {
  return anon.post<Tokens>("/api/v1/auth/login", { email, password: PASSWORD });
}

/**
 * Signs `context` in with a session of its own — never the tokens `user.api`
 * holds. A browser refresh rotates its session and retires the access token
 * it started with, so a shared session would sign the API client out.
 */
export async function signIn(context: BrowserContext, user: Pick<TestUser, "email">) {
  const anon = await Api.create();
  const tokens = await login(anon, user.email);
  await anon.dispose();
  const { hostname } = new URL(BASE_URL);
  // Same cookies `/auth/dev-login` sets: host-only, non-Secure.
  const base = { domain: hostname, path: "/", sameSite: "Lax" as const, secure: false, expires: -1 };
  await context.clearCookies();
  await context.addCookies([
    { ...base, name: `${COOKIE_PREFIX}_access_token`, value: tokens.access_token, httpOnly: false },
    { ...base, name: `${COOKIE_PREFIX}_refresh_token`, value: tokens.refresh_token, httpOnly: true },
  ]);
}
