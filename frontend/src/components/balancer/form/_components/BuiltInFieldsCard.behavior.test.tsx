// @vitest-environment happy-dom
//
// The `flex_role` row is the only place an organizer can turn a tournament into
// "everyone is flex". Its mode select sits in the row's right-hand slot, which is
// free only because the field carries `supportsRequired: false` — a regression
// there would silently hide the control rather than break a build.

import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ru from "@/i18n/messages/ru.json";
import type { BuiltInFieldConfig } from "@/types/balancer-admin.types";

import { BuiltInFieldsCard } from "./BuiltInFieldsCard";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;

function mount(builtInFields: Record<string, BuiltInFieldConfig>, onUpdate = vi.fn()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="ru" messages={ru}>
        <BuiltInFieldsCard builtInFields={builtInFields} onUpdate={onUpdate} />
      </NextIntlClientProvider>,
    );
  });
  return onUpdate;
}

/** The row is found by its visible label, the way an organizer finds it. */
function flexRow(): HTMLElement {
  const label = Array.from(container.querySelectorAll("span")).find(
    (node) => node.textContent === ru.registrationFormAdmin.builtInFields.defs.flex_role.label,
  );
  if (!label) throw new Error("no row labelled 'Флекс-роль'");
  const row = label.closest("div.px-4");
  if (!row) throw new Error("row container not found");
  return row as HTMLElement;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("BuiltInFieldsCard flex_role row", () => {
  it("renders the mode select when the config is absent (field defaults to enabled)", () => {
    mount({});

    const row = flexRow();
    expect(row.textContent).toContain(ru.registrationFormAdmin.builtInFields.mode);
    expect(row.textContent).toContain(ru.registrationFormAdmin.builtInFields.modeOptional);
  });

  it("shows the forced label once the mode is stored", () => {
    mount({ flex_role: { enabled: true, required: false, mode: "forced" } });

    expect(flexRow().textContent).toContain(ru.registrationFormAdmin.builtInFields.modeForced);
  });

  it("offers no mode select while the field is disabled", () => {
    mount({ flex_role: { enabled: false, required: false } });

    expect(flexRow().textContent).not.toContain(ru.registrationFormAdmin.builtInFields.mode);
  });

  it("shows the all-roles label once that mode is stored", () => {
    mount({ flex_role: { enabled: true, required: false, mode: "all_roles" } });

    expect(flexRow().textContent).toContain(ru.registrationFormAdmin.builtInFields.modeAllRoles);
  });

  it("shows no Required toggle on this row, which is what frees the slot", () => {
    mount({});

    expect(flexRow().textContent).not.toContain(ru.registrationFormAdmin.builtInFields.required);
  });

  it("clears the mode when the field is switched off", () => {
    const onUpdate = mount({ flex_role: { enabled: true, required: false, mode: "forced" } });

    const toggle = flexRow().querySelector('[role="switch"]') as HTMLElement | null;
    if (!toggle) throw new Error("no enable switch on the flex row");
    act(() => toggle.click());

    expect(onUpdate).toHaveBeenCalledWith("flex_role", {
      enabled: false,
      required: false,
      mode: null,
    });
  });
});
