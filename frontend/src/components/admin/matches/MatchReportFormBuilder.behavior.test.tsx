// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MatchReportFormBuilder } from "@/components/admin/matches/MatchReportFormBuilder";
import type { MatchReportForm } from "@/types/encounter.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getReportForm = vi.fn();
const saveReportForm = vi.fn();

vi.mock("@/services/report-form.service", () => ({
  default: {
    getReportForm: (...args: unknown[]) => getReportForm(...args),
    saveReportForm: (...args: unknown[]) => saveReportForm(...args)
  }
}));

// Labels come through as their message keys, so the assertions below read as the
// keys the component is contracted to use.
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() }
}));

async function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  await act(async () => {
    await promise;
  });
}

async function waitFor<T>(read: () => T | null | undefined | false, what: string): Promise<T> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const value = read();
    if (value) return value as T;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
  await tick();
  return container;
}

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await tick();
}

// React overrides the input's own `value` setter to track changes; assigning
// through it makes React think nothing changed, so write via the prototype.
const nativeValueSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value"
)?.set;

async function type(input: Element | null | undefined, value: string) {
  expect(input).toBeTruthy();
  await act(async () => {
    nativeValueSetter?.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await tick();
}

function button(scope: ParentNode, text: string) {
  return Array.from(scope.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === text
  );
}

/**
 * Every control labelled `text`, resolved through `htmlFor` rather than DOM
 * position: Radix renders switches as buttons, so a wrapping label would not
 * associate and a positional lookup would silently follow a layout change.
 */
function controlsLabelled(scope: ParentNode, text: string): HTMLElement[] {
  return Array.from(scope.querySelectorAll("label"))
    .filter((label) => label.textContent?.trim() === text)
    .map((label) => scope.querySelector<HTMLElement>(`[id="${label.getAttribute("for")}"]`))
    .filter((element): element is HTMLElement => element !== null);
}

function form(overrides: Partial<MatchReportForm> = {}): MatchReportForm {
  return {
    tournament_id: 7,
    built_in_fields: {
      closeness: { enabled: true, required: true },
      map_codes: { enabled: true, required: false },
      comment: { enabled: true, required: false }
    },
    custom_fields: [],
    ...overrides
  };
}

describe("MatchReportFormBuilder", () => {
  beforeEach(() => {
    getReportForm.mockReset();
    saveReportForm.mockReset();
    getReportForm.mockResolvedValue(form());
    saveReportForm.mockImplementation(async () => form());
    document.body.innerHTML = "";
  });

  it("cannot mark a disabled field required, and keeps the choice for when it comes back", async () => {
    // "Required" only means something for a field captains are shown. The value
    // must survive the round trip, or turning a field off and on again silently
    // downgrades a rule the organizer set.
    const container = await mount(<MatchReportFormBuilder tournamentId={7} />);
    await waitFor(() => button(container, "save"), "the builder");

    const enabled = controlsLabelled(container, "enabledLabel");
    const required = controlsLabelled(container, "requiredLabel");
    expect(enabled).toHaveLength(3);
    expect(required).toHaveLength(3);

    // closeness is the first row and ships enabled + required.
    expect(required[0].hasAttribute("disabled")).toBe(false);
    expect(required[0].getAttribute("aria-checked")).toBe("true");

    await click(enabled[0]);
    expect(required[0].hasAttribute("disabled")).toBe(true);
    expect(required[0].getAttribute("aria-checked")).toBe("true");

    await click(enabled[0]);
    expect(required[0].hasAttribute("disabled")).toBe(false);
    expect(required[0].getAttribute("aria-checked")).toBe("true");
  });

  it("slugs a new field's key from its label until the key is edited by hand", async () => {
    const container = await mount(<MatchReportFormBuilder tournamentId={7} />);
    await waitFor(() => button(container, "addField"), "the add button");
    expect(container.textContent).toContain("noCustomFields");

    await click(button(container, "addField"));
    const label = () => controlsLabelled(container, "labelLabel")[0] as HTMLInputElement;
    const key = () => controlsLabelled(container, "keyLabel")[0] as HTMLInputElement;

    await type(label(), "Coach Notes 2!");
    expect(key().value).toBe("coach_notes_2");

    // Hand-editing the key ends the coupling: the key is the storage address of
    // every answer, so a later label tweak must not move it.
    await type(key(), "coach_debrief");
    await type(label(), "Coach debrief notes");
    expect(key().value).toBe("coach_debrief");
  });

  it("blocks Save on a duplicate key and says which rule broke", async () => {
    getReportForm.mockResolvedValue(
      form({
        custom_fields: [
          { key: "vod", label: "VOD link", type: "text", required: false, placeholder: null },
          { key: "notes", label: "Notes", type: "text", required: false, placeholder: null }
        ]
      })
    );
    const container = await mount(<MatchReportFormBuilder tournamentId={7} />);
    await waitFor(() => controlsLabelled(container, "keyLabel").length === 2, "both rows");

    const secondKey = controlsLabelled(container, "keyLabel")[1] as HTMLInputElement;
    await type(secondKey, "vod");

    expect(container.textContent).toContain("errors.keyDuplicate");
    expect(button(container, "save")?.hasAttribute("disabled")).toBe(true);
    expect(saveReportForm).not.toHaveBeenCalled();

    // The reason is text, not a red border, and the Save button points at it.
    const blockedId = button(container, "save")?.getAttribute("aria-describedby");
    expect(blockedId).toBeTruthy();
    expect(container.querySelector(`[id="${blockedId}"]`)?.textContent).toContain(
      "errors.keyDuplicate"
    );

    await type(secondKey, "match_notes");
    expect(container.textContent).not.toContain("errors.keyDuplicate");
    expect(button(container, "save")?.hasAttribute("disabled")).toBe(false);
  });

  it("blocks Save on a field with no label", async () => {
    const container = await mount(<MatchReportFormBuilder tournamentId={7} />);
    await waitFor(() => button(container, "addField"), "the add button");

    await click(button(container, "addField"));
    expect(container.textContent).toContain("errors.labelRequired");
    expect(button(container, "save")?.hasAttribute("disabled")).toBe(true);
  });

  it("saves the built-in toggles and the custom text fields together", async () => {
    const container = await mount(<MatchReportFormBuilder tournamentId={7} />);
    await waitFor(() => button(container, "save"), "the builder");

    // Nothing edited yet: there is nothing to persist.
    expect(button(container, "save")?.hasAttribute("disabled")).toBe(true);

    // comment is the third built-in row.
    await click(controlsLabelled(container, "requiredLabel")[2]);
    await click(button(container, "addField"));
    await type(controlsLabelled(container, "labelLabel")[0], "Coach notes");
    await type(controlsLabelled(container, "placeholderLabel")[0], "  Anything else  ");

    await click(button(container, "save"));

    expect(saveReportForm).toHaveBeenCalledWith(7, {
      built_in_fields: {
        closeness: { enabled: true, required: true },
        map_codes: { enabled: true, required: false },
        comment: { enabled: true, required: true }
      },
      custom_fields: [
        {
          key: "coach_notes",
          label: "Coach notes",
          type: "text",
          required: false,
          placeholder: "Anything else"
        }
      ]
    });
  });

  it("stops at the 20-field cap and says why the add button is dead", async () => {
    getReportForm.mockResolvedValue(
      form({
        custom_fields: Array.from({ length: 20 }, (_, index) => ({
          key: `field_${index}`,
          label: `Field ${index}`,
          type: "text" as const,
          required: false,
          placeholder: null
        }))
      })
    );
    const container = await mount(<MatchReportFormBuilder tournamentId={7} />);
    const add = await waitFor(() => button(container, "addField"), "the add button");

    expect(add.hasAttribute("disabled")).toBe(true);
    const noticeId = add.getAttribute("aria-describedby");
    expect(container.querySelector(`[id="${noticeId}"]`)?.textContent).toContain(
      "maxFieldsReached"
    );
  });

  it("reports a failed load instead of offering the defaults as saved config", async () => {
    getReportForm.mockRejectedValue(new Error("boom"));
    const container = await mount(<MatchReportFormBuilder tournamentId={7} />);
    await waitFor(() => container.textContent?.includes("loadError"), "the load error");

    expect(button(container, "save")).toBeUndefined();
  });
});
