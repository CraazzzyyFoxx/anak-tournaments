// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PickBanRulesCatalog } from "@/types/tournament.types";

import { useRulesCatalog } from "./useRulesCatalog";

const getRulesCatalog = vi.fn();
vi.mock("@/services/pickBan.service", () => ({
  default: { getRulesCatalog: (...args: unknown[]) => getRulesCatalog(...args) }
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function catalog(presetId: string): PickBanRulesCatalog {
  return {
    leaves: [],
    constraints: [],
    groups: { hero: [], map: [] },
    presets: [
      { id: presetId, kind: "hero", modes: ["pool"], ruleset: { version: 2, timer_seconds: null, on_timeout: "wait", phases: [] }, first_ban_rotation: null, mix_eligible: true }
    ]
  };
}

function Probe({ discipline }: Readonly<{ discipline: string }>) {
  const query = useRulesCatalog(discipline);
  return <span data-presets={query.data?.presets.map((preset) => preset.id).join(",") ?? "none"} />;
}

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

async function show(discipline: string) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe discipline={discipline} />
      </QueryClientProvider>
    );
  });
}
const shown = () => container.querySelector("[data-presets]")?.getAttribute("data-presets");
const flush = () =>
  act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
});

describe("useRulesCatalog", () => {
  it("keys each discipline apart: another game's presets never stand in while this one loads", async () => {
    const pending = Promise.withResolvers<PickBanRulesCatalog>();
    getRulesCatalog.mockImplementation((discipline: string) =>
      discipline === "overwatch" ? Promise.resolve(catalog("hero_anti_one_trick")) : pending.promise
    );

    await show("overwatch");
    await flush();
    expect(shown()).toBe("hero_anti_one_trick");

    await show("lol");
    // No placeholder: the League read is in flight and Overwatch's presets are not shown for it.
    expect(shown()).toBe("none");
    expect(getRulesCatalog.mock.calls.map(([discipline]) => discipline)).toEqual(["overwatch", "lol"]);

    // The answer lands in two hops: the read settles (microtasks), then react-query notifies observers on a zero
    // timeout. Resolved in the same tick as `flush`, that timeout was queued after `flush`'s own, and whenever the
    // read took a millisecond to settle it fired after `flush`'s act had closed. Settled in its own act first, the
    // notification is always queued ahead of `flush`.
    await act(async () => pending.resolve(catalog("lol_side_selection")));
    await flush();
    expect(shown()).toBe("lol_side_selection");

    // Back to the first game: its own cached answer, not League's.
    await show("overwatch");
    expect(shown()).toBe("hero_anti_one_trick");
  });

  it("aborts a superseded read and never lets its late answer feed the new scope", async () => {
    const late = Promise.withResolvers<PickBanRulesCatalog>();
    const signals: AbortSignal[] = [];
    getRulesCatalog.mockImplementation((discipline: string, signal: AbortSignal) => {
      signals.push(signal);
      return discipline === "overwatch" ? late.promise : Promise.resolve(catalog("lol_side_selection"));
    });

    await show("overwatch");
    await show("lol");
    await flush();
    expect(shown()).toBe("lol_side_selection");

    // The delayed Overwatch answer lands after the switch: it belongs to Overwatch's key only.
    late.resolve(catalog("hero_anti_one_trick"));
    await flush();
    expect(shown()).toBe("lol_side_selection");
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });
});
