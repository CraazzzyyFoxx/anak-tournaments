// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real copy: these assertions are about the label an admin reads in the status
// field, so an empty message set would only verify missing-message fallbacks.
import messages from "@/i18n/messages/en.json";
import { utcToZonedInput, zonedInputToUtc } from "@/lib/workspace/timezone";
import { EncounterEditDialog } from "@/components/tournaments/EncounterEditDialog";
import type { CaptainReport, Encounter, EncounterTeam } from "@/types/encounter.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const updateEncounter = vi.fn();
const setEncounterResult = vi.fn();
const getReports = vi.fn();

vi.mock("@/services/admin.service", () => ({
  default: {
    updateEncounter: (...args: unknown[]) => updateEncounter(...args),
    setEncounterResult: (...args: unknown[]) => setEncounterResult(...args),
    reopenEncounterResult: vi.fn()
  }
}));

vi.mock("@/services/captain.service", () => ({
  default: { getReports: (...args: unknown[]) => getReports(...args) }
}));

vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() }
}));

/** The two live seats, slot 1 Alpha and slot 2 Bravo, standing `one` – `two`. */
function seats(one: number, two: number): EncounterTeam[] {
  return [
    { id: 1, slot: 1, team_id: 11, name: "Alpha", seed: null, score: one, placement: null, active: true },
    { id: 2, slot: 2, team_id: 22, name: "Bravo", seed: null, score: two, placement: null, active: true }
  ];
}

function encounter(overrides: Partial<Encounter> = {}): Encounter {
  return {
    id: 42,
    created_at: new Date(0),
    updated_at: null,
    name: "A vs B",
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
    slot_count: 2,
    result_source: null,
    result_version: 1,
    games: [],
    teams: seats(1, 1),
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
  setEncounterResult.mockReset();
  setEncounterResult.mockResolvedValue(encounter());
  getReports.mockReset();
  getReports.mockResolvedValue({ reports: [], form: undefined });
});

/** A report by participation 1 (Alpha) claiming `one` – `two`. */
function report(overrides: Partial<CaptainReport> = {}): CaptainReport {
  return {
    id: 1,
    encounter_id: 42,
    encounter_team_id: 1,
    reporter_user_id: 5,
    games_played: 2,
    basis_version: 1,
    results: [
      { encounter_team_id: 1, score: 2, placement: null, wins: 2 },
      { encounter_team_id: 2, score: 0, placement: null, wins: 0 }
    ],
    closeness: null,
    comment: null,
    custom_fields: {},
    created_at: null,
    updated_at: null,
    ...overrides
  };
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === label
  );
}

function confirmLabel(first: number, second: number): string {
  return messages.matchEdit.confirmScore.replace("{first}", String(first)).replace("{second}", String(second));
}

