// @vitest-environment happy-dom
//
// The client host of one optional module slot (P7 contracts §7). Backend capability and local renderer
// are separate facts:
//  - a capability the game does not have says so, and loads nothing;
//  - a native shape the slot does not apply to renders the generic fallback;
//  - a promised capability whose renderer is missing is an explicit error, never a silent fallback;
//  - without a required capability a missing renderer simply shows the generic fallback;
//  - an unknown game never resolves to another game's module.
import { NextIntlClientProvider } from "next-intl";
import { act, lazy, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";

import { DisciplineWidget } from "./DisciplineWidget";
import type { DisciplineCapabilities, DisciplineUI, SlotProps } from "./types";

const loadDisciplineUI = vi.fn<(code: string) => Promise<DisciplineUI | null>>();
vi.mock("./registry", () => ({ loadDisciplineUI: (code: string) => loadDisciplineUI(code) }));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NONE: DisciplineCapabilities = {
  catalog_sync: false,
  native_rank_collection: false,
  native_ladder: false,
  achievement_conditions: false,
  analytics: false
};
const LADDER: DisciplineCapabilities = { ...NONE, native_ladder: true };
const EDITOR_PROPS: SlotProps["nativeRankEditor"] = { ladder: [], value: null, onChange: () => {} };

/** A module whose `nativeRankEditor` renders its own code, so a wrong game's module is visible. */
function moduleOf(code: string): DisciplineUI {
  return {
    code,
    slots: {
      nativeRankEditor: lazy(async () => ({
        default: ({ disabled }: SlotProps["nativeRankEditor"]) => (
          <p data-slot={code}>{`${code} editor${disabled ? " (disabled)" : ""}`}</p>
        )
      }))
    }
  };
}

const mounted: { root: Root; container: HTMLElement }[] = [];

async function settle(turns = 5) {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        {node}
      </NextIntlClientProvider>
    );
  });
  await settle();
  return container;
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  loadDisciplineUI.mockReset();
});

describe("DisciplineWidget", () => {
  it("renders the slot of the game it was asked for, with the caller's props", async () => {
    loadDisciplineUI.mockImplementation(async (code) => moduleOf(code));

    const view = await mount(
      <DisciplineWidget
        discipline="overwatch"
        slot="nativeRankEditor"
        capabilities={LADDER}
        requires="native_ladder"
        props={{ ...EDITOR_PROPS, disabled: true }}
        fallback={<p>generic</p>}
      />
    );

    expect(view.querySelector("[data-slot]")?.textContent).toBe("overwatch editor (disabled)");
    expect(loadDisciplineUI).toHaveBeenCalledWith("overwatch");
    expect(view.textContent).not.toContain("generic");
  });

  it("says so, and loads nothing, when the game lacks the required capability", async () => {
    loadDisciplineUI.mockImplementation(async (code) => moduleOf(code));

    const view = await mount(
      <DisciplineWidget
        discipline="lol"
        slot="nativeRankEditor"
        capabilities={NONE}
        requires="native_ladder"
        props={EDITOR_PROPS}
        fallback={<p>generic</p>}
      />
    );

    expect(view.textContent).toContain(en.common.discipline.widgetUnsupported);
    expect(view.querySelector("[role=alert]")).toBeNull();
    expect(loadDisciplineUI).not.toHaveBeenCalled();
  });

  it("is a configuration error when a promised capability has no renderer in the module", async () => {
    loadDisciplineUI.mockResolvedValue({ code: "lol", slots: {} });

    const view = await mount(
      <DisciplineWidget
        discipline="lol"
        slot="nativeRankEditor"
        capabilities={LADDER}
        requires="native_ladder"
        props={EDITOR_PROPS}
        fallback={<p>generic</p>}
      />
    );

    expect(view.querySelector("[role=alert]")?.textContent).toBe(en.common.discipline.widgetMissing);
    expect(view.textContent).not.toContain("generic");
  });

  it("is the same configuration error when the game has no module at all — never another game's", async () => {
    loadDisciplineUI.mockImplementation(async (code) => (code === "overwatch" ? moduleOf(code) : null));

    const view = await mount(
      <DisciplineWidget
        discipline="chess"
        slot="nativeRankEditor"
        capabilities={LADDER}
        requires="native_ladder"
        props={EDITOR_PROPS}
        fallback={<p>generic</p>}
      />
    );

    expect(view.querySelector("[role=alert]")).not.toBeNull();
    expect(view.querySelector("[data-slot]")).toBeNull();
  });

  it("shows the generic fallback when nothing is required and the module has no renderer", async () => {
    loadDisciplineUI.mockResolvedValue({ code: "lol", slots: {} });

    const view = await mount(
      <DisciplineWidget
        discipline="lol"
        slot="nativeRankEditor"
        capabilities={NONE}
        props={EDITOR_PROPS}
        fallback={<p>generic</p>}
      />
    );

    expect(view.textContent).toContain("generic");
    expect(view.querySelector("[role=alert]")).toBeNull();
  });

  it("shows the generic fallback, and loads nothing, for a shape the slot does not apply to", async () => {
    loadDisciplineUI.mockImplementation(async (code) => moduleOf(code));

    const view = await mount(
      <DisciplineWidget
        discipline="overwatch"
        slot="nativeRankEditor"
        capabilities={LADDER}
        applicable={false}
        props={EDITOR_PROPS}
        fallback={<p>generic</p>}
      />
    );

    expect(view.textContent).toContain("generic");
    expect(view.querySelector("[data-slot]")).toBeNull();
    expect(loadDisciplineUI).not.toHaveBeenCalled();
  });

  it("follows the game: a changed discipline never keeps the previous game's slot on screen", async () => {
    loadDisciplineUI.mockImplementation(async (code) => moduleOf(code));
    const render = (discipline: string) => (
      <DisciplineWidget
        discipline={discipline}
        slot="nativeRankEditor"
        capabilities={LADDER}
        requires="native_ladder"
        props={EDITOR_PROPS}
        fallback={<p>generic</p>}
      />
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    const show = async (discipline: string) => {
      await act(async () => {
        root.render(
          <NextIntlClientProvider locale="en" messages={en}>
            {render(discipline)}
          </NextIntlClientProvider>
        );
      });
      await settle();
    };

    await show("overwatch");
    expect(container.querySelector("[data-slot]")?.getAttribute("data-slot")).toBe("overwatch");

    loadDisciplineUI.mockImplementation(async (code) => (code === "overwatch" ? moduleOf(code) : { code, slots: {} }));
    await show("lol");

    expect(container.querySelector("[data-slot]")).toBeNull();
    expect(container.querySelector("[role=alert]")?.textContent).toBe(en.common.discipline.widgetMissing);
  });
});
