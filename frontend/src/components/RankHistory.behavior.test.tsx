// @vitest-environment happy-dom
//
// Rank history belongs to whichever game collects native ranks. The host resolves the player, picks the
// collecting game by capability (never by name) and hands the drawing to that game's module slot.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DisciplineDescriptor } from "@/types/discipline.types";

const getUserByName = vi.fn();
let collector: {
  descriptor: DisciplineDescriptor | null;
  supported: boolean;
  isLoading: boolean;
  isError: boolean;
};
let requestedDiscipline: string | undefined;

vi.mock("@/hooks/useCurrentWorkspace", () => ({ useCurrentWorkspaceId: () => 1 }));
vi.mock("@/hooks/useNativeRankCollector", () => ({
  useNativeRankCollector: (_axis: unknown, preferred?: string) => {
    requestedDiscipline = preferred;
    return collector;
  }
}));
vi.mock("@/services/user.service", () => ({
  default: { getUserByName: (...args: unknown[]) => getUserByName(...args) }
}));
vi.mock("@/disciplines/DisciplineWidget", () => ({
  DisciplineWidget: (props: {
    discipline: string;
    slot: string;
    requires?: string;
    props: { userId: number };
  }) => (
    <div
      data-testid="widget"
      data-discipline={props.discipline}
      data-slot={props.slot}
      data-requires={props.requires}
      data-user={props.props.userId}
    />
  )
}));

import RankHistory from "./RankHistory";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OVERWATCH: DisciplineDescriptor = {
  code: "overwatch",
  name: "Overwatch",
  enabled: true,
  kinds: {},
  character_classes: [],
  identity_provider: "battlenet",
  capabilities: {
    catalog_sync: true,
    native_rank_collection: true,
    native_ladder: true,
    achievement_conditions: true,
    analytics: true
  }
};

const LOL: DisciplineDescriptor = {
  ...OVERWATCH,
  code: "lol",
  name: "League of Legends",
  capabilities: { ...OVERWATCH.capabilities, native_rank_collection: false, native_ladder: false }
};

const mounted: { root: Root; container: HTMLElement }[] = [];

async function render(ui: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  });
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
  return container;
}

beforeEach(() => {
  collector = { descriptor: OVERWATCH, supported: true, isLoading: false, isError: false };
  requestedDiscipline = undefined;
  getUserByName.mockReset().mockResolvedValue({ id: 42 });
});

afterEach(async () => {
  // Unmount, not just detach: a lingering root would keep rendering into the next test's mocks.
  for (const entry of mounted.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
});

describe("RankHistory host", () => {
  it("hands the collecting game's slot the player, gated on native-rank collection", async () => {
    const container = await render(<RankHistory userId={7} />);

    const widget = container.querySelector('[data-testid="widget"]');
    expect(widget?.getAttribute("data-discipline")).toBe("overwatch");
    expect(widget?.getAttribute("data-slot")).toBe("rankHistory");
    expect(widget?.getAttribute("data-requires")).toBe("native_rank_collection");
    expect(widget?.getAttribute("data-user")).toBe("7");
  });

  it("resolves a BattleTag to its player before drawing", async () => {
    const container = await render(<RankHistory battleTag="Player#1234" discipline="overwatch" />);

    expect(getUserByName).toHaveBeenCalledWith("Player#1234");
    expect(requestedDiscipline).toBe("overwatch");
    expect(container.querySelector('[data-testid="widget"]')?.getAttribute("data-user")).toBe("42");
  });

  it("asks the hook for the OWNING game, and shows the unsupported state for a game that collects no ranks", async () => {
    collector = { descriptor: LOL, supported: false, isLoading: false, isError: false };
    const container = await render(<RankHistory userId={7} discipline="lol" />);

    expect(requestedDiscipline).toBe("lol");
    expect(container.querySelector('[data-testid="widget"]')).toBeNull();
    expect(container.textContent).toContain("Rank history is not available for this game");
  });

  it("shows the unsupported state when no game resolves at all", async () => {
    collector = { descriptor: null, supported: false, isLoading: false, isError: false };
    const container = await render(<RankHistory userId={7} />);

    expect(container.querySelector('[data-testid="widget"]')).toBeNull();
    expect(container.textContent).toContain("Rank history is not available for this game");
  });

  it("keeps the no-linked-profile state ahead of any game", async () => {
    const container = await render(<RankHistory userId={null} />);

    expect(container.querySelector('[data-testid="widget"]')).toBeNull();
    expect(container.textContent).toContain("No linked player profile");
  });
});