/** The journal reason the server requires with every admin result. */
async function typeReason(value: string) {
  const input = document.body.querySelector<HTMLInputElement>('input[id$="-reason"]');
  if (!input) throw new Error("reason field not rendered");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

async function click(button: HTMLButtonElement | undefined) {
  if (!button) throw new Error("button not rendered");
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
}

describe("EncounterEditDialog result", () => {
  it("saves the settings without writing a standing", async () => {
    // Save used to carry the score: on a pending match it wrote a number that
    // never completed anything, on a completed one it flipped the winner
    // behind the bracket's back.
    await mount(<EncounterEditDialog open onOpenChange={() => {}} encounter={encounter()} />);
    await clickSave();

    const payload = updateEncounter.mock.calls[0]?.[1];
    expect(payload).not.toHaveProperty("results");
    expect(payload).not.toHaveProperty("teams");
    expect(payload).not.toHaveProperty("closeness");
  });

  it("opens on the only captain report and confirms by adopting it", async () => {
    // The encounter stays 0:0 until a result is confirmed, so a dialog that
    // opened on its own score confirmed a 0:0 draw nobody played.
    getReports.mockResolvedValue({ reports: [report()], form: undefined });
    await mount(
      <EncounterEditDialog
        open
        onOpenChange={() => {}}
        encounter={encounter({ teams: seats(0, 0), result_status: "pending_confirmation" })}
      />
    );

    expect(document.body.textContent).toContain(
      messages.matchEdit.sourceSingleReport.replace("{team}", "Alpha")
    );
    await typeReason("captain report");
    await click(findButton(confirmLabel(2, 0)));
    expect(setEncounterResult).toHaveBeenCalledWith(42, {
      reason: "captain report",
      results: [],
      adopt_report_team_id: 1
    });
  });

  it("sends a manually entered standing, one line per participation in slot order", async () => {
    getReports.mockResolvedValue({ reports: [report()], form: undefined });
    await mount(<EncounterEditDialog open onOpenChange={() => {}} encounter={encounter()} />);

    await click(document.body.querySelector<HTMLButtonElement>('button[aria-label^="Raise the score for Bravo"]') ?? undefined);
    await typeReason("log review");
    await click(findButton(confirmLabel(2, 1)));
    expect(setEncounterResult).toHaveBeenCalledWith(42, {
      reason: "log review",
      results: [
        { encounter_team_id: 1, score: 2 },
        { encounter_team_id: 2, score: 1 }
      ]
    });
  });

  it("will not confirm without a reason: the server refuses one", async () => {
    getReports.mockResolvedValue({ reports: [report()], form: undefined });
    await mount(<EncounterEditDialog open onOpenChange={() => {}} encounter={encounter()} />);

    expect(findButton(confirmLabel(2, 0))?.disabled).toBe(true);
    await typeReason("why");
    expect(findButton(confirmLabel(2, 0))?.disabled).toBe(false);
  });

  it("has no score to confirm when nobody reported and the match is still 0:0", async () => {
    await mount(
      <EncounterEditDialog open onOpenChange={() => {}} encounter={encounter({ teams: seats(0, 0) })} />
    );

    expect(document.body.textContent).toContain(messages.matchEdit.noScoreSelected);
    expect(findButton(messages.matchEdit.confirmResult)?.disabled).toBe(true);
  });

  it("refuses a draw on an elimination stage", async () => {
    await mount(
      <EncounterEditDialog
        open
        onOpenChange={() => {}}
        encounter={encounter({ teams: seats(1, 1) })}
        stageType="single_elimination"
      />
    );

    expect(document.body.textContent).toContain(messages.matchEdit.drawBlocked);
    await typeReason("why");
    expect(findButton(confirmLabel(1, 1))?.disabled).toBe(true);
  });

  it("shows a confirmed result read-only, with Reopen as the way to change it", async () => {
    await mount(
      <EncounterEditDialog
        open
        onOpenChange={() => {}}
        encounter={encounter({ status: "completed", result_status: "confirmed", teams: seats(2, 0) })}
      />
    );

    expect(document.body.querySelector('input[aria-label^="Score for"]')).toBeNull();
    expect(findButton(messages.matchEdit.reopenResult)).toBeDefined();
    expect(document.body.textContent).toContain(messages.matchEdit.confirmedHint);
  });
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

  /** Today on the viewer's clock — the day the picker adopts when it is empty
   *  and only a time is typed. */
  function todayAt(time: string): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${time}`;
  }

  /** The picker's clock field. */
  function timeField(): HTMLInputElement {
    const input = document.body.querySelector<HTMLInputElement>(
      'input[id^="encounter-scheduled-at-time-"]'
    );
    if (!input) throw new Error("start time field not rendered");
    return input;
  }

  /** The picker's date trigger — it prints the chosen day. */
  function dateTrigger(): HTMLButtonElement {
    const button = document.body.querySelector<HTMLButtonElement>(
      'button[id^="encounter-scheduled-at-"]:not([id*="-time-"])'
    );
    if (!button) throw new Error("start date trigger not rendered");
    return button;
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

    const local = utcToZonedInput(scheduled, VIEWER_ZONE);
    // "YYYY-MM-DDTHH:mm" split across the picker's two fields.
    expect(timeField().value).toBe(local.slice(11));
    expect(dateTrigger().textContent).toContain(String(Number(local.slice(8, 10))));

    await clickSave();
    expect(updateEncounter.mock.calls[0]?.[1]).toMatchObject({ scheduled_at: scheduled });
  });

  it("saves a newly typed time as a UTC instant", async () => {
    await mount(<EncounterEditDialog open onOpenChange={() => {}} encounter={encounter()} />);

    expect(timeField().value).toBe("");
    // An empty picker takes today's date, so typing only the clock is enough.
    await type("20:30");
    await clickSave();

    expect(updateEncounter.mock.calls[0]?.[1]).toMatchObject({
      scheduled_at: zonedInputToUtc(todayAt("20:30"), VIEWER_ZONE)
    });
  });

  it("clears the time through the picker's clear button", async () => {
    await mount(
      <EncounterEditDialog
        open
        onOpenChange={() => {}}
        encounter={encounter({ scheduled_at: "2026-05-02T15:00:00.000Z" })}
      />
    );

    const clear = document.body.querySelector<HTMLButtonElement>(
      `button[title="${messages.matchEdit.scheduledAtClear}"]`
    );
    if (!clear) throw new Error("clear button not rendered");
    await act(async () => {
      clear.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(timeField().value).toBe("");
    await clickSave();

    expect(updateEncounter.mock.calls[0]?.[1]).toMatchObject({ scheduled_at: null });
  });
});
