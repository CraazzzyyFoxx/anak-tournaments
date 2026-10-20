import { afterEach, describe, expect, it, vi } from "vitest";

import { devLoginCredentials } from "@/lib/auth/dev-login";

describe("devLoginCredentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is never active in a production build, even with credentials set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_AUTH_EMAIL", "dev@example.com");
    vi.stubEnv("DEV_AUTH_PASSWORD", "Secret123");
    expect(devLoginCredentials()).toBeNull();
  });

  it("returns the credentials in development when both are set", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH_EMAIL", "dev@example.com");
    vi.stubEnv("DEV_AUTH_PASSWORD", "Secret123");
    expect(devLoginCredentials()).toEqual({ email: "dev@example.com", password: "Secret123" });
  });

  it("stays off in development when either credential is missing", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH_EMAIL", "dev@example.com");
    vi.stubEnv("DEV_AUTH_PASSWORD", "");
    expect(devLoginCredentials()).toBeNull();
  });
});
