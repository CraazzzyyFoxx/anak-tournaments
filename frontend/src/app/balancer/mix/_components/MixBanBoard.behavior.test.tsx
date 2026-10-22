// @vitest-environment happy-dom
//
// A lobby's Pre-game ends when its ban room does: the bans finished, or a host cancelled the room (the match then
// plays without bans). Either way the room re-reads its lobby exactly once, which then reads Live. The board itself
// is the shared pick-ban library's, mounted for real over a mocked server.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { PickBanEntry, PickBanResolvedStep, PickBanState } from "@/types/tournament.types";

import { MixBanBoard } from "./MixBanBoard";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getPickBanState = vi.fn();
const adminPickBanCancel = vi.fn();

vi.mock("@/services/pickBan.service", () => ({
  default: {
    getPickBanState: (...args: unknown[]) => getPickBanState(...args),
    performPickBanAction: vi.fn(),
    submitDraft: vi.fn(),
    disputeStep: vi.fn(),
    undoLastAction: vi.fn(),
    electOpener: vi.fn(),
  },
}));
vi.mock("@/services/admin.service", () => ({
  default: {
    adminPickBanCancel: (...args: unknown[]) => adminPickBanCancel(...args),
    resetPickBanSession: vi.fn(),
    adminPickBanAct: vi.fn(),
    adminPickBanSubmit: vi.fn(),
    adminPickBanReopen: vi.fn(),
    adminPickBanPause: vi.fn(),
    adminPickBanExtend: vi.fn(),
    adminPickBanElectOpener: vi.fn(),
    adminTechnicalLoss: vi.fn(),
  },
}));
vi.mock("@/services/catalog.service", () => ({
  default: {
    list: async () => ({
      results: [101, 102, 103].map((id) => ({ id, name: `Hero ${id}`, image_path: "", attrs: { class: "damage" } })),
    }),
  },
}));
vi.mock("@/services/discipline.service", () => ({
  default: {
    list: async () => [],
    metadata: async (_axis: unknown, code: string) => ({
      discipline: { code, character_classes: ["tank", "damage", "support"], capabilities: {} },
      dimensions: [],
      roles: [],
    }),
  },
}));
vi.mock("@/hooks/useRealtimeTopic", () => ({ useRealtimeTopic: vi.fn() }));
vi.mock("@/lib/notify", () => ({
  notify: { apiError: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const ADMIN = en.pickBan.room.admin;
// The live match's seats, slot 1 bans first.
const SEATS = [
  { id: 71, slot: 1, name: "Bright Wolves" },
  { id: 72, slot: 2, name: "Quiet Foxes" },
];

const BAN: PickBanResolvedStep = {
  index: 0,
  round: 1,
  phase_id: "main",
  step_id: "s0",
  action: "ban",
  actors: [71],
  actors_token: null,
  count: 1,
  min: 1,
  blind: false,
  target: null,
  lifetime: 1,
  timer_seconds: null,
  on_timeout: "random_fill",
  dispute: { enabled: false, max: 0 },
  eligible: {},
  constraints: [],
};

function pool(): PickBanEntry[] {
  return [101, 102, 103].map((itemId, index) => ({
    id: 30 + index,
    item_id: itemId,
    round: 1,
    order: 0,
    action_index: null,
    picked_by_kind: null,
    picked_by_team_id: null,
    protected_by_kind: null,
    protected_by_team_id: null,
    status: "available",
    carried_from_round: null,
  }));
}

/** The hero room as the host reads it: the first ban open, or the room after a host cancelled it. */
function heroState(status: "active" | "cancelled"): PickBanState {
  const open = status === "active";
  return {
    session: {
      id: 1,
      kind: "hero",
      status,
      first_team_id: 71,
      awaiting_choice: false,
      pending_chooser_team_id: null,
      seed_source: "bracket_slot",
      slot_reserves: null,
      started_at: "2026-10-22T20:00:00Z",
      current_step_started_at: null,
      paused_at: null,
    },
    readiness: { 71: true, 72: true },
    sequence: [BAN],
    pool: pool(),
    submissions: [],
    viewer_team_id: null,
    viewer_can_act: false,
    allowed_actions: [],
    current_step_index: open ? 0 : null,
    current_step: open ? BAN : null,
    expected_action: null,
    acting_team_ids: open ? [71] : [],
    step_progress: null,
    step_deadline: null,
    current_round: 1,
    is_complete: false,
    eligible: null,
    draft_issues: [],
    targets: null,
    sides: [],
    dispute: { available: false, step_index: null, attempts_used: 0, max: 0 },
    undo: { requested_by_team_id: null, step_index: null, item_ids: [], action: null, encounter_team_id: null },
  };
}

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function settle(ticks = 3) {
  for (let index = 0; index < ticks; index += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

async function render(onComplete: () => void) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <MixBanBoard
            encounterId={50}
            workspaceId={7}
            discipline="overwatch"
            seats={SEATS}
            canHost
            onComplete={onComplete}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
}

const byLabel = (label: string) =>
  [...document.body.querySelectorAll("button")].find((button) => button.textContent?.trim() === label) ?? null;

describe("MixBanBoard", () => {
  it("re-reads the lobby once when a host cancels the ban room", async () => {
    let refreshes = 0;
    getPickBanState.mockResolvedValue(heroState("active"));
    await render(() => (refreshes += 1));

    expect(container.textContent).toContain(en.mixes.room.bansTitle);
    expect(refreshes).toBe(0);

    await act(async () => byLabel(ADMIN.cancelSession)?.click());
    await settle();
    const reason = document.body.querySelector<HTMLInputElement>(`input[aria-label="${ADMIN.cancelReason}"]`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(reason, "voice is down");
      reason?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // The server cancels the room; the board's next read says so.
    adminPickBanCancel.mockImplementation(async () => {
      getPickBanState.mockResolvedValue(heroState("cancelled"));
      return {};
    });
    await act(async () => byLabel(ADMIN.cancelConfirmAction)?.click());
    await settle();

    expect(adminPickBanCancel).toHaveBeenCalledTimes(1);
    expect(byLabel(ADMIN.cancelSession)).toBeNull();
    expect(refreshes).toBe(1);

    // The room re-renders while its lobby reloads, with a new callback each time: still one refresh.
    await render(() => (refreshes += 1));
    expect(refreshes).toBe(1);
  });
});
