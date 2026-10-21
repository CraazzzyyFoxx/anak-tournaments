// @vitest-environment happy-dom
//
// The generic division editor is the same screen for every game; what differs is the game's own
// declaration. These pin the scope behaviour of its table:
//  - a native-ladder game gets the native-rank column and edits it through ITS module's slot;
//  - a game without a ladder gets plain custom editing: no OW column, no ladder scale, a crest
//    demand instead of a borrowed crest, and no module is asked to render anything;
//  - a promised native editor whose module is absent is an explicit error, never another game's picker.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DisciplineCapabilities } from "@/types/discipline.types";
import type { DivisionTier } from "@/types/workspace.types";

vi.mock("next/image", () => ({
  default: ({
    unoptimized: _unoptimized,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => (
    // eslint-disable-next-line @next/next/no-img-element -- this IS the next/image stand-in
    <img {...props} alt={props.alt ?? ""} />
  )
}));

import { TEST_LADDER } from "./__fixtures__/test-ladder";
import { DivisionsTable } from "./DivisionsTable";
import { bandsFromTiers, type Action, type Ladder } from "./draftReducer";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NO_CAPABILITIES: DisciplineCapabilities = {
  catalog_sync: false,
  native_rank_collection: false,
  native_ladder: false,
  achievement_conditions: false,
  analytics: false
};
const NATIVE: DisciplineCapabilities = { ...NO_CAPABILITIES, native_ladder: true };

const TIERS: DivisionTier[] = [
  { id: 1, slug: "gold", number: 1, name: "Gold", rank_min: 1000, rank_max: null, icon_url: "https://cdn/gold.png" },
  { id: 2, slug: "iron", number: 2, name: "Iron", rank_min: 0, rank_max: 999, icon_url: "" }
];

const mounted: { root: Root; container: HTMLElement }[] = [];

async function settle(turns = 6) {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function mount(props: {
  discipline: string;
  capabilities: DisciplineCapabilities;
  ladder: Ladder | null;
  dispatch?: (action: Action) => void;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <DivisionsTable
          bands={bandsFromTiers(props.ladder, TIERS)}
          base={[]}
          scale="custom"
          discipline={props.discipline}
          capabilities={props.capabilities}
          ladder={props.ladder}
          editable
          selectedSlug={null}
          onSelect={() => {}}
          dispatch={props.dispatch ?? (() => {})}
          onPickIcon={() => {}}
          onScaleChange={() => {}}
          canFollowLadder={false}
        />
      </QueryClientProvider>
    );
  });
  await settle();
  return container;
}

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
  document.body.innerHTML = "";
});

const headers = (container: HTMLElement) =>
  [...container.querySelectorAll("th")].map((cell) => cell.textContent?.trim());

describe("DivisionsTable · per-game scope", () => {
  it("offers a native-ladder game its own native-rank picker, and a pick becomes a link action", async () => {
    const dispatch = vi.fn();
    const container = await mount({
      discipline: "overwatch",
      capabilities: NATIVE,
      ladder: TEST_LADDER,
      dispatch
    });

    expect(headers(container)).toContain("OW ranks");
    const trigger = container.querySelector<HTMLElement>('button[aria-label^="OW ranks of Gold"]');
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle(3);

    const first = TEST_LADDER.ranks[0].name;
    const third = TEST_LADDER.ranks[2].name;
    for (const name of [first, third]) {
      const rank = document.querySelector<HTMLElement>(`button[aria-label="${name}"]`);
      expect(rank, name).not.toBeNull();
      await act(async () => rank!.click());
    }
    expect(dispatch).toHaveBeenCalledWith({ type: "link", bandIndex: 0, from: 0, to: 2 });
  });

  it("gives a game without a ladder plain custom editing: no native column, no ladder scale, a crest demand", async () => {
    const container = await mount({ discipline: "lol", capabilities: NO_CAPABILITIES, ladder: null });

    expect(headers(container)).not.toContain("OW ranks");
    expect(container.textContent).not.toContain("Follow OW ladder");
    expect(container.querySelector('button[aria-label^="OW ranks of"]')).toBeNull();
    // Iron has no crest and there is no ladder to borrow one from: it is asked for, not faked.
    expect(container.textContent).toContain("1 division has no crest");
    expect(container.querySelector('[role="img"][title="Crest required"]')).not.toBeNull();
    expect(container.textContent).not.toContain("borrow");
    expect([...container.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual([
      "https://cdn/gold.png"
    ]);
  });

  it("shows a configuration error — never another game's picker — when a declared native editor has no module", async () => {
    const container = await mount({
      discipline: "mystery-game",
      capabilities: NATIVE,
      ladder: TEST_LADDER
    });

    expect(container.querySelector('button[aria-label^="OW ranks of"]')).toBeNull();
    const alerts = [...container.querySelectorAll('[role="alert"]')].map((node) => node.textContent);
    expect(alerts.some((text) => text?.includes("interface is not installed"))).toBe(true);
  });
});
