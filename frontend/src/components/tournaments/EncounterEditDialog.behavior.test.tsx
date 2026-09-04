// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real copy: these assertions are about the label an admin reads in the status
// field, so an empty message set would only verify missing-message fallbacks.
import messages from "@/i18n/messages/en.json";
import { utcToZonedInput, zonedInputToUtc } from "@/lib/timezone";
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

/**
 * The per-match override of the stage editor's round schedule (P7). A round is
 * scheduled in bulk; this field is how the one series that moved keeps its own
 * time. It is nullable on purpose — clearing it means "no planned time".
 */
describe("EncounterEditDialog start time", () => {
  const VIEWER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

  /** The only `datetime-local` field in the dialog. */
  function timeField(): HTMLInputElement {
    const input = document.body.querySelector<HTMLInputElement>(
      'input[type="datetime-local"]'
    );
    if (!input) throw new Error("start time field not rendered");
    return input;
  }

  async function type(value: string) {
    const input = timeField();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
  }

  it("shows the stored instant on the viewer's clock and sends it back unchanged", async () => {
    const scheduled = "2026-05-02T15:00:00.000Z";
    await mount(
      <EncounterEditDialog open onOpenChange={() => {}} encounter={encounter({ scheduled_at: scheduled })} />
    );

    expect(timeField().value).toBe(utcToZonedInput(scheduled, VIEWER_ZONE));

    await clickSave();
    expect(updateEncounter.mock.calls[0]?.[1]).toMatchObject({ scheduled_at: scheduled });
  });

  it("saves a newly typed time as a UTC instant", async () => {
    await mount(<EncounterEditDialog open onOpenChange={() => {}} encounter={encounter()} />);

    expect(timeField().value).toBe("");
    await type("2026-05-02T20:30");
    await clickSave();

    expect(updateEncounter.mock.calls[0]?.[1]).toMatchObject({
      scheduled_at: zonedInputToUtc("2026-05-02T20:30", VIEWER_ZONE)
    });
  });

  it("clears the time when the field is emptied", async () => {
    await mount(
      <EncounterEditDialog
        open
        onOpenChange={() => {}}
        encounter={encounter({ scheduled_at: "2026-05-02T15:00:00.000Z" })}
      />
    );

    await type("");
    await clickSave();

    expect(updateEncounter.mock.calls[0]?.[1]).toMatchObject({ scheduled_at: null });
  });
});
