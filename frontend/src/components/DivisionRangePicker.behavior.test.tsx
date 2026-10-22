// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/messages/en.json";
import type { DivisionTier } from "@/types/workspace.types";

import { DivisionRangePicker } from "./DivisionRangePicker";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tier = (number: number, name: string, rank_min: number): DivisionTier => ({
  number,
  name,
  rank_min,
  icon_url: `/divisions/${number}.png`
});

/** League-shaped, 1 = best: an apex tier without a step, then stepped tiers. */
const TOP_FIRST = {
  tiers: [
    tier(1, "Challenger", 3500),
    tier(2, "Diamond I", 2700),
    tier(3, "Diamond II", 2600),
    tier(4, "Gold 1", 1500),
    tier(5, "Gold 2", 1400)
  ]
};

let root: Root;
let container: HTMLDivElement;

async function mount(props: Partial<Parameters<typeof DivisionRangePicker>[0]> & { onChange: (min?: number, max?: number) => void }) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DivisionRangePicker grid={TOP_FIRST} ariaLabel="Divisions" {...props} />
      </NextIntlClientProvider>
    );
  });
}

const trigger = () => container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click = (node: HTMLElement) => act(async () => node.click());

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("DivisionRangePicker", () => {
  it("folds stepped names into rows and closes a range from two clicks in either order", async () => {
    const onChange = vi.fn();
    await mount({ onChange });
    await click(trigger());

    expect([...document.querySelectorAll("[data-row]")].map((row) => row.getAttribute("aria-label"))).toEqual([
      "Challenger",
      "Diamond",
      "Gold"
    ]);

    await click(button("Gold 2"));
    await click(button("Diamond I"));

    expect(onChange.mock.calls).toEqual([
      [5, 5],
      [2, 5]
    ]);
    expect(document.querySelector("[data-row]")).toBeNull();
  });

  it("picks a whole row from its name", async () => {
    const onChange = vi.fn();
    await mount({ onChange });
    await click(trigger());

    await click(button("All of Diamond"));

    expect(onChange).toHaveBeenCalledWith(2, 3);
  });

  it("draws an open end to the grid's edge, worse division first, on a grid numbered bottom up", async () => {
    const bottomFirst = { tiers: [tier(1, "Bronze", 0), tier(2, "Silver", 1000), tier(3, "Gold", 2000)] };
    await mount({ grid: bottomFirst, min: 2, onChange: vi.fn() });

    expect(trigger().getAttribute("aria-label")).toBe("Divisions: Silver – Gold");
  });
});
