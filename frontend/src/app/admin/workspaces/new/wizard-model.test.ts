import { describe, expect, it } from "vitest";

import type { Workspace } from "@/types/workspace.types";

import {
  brandingForm,
  brandingPayload,
  profileForm,
  profilePayload,
  railSteps,
  validateBasics,
  wizardLocation
} from "./wizard-model";

const workspace = {
  id: 8,
  slug: "rivals",
  name: "Rivals Cup",
  description: null,
  tagline: "",
  about: null,
  discord_url: null,
  twitch_url: null,
  boosty_url: null,
  timezone: "Europe/Moscow",
  branding_enabled: false,
  brand_primary: "#0ea5a4",
  brand_secondary: null,
  brand_background: null,
  brand_surface: null
} as Workspace;

describe("workspace creation wizard model", () => {
  it("turns each basics problem into a code", () => {
    expect(validateBasics({ name: "Rivals", slug: "rivals" })).toEqual({});
    expect(validateBasics({ name: "  ", slug: "" })).toEqual({ name: "empty", slug: "empty" });
    expect(validateBasics({ name: "A", slug: "Rivals Cup" }).slug).toBe("format");
    expect(validateBasics({ name: "A", slug: "-rivals" }).slug).toBe("edges");
    expect(validateBasics({ name: "A", slug: "admin" }).slug).toBe("reserved");
    expect(validateBasics({ name: "A", slug: "a".repeat(65) }).slug).toBe("length");
  });

  it("keeps every step past basics behind a valid id", () => {
    expect(wizardLocation("branding", null)).toEqual({ step: "basics", id: null });
    expect(wizardLocation("branding", "abc")).toEqual({ step: "basics", id: null });
    expect(wizardLocation("branding", "8")).toEqual({ step: "branding", id: 8 });
    expect(wizardLocation("nope", "8")).toEqual({ step: "basics", id: 8 });
  });

  it("marks a skipped step behind the active one, and nothing ahead of it", () => {
    expect(railSteps("discord", { profile: true, discord: true })).toEqual([
      { key: "basics", state: "done" },
      { key: "profile", state: "skipped" },
      { key: "branding", state: "done" },
      { key: "discord", state: "current" },
      { key: "done", state: "todo" }
    ]);
  });

  it("sends only what changed, blank text as null", () => {
    expect(profilePayload(profileForm(workspace), workspace)).toEqual({});
    expect(
      profilePayload(
        { ...profileForm(workspace), tagline: "  ", about: " Hi ", timezone: "UTC" },
        workspace
      )
    ).toEqual({ about: "Hi", timezone: "UTC" });

    expect(
      brandingPayload(
        { ...brandingForm(workspace), branding_enabled: true, brand_primary: "" },
        workspace
      )
    ).toEqual({ branding_enabled: true, brand_primary: null });
  });
});
