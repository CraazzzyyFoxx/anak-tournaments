// @vitest-environment happy-dom
//
// The per-role weights are one knob holding a table, and what leaves the drawer
// is a PARTIAL override: the server merges it field by field over its own
// defaults, so echoing the whole table back would freeze today's numbers onto
// this tournament and silently ignore every later default change.
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import ru from "@/i18n/messages/ru.json";
import type { BalancerConfig, BalancerConfigField } from "@/types/balancer.types";

import { BalancerConfigDrawer } from "./BalancerConfigDrawer";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const ROLE_FIELD: BalancerConfigField = {
  key: "role_settings",
  label: "Role weights",
  description: "Per-role weights",
  type: "roles",
  group: "Quality weights",
  default: {
    tank: { impact: 1.4, line_gap_weight: 0.8 },
    damage: { impact: 1, line_gap_weight: 0 },
    support: { impact: 1.1, line_gap_weight: 0 },
  },
  limits: null,
  columns: [
    { key: "impact", label: "Impact", description: "d", limits: { min: 0, max: 10000 } },
    { key: "line_gap_weight", label: "Line gap", description: "d", limits: { min: 0, max: 10000 } },
  ],
};

const onChange = vi.fn();

async function mount(
  config: BalancerConfig,
  roleCodes: string[] | null = null,
  locale: "en" | "ru" = "en",
  fields: BalancerConfigField[] = [ROLE_FIELD],
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : ru}>
        <BalancerConfigDrawer
          open
          onOpenChange={() => {}}
          fields={fields}
          config={config}
          selectedPresetLabel="Default"
          dirty={false}
          saving={false}
          onChange={onChange}
          onSave={() => {}}
          onReset={() => {}}
          roleCodes={roleCodes}
        />
      </NextIntlClientProvider>,
    );
  });
}

/** The sheet portals into the body, so the cells are not under the container. */
function cell(role: string, column: string) {
  const input = document.querySelector<HTMLInputElement>(`#config-role_settings-${role}-${column}`);
  if (!input) throw new Error(`Expected the ${role}/${column} cell`);
  return input;
}

const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    nativeValueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  onChange.mockReset();
});

describe("BalancerConfigDrawer role weights", () => {
  it("renders one row per role the backend declares while the shape is unknown", async () => {
    await mount({});

    expect(cell("tank", "impact").value).toBe("1.4");
    expect(cell("damage", "line_gap_weight").value).toBe("0");
    expect(cell("support", "impact").value).toBe("1.1");
    expect(document.querySelector("#config-role_settings-flex-impact")).toBeNull();
  });

  it("offers a row only for the roles the tournament's roster shape fields", async () => {
    await mount({}, ["tank", "damage"]);

    expect(cell("tank", "impact").value).toBe("1.4");
    expect(cell("damage", "impact").value).toBe("1");
    expect(document.querySelector("#config-role_settings-support-impact")).toBeNull();
  });

  it("keeps a stored weight for a role the shape leaves out", async () => {
    await mount({ role_settings: { support: { impact: 2 } } }, ["tank", "damage"]);

    await typeInto(cell("tank", "impact"), "3");

    // The support row is not rendered, so nothing can edit it -- and nothing
    // may quietly drop it either.
    expect(onChange).toHaveBeenLastCalledWith("role_settings", {
      support: { impact: 2 },
      tank: { impact: 3 },
    });
  });

  it("stores only the edited cell, not a copy of the whole table", async () => {
    await mount({ role_settings: ROLE_FIELD.default });

    await typeInto(cell("tank", "line_gap_weight"), "0.25");

    expect(onChange).toHaveBeenLastCalledWith("role_settings", {
      tank: { line_gap_weight: 0.25 },
    });
  });

  it("drops a cell put back to its default instead of pinning it", async () => {
    await mount({ role_settings: { tank: { line_gap_weight: 0.25 } } });

    await typeInto(cell("tank", "line_gap_weight"), "0.8");

    expect(onChange).toHaveBeenLastCalledWith("role_settings", undefined);
  });
});

describe("BalancerConfigDrawer copy", () => {
  it("reads Russian under the ru catalog, the knob's label included", async () => {
    await mount({}, null, "ru");
    const text = document.body.textContent ?? "";

    expect(text).toContain("Настройки балансировщика");
    expect(text).toContain("Веса качества");
    expect(text).toContain("Веса ролей");
    expect(text).toContain("Влияние");
    expect(text).toContain("Сохранить настройки");
    expect(text).not.toContain("Balancer settings");
    expect(text).not.toContain("Role weights");
    expect(text).not.toContain("Impact");
  });

  it("keeps the server's copy for a knob the catalog does not know yet", async () => {
    const fresh: BalancerConfigField = {
      key: "brand_new_knob",
      label: "Brand new knob",
      description: "Server-side help text",
      type: "integer",
      group: "Strategy",
      default: 3,
      limits: { min: 0, max: 10 },
    };
    await mount({}, null, "ru", [fresh]);
    const text = document.body.textContent ?? "";

    expect(text).toContain("Brand new knob");
    expect(text).toContain("Server-side help text");
    expect(text).toContain("Стратегия");
  });
});
