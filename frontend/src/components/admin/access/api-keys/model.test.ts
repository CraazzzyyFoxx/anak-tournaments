import { describe, expect, it } from "vitest";

import type { AccountApiKey } from "@/types/auth.types";

import { getApiKeyStatus, scopePickerCatalog } from "./model";

function key(revoked_at: string | null, expires_at: string | null): AccountApiKey {
  return { revoked_at, expires_at } as AccountApiKey;
}

describe("getApiKeyStatus", () => {
  it("puts revocation ahead of expiry", () => {
    expect(getApiKeyStatus(key("2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z"))).toBe("revoked");
  });

  it("expires a key whose expiry has passed, and only that one", () => {
    expect(getApiKeyStatus(key(null, "2020-01-01T00:00:00Z"))).toBe("expired");
    expect(getApiKeyStatus(key(null, "2999-01-01T00:00:00Z"))).toBe("active");
    expect(getApiKeyStatus(key(null, null))).toBe("active");
    expect(getApiKeyStatus(key(null, "not a date"))).toBe("active");
  });
});

describe("scopePickerCatalog", () => {
  it("splits grants at the first dot and keeps wildcards apart", () => {
    expect(scopePickerCatalog(["team.create", "match.result.update", "admin", "team.*"])).toEqual({
      catalog: [
        { key: "team.create", resource: "team", action: "create" },
        { key: "match.result.update", resource: "match", action: "result.update" },
        { key: "admin", resource: "admin", action: "*" }
      ],
      wildcards: ["team.*"]
    });
  });
});
