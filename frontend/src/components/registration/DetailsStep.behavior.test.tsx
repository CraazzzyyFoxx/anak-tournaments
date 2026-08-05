// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import DetailsStep from "./DetailsStep";
import type { RegistrationForm } from "@/types/registration.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MESSAGES = {
  common: { selectPlaceholder: "Select" },
  registration: {
    details: {
      notes: "Notes",
      notesPlaceholder: "Anything the organizers should know"
    }
  }
};

const FORM = {
  built_in_fields: {},
  custom_fields: [
    { key: "vk", label: "VK profile", type: "text", required: false, options: null },
    { key: "rules", label: "Read the rules", type: "checkbox", required: true, options: null }
  ]
} as unknown as RegistrationForm;

const updates: Array<[string, string]> = [];

async function mount(mode: "public" | "admin", values: Record<string, string> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  updates.length = 0;
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <DetailsStep
          mode={mode}
          values={values}
          onUpdate={(key, value) => updates.push([key, value])}
          onFieldValidationChange={() => {}}
          form={FORM}
          adminNotes=""
          onAdminNotesChange={mode === "admin" ? () => {} : undefined}
        />
      </NextIntlClientProvider>
    );
  });
  return container;
}

function labels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("label")).map((node) => node.textContent?.trim() ?? "");
}

describe("DetailsStep custom fields", () => {
  it("renders the organizer's custom fields in admin mode", async () => {
    // The regression: the map was gated on `mode === "public"`, so an admin
    // could read custom-field answers in the table and never edit one.
    const container = await mount("admin");

    expect(labels(container).some((text) => text.includes("VK profile"))).toBe(true);
    expect(labels(container).some((text) => text.includes("Read the rules"))).toBe(true);
  });

  it("still renders them in public mode", async () => {
    const container = await mount("public");

    expect(labels(container).some((text) => text.includes("VK profile"))).toBe(true);
  });

  it("shows the stored answer rather than an empty control", async () => {
    const container = await mount("admin", { vk: "vk.com/player" });

    const filled = Array.from(container.querySelectorAll("input")).map((node) => node.value);
    expect(filled).toContain("vk.com/player");
  });

  it("reports edits under the definition key", async () => {
    const container = await mount("admin", { vk: "" });
    const input = Array.from(container.querySelectorAll("input")).find((node) => node.type === "text");
    if (!input) throw new Error("no custom-field input rendered");

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "vk.com/edited");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(updates).toContainEqual(["vk", "vk.com/edited"]);
  });

  it("puts participant data above the admin-only block", async () => {
    // Admin Notes and the status selects are organizer metadata; the
    // participant's own answers belong next to the participant's own fields.
    const container = await mount("admin");

    const order = labels(container);
    const custom = order.findIndex((text) => text.includes("VK profile"));
    const adminNotes = order.findIndex((text) => text.includes("Admin Notes"));
    expect(custom).toBeGreaterThanOrEqual(0);
    expect(adminNotes).toBeGreaterThan(custom);
  });
});
