// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real copy: these assertions are about the label an admin reads in the status
// field, so an empty message set would only verify missing-message fallbacks.
import messages from "@/i18n/messages/en.json";
import { EncounterEditDialog } from "@/components/tournaments/EncounterEditDialog";
import type { Encounter } from "@/types/encounter.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const updateEncounter = vi.fn();
const getReports = vi.fn();

vi.mock("@/services/admin.service", () => ({
  default: {
    updateEncounter: (...args: unknown[]) => updateEncounter(...args),
    setEncounterResult: vi.fn(),
    reopenEncounterResult: vi.fn()
  }
}));

vi.mock("@/services/captain.service", () => ({
  default: { getReports: (...args: unknown[]) => getReports(...args) }
}));

vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() }
}));

function encounter(overrides: Partial<Encounter> = {}): Encounter {
  return {
    id: 42,
    created_at: new Date(0),
    updated_at: null,
    name: "A vs B",
    home_team_id: 1,
    away_team_id: 2,
    score: { home: 1, away: 1 },
    round: 1,
    best_of: 2,
    tournament_id: 7,
    tournament_group_id: null,
    stage_id: 1,
    stage_item_id: 1,
    challonge_id: null,
    status: "open",
    closeness: null,
    has_logs: false,
    result_status: "none",
    scheduled_at: null,
    started_at: null,
    ended_at: null,
    current_map_index: null,
    confirmed_at: null,
    matches: [],
    home_team: { id: 1, name: "Alpha" } as never,
    away_team: { id: 2, name: "Bravo" } as never,
    tournament: null as never,
    stage: null,
    stage_item: null,
    tournament_group: null,
    ...overrides
  };
}

async function flush() {
  for (let turn = 0; turn < 8; turn += 1) {
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  createRoot(container).render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </NextIntlClientProvider>
  );
  await flush();
}

/** Best of first, Status second — the two selects in the dialog. */
function statusTrigger(): HTMLButtonElement {
  const triggers = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button[role="combobox"]'));
  const trigger = triggers[1];
  if (!trigger) throw new Error("status select not rendered");
  return trigger;
}

async function clickSave() {
  const save = Array.from(document.body.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === messages.matchEdit.save
  );
  if (!save) throw new Error("save button not rendered");
  await act(async () => {
    save.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = "";
  updateEncounter.mockReset();
  updateEncounter.mockResolvedValue(encounter());
  getReports.mockReset();
  getReports.mockResolvedValue({ reports: [], form: undefined });
});

describe("EncounterEditDialog status field", () => {
  it("labels a completed encounter and locks the select", async () => {
    await mount(
      <EncounterEditDialog open onOpenChange={() => {}} encounter={encounter({ status: "completed" })} />
    );

    const trigger = statusTrigger();
    expect(trigger.textContent).toContain(messages.matchEdit.statuses.completed);
    expect(trigger.disabled).toBe(true);
    expect(document.body.textContent).toContain(messages.matchEdit.statusLockedHint);
  });

  it("omits status when saving a completed encounter", async () => {
    await mount(
      <EncounterEditDialog open onOpenChange={() => {}} encounter={encounter({ status: "completed" })} />
    );
    await clickSave();

    expect(updateEncounter).toHaveBeenCalledTimes(1);
    expect(updateEncounter.mock.calls[0]?.[1]).not.toHaveProperty("status");
  });

  it("keeps the status editable and sent for an open encounter", async () => {
    await mount(<EncounterEditDialog open onOpenChange={() => {}} encounter={encounter()} />);

    const trigger = statusTrigger();
    expect(trigger.textContent).toContain(messages.matchEdit.statuses.open);
    expect(trigger.disabled).toBe(false);

    await clickSave();
    expect(updateEncounter.mock.calls[0]?.[1]).toMatchObject({ status: "open" });
  });
});
