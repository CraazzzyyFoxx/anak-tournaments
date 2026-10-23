// @vitest-environment happy-dom
//
// A lobby's draft (spec §9.3, §7.5 A2/D1): hosts start it, cancel it and replace captains; the board is the shared
// draft room's; the captain on the clock is alerted in the tab. The draft service is the seam: the panel's real
// queries and mutations run against a fake server board.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { DraftBoard, DraftLifecycleAction } from "@/types/draft.types";

import { MixDraftPanel } from "./MixDraftPanel";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let server: DraftBoard;
vi.mock("@/services/draft.service", () => ({
  default: {
    getSessionBoard: async () => server,
    lifecycle: async (sessionId: number, action: DraftLifecycleAction) => {
      if (sessionId === 31 && action === "start") server = draft("live", false);
      return server.session;
    },
  },
}));
vi.mock("@/components/draft/DraftBoard", () => ({ DraftBoard: () => <div data-testid="board" /> }));
vi.mock("@/hooks/useAuthProfile", () => ({ useAuthProfile: () => ({ user: { id: 70, linkedPlayers: [{ playerId: 7 }] } }) }));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), apiError: vi.fn() } }));

const OWNER = { workspaceId: 2, discipline: "overwatch", name: "Thursday · Lobby A", href: "/balancer/mix/9", divisionGrid: null, isOrganizer: true };

/** Two teams, team 10 on the clock once live; `mine` makes the viewer (account 70, player 7) its captain. */
function draft(status: "ready" | "live", mine: boolean): DraftBoard {
  const onClock = { id: 1, draft_team_id: 10, status: status === "live" ? "on_clock" : "upcoming", version: 0 };
  return {
    session: { id: 31, status, current_pick_id: status === "live" ? 1 : null },
    teams: [
      { id: 10, name: "Bravo", captain_auth_user_id: mine ? 70 : 80, captain_user_id: mine ? 7 : 8, draft_position: 1 },
      { id: 11, name: "Alpha", captain_auth_user_id: 81, captain_user_id: 9, draft_position: 2 },
    ],
    picks: [onClock],
    players: [
      { id: 1, user_id: mine ? 7 : 8, player_name: "bravo", identity: null, is_captain: true, drafted_by_team_id: 10, status: "picked" },
      { id: 2, user_id: 9, player_name: "alpha", identity: null, is_captain: true, drafted_by_team_id: 11, status: "picked" },
      { id: 3, user_id: 10, player_name: "charlie", identity: null, is_captain: false, drafted_by_team_id: null, status: "available" },
    ],
    current_pick: status === "live" ? onClock : null,
    last_event_id: 0,
  } as unknown as DraftBoard;
}

let container: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
}

async function mount(canHost: boolean) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NextIntlClientProvider locale="en" messages={en}>
          <MixDraftPanel
            sessionId={31}
            owner={OWNER}
            canHost={canHost}
            waiting={[]}
            replacing={false}
            adding={false}
            onReplaceCaptain={vi.fn()}
            onAddPlayer={vi.fn()}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
}

function button(name: string) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent === name) ?? null;
}

beforeEach(() => {
  document.title = "Mix";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("MixDraftPanel", () => {
  it("lets a host start the seeded draft", async () => {
    server = draft("ready", false);
    await mount(true);

    await act(async () => button(en.mixes.draft.startDraft)!.click());
    await settle();

    expect(button(en.mixes.draft.startDraft)).toBeNull();
    expect(button(en.mixes.draft.cancelDraft)).not.toBeNull();
  });

  it("shows a viewer the board and no host controls", async () => {
    server = draft("ready", false);
    await mount(false);

    expect(container.querySelector('[data-testid="board"]')).not.toBeNull();
    expect(button(en.mixes.draft.startDraft)).toBeNull();
    expect(button(en.mixes.draft.cancelDraft)).toBeNull();
  });

  it("puts the captain's own turn in the tab title", async () => {
    server = draft("live", true);
    await mount(false);

    expect(document.title).toBe(en.mixes.draft.yourPickTitle);
  });
});
