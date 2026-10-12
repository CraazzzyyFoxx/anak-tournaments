// @vitest-environment happy-dom
import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ResolveResultDialog } from "@/components/admin/ResolveResultDialog";
import type { AdminCaptainReport, EncounterReportsRow } from "@/types/admin.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setEncounterResult = vi.fn();
const reopenEncounterResult = vi.fn();
const getEncounterResultAudit = vi.fn();

vi.mock("@/services/admin.service", () => ({
  default: {
    setEncounterResult: (...args: unknown[]) => setEncounterResult(...args),
    reopenEncounterResult: (...args: unknown[]) => reopenEncounterResult(...args),
    getEncounterResultAudit: (...args: unknown[]) => getEncounterResultAudit(...args)
  }
}));

vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() }
}));

async function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={{}}>
        <QueryClientProvider client={client}>{node}</QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  // Radix portals render outside the container.
  return document.body;
}

/** A report by participation `by`, claiming `one` – `two` (slot 1 – slot 2). */
function report(by: 1 | 2, one: number, two: number): AdminCaptainReport {
  return {
    id: by,
    encounter_id: 10,
    encounter_team_id: by,
    reporter_user_id: null,
    reporter_name: "cap",
    games_played: one + two,
    basis_version: 1,
    results: [
      { encounter_team_id: 1, score: one, placement: null, wins: one },
      { encounter_team_id: 2, score: two, placement: null, wins: two }
    ],
    closeness: 6,
    comment: null,
    custom_fields: {},
    created_at: null,
    updated_at: null
  };
}

function row(overrides: Partial<EncounterReportsRow> = {}): EncounterReportsRow {
  return {
    id: 10,
    name: "A vs B",
    tournament_id: 3,
    tournament_name: "Cup",
    stage_name: "Groups",
    stage_type: "round_robin",
    round: 1,
    best_of: 3,
    status: "OPEN",
    result_status: "disputed",
    scheduled_at: null,
    // Out of slot order on purpose: everything reads by slot.
    participations: [
      { encounter_team_id: 2, slot: 2, team_id: 22, name: "B" },
      { encounter_team_id: 1, slot: 1, team_id: 11, name: "A" }
    ],
    reports: [report(1, 2, 1), report(2, 0, 2)],
    replay_codes: [],
    reported_count: 2,
    standings_match: false,
    series_score_valid: true,
    last_resolution: null,
    ...overrides
  };
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === label
  );
}

/** The mode chooser is a Radix radio group: each item is a `<button role="radio">`
 *  named by a sibling `<label for>`, so reach it through the label. */
function findRadio(labelText: string): HTMLButtonElement {
  const label = Array.from(document.body.querySelectorAll("label")).find((node) =>
    (node.textContent ?? "").includes(labelText)
  );
  if (!label) throw new Error(`no option labelled ${labelText}`);
  const radio = document.getElementById(label.htmlFor);
  if (!radio) throw new Error(`label ${labelText} points at no control`);
  return radio as HTMLButtonElement;
}

/** Type into a React-controlled input the way a browser would. */
async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function byLabel(text: string): HTMLInputElement {
  const label = Array.from(document.body.querySelectorAll("label")).find(
    (node) => node.textContent?.trim() === text
  );
  if (!label) throw new Error(`no field labelled ${text}`);
  return document.getElementById(label.htmlFor) as HTMLInputElement;
}

describe("ResolveResultDialog", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setEncounterResult.mockReset().mockResolvedValue({});
    reopenEncounterResult.mockReset().mockResolvedValue({});
    getEncounterResultAudit.mockReset().mockResolvedValue([]);
  });

  it("previews the adopted report's standing in slot order, not the encounter's", async () => {
    // The admin is choosing between two claims; the preview must show the claim
    // that will be recorded, or the choice is unverifiable before submitting.
    const body = await mount(<ResolveResultDialog row={row()} open onOpenChange={() => {}} />);
    expect(body.textContent).toContain("2 – 1");
  });

  it("lists every participation's replay codes, by position, for the admin to compare", async () => {
    const body = await mount(
      <ResolveResultDialog
        row={row({
          replay_codes: [
            { position: 1, encounter_team_id: 1, code: "A1B2" },
            { position: 1, encounter_team_id: 2, code: "Z9Y8" }
          ]
        })}
        open
        onOpenChange={() => {}}
      />
    );
    expect(body.textContent).toContain("Replay codes");
    expect(body.textContent).toContain("A · Map 1");
    expect(body.textContent).toContain("A1B2");
    expect(body.textContent).toContain("B · Map 1");
    expect(body.textContent).toContain("Z9Y8");
  });

  it("adopts a report by participation id rather than by copying its numbers", async () => {
    // The audit records whose report was believed. Sending the bare standing
    // would settle the encounter but lose why.
    await mount(<ResolveResultDialog row={row()} open onOpenChange={() => {}} />);
    await typeInto(byLabel("Reason"), "captains agreed on a replay");
    await act(async () => {
      findButton("Confirm result")?.click();
    });
    expect(setEncounterResult).toHaveBeenCalledWith(10, {
      reason: "captains agreed on a replay",
      results: [],
      adopt_report_team_id: 1,
      closeness: undefined
    });
  });

  it("adopts the other report once the admin picks it", async () => {
    const body = await mount(<ResolveResultDialog row={row()} open onOpenChange={() => {}} />);

    const second = findRadio("Adopt B report");
    expect(second.getAttribute("role")).toBe("radio");
    expect(second.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      second.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // B reported 0 – 2, so the preview has to follow the selection.
    expect(body.textContent).toContain("0 – 2");
    await typeInto(byLabel("Reason"), "B's log matches");
    await act(async () => {
      findButton("Confirm result")?.click();
    });
    expect(setEncounterResult).toHaveBeenCalledWith(10, {
      reason: "B's log matches",
      results: [],
      adopt_report_team_id: 2,
      closeness: undefined
    });
  });

  it("will not confirm without a reason: the server refuses one", async () => {
    await mount(<ResolveResultDialog row={row()} open onOpenChange={() => {}} />);
    expect(findButton("Confirm result")?.disabled).toBe(true);
    await typeInto(byLabel("Reason"), "   ");
    expect(findButton("Confirm result")?.disabled).toBe(true);
    await typeInto(byLabel("Reason"), "why");
    expect(findButton("Confirm result")?.disabled).toBe(false);
  });

  it("writes a typed standing as one line per participation, slot 1 first", async () => {
    await mount(<ResolveResultDialog row={row()} open onOpenChange={() => {}} />);
    await act(async () => {
      findRadio("Enter the score manually").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await typeInto(byLabel("A"), "2");
    await typeInto(byLabel("B"), "0");
    await typeInto(byLabel("Reason"), "log review");
    await act(async () => {
      findButton("Confirm result")?.click();
    });
    expect(setEncounterResult).toHaveBeenCalledWith(10, {
      reason: "log review",
      results: [
        { encounter_team_id: 1, score: 2 },
        { encounter_team_id: 2, score: 0 }
      ],
      closeness: undefined
    });
  });

  it("cannot adopt a participation that filed nothing", async () => {
    await mount(
      <ResolveResultDialog row={row({ reports: [report(1, 2, 1)] })} open onOpenChange={() => {}} />
    );

    const second = findRadio("Adopt B report");
    expect(second.getAttribute("data-disabled")).not.toBeNull();

    await act(async () => {
      second.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Still on the first report, because the empty seat is not selectable.
    expect(findRadio("Adopt A report").getAttribute("aria-checked")).toBe("true");
  });

  it("refuses a draw on an elimination stage before sending it", async () => {
    // The finalizer 400s on this. Catching it client-side keeps the score in
    // front of the admin instead of bouncing them through a round trip.
    const drawn = row({
      stage_type: "single_elimination",
      reports: [report(1, 1, 1), report(2, 1, 1)],
      standings_match: true
    });
    const body = await mount(<ResolveResultDialog row={drawn} open onOpenChange={() => {}} />);
    await typeInto(byLabel("Reason"), "why");
    expect(body.textContent).toContain("elimination bracket needs a winner");
    expect(findButton("Confirm result")?.disabled).toBe(true);
  });

  it("allows a draw when the stage is not an elimination bracket", async () => {
    const drawn = row({
      stage_type: "round_robin",
      reports: [report(1, 1, 1), report(2, 1, 1)],
      standings_match: true
    });
    const body = await mount(<ResolveResultDialog row={drawn} open onOpenChange={() => {}} />);
    await typeInto(byLabel("Reason"), "why");
    expect(body.textContent).not.toContain("elimination bracket needs a winner");
    expect(findButton("Confirm result")?.disabled).toBe(false);
  });

  it("offers Reopen instead of Confirm once the result is confirmed", async () => {
    // The server refuses a second confirmation, so a disabled Confirm would be
    // a dead end.
    const body = await mount(
      <ResolveResultDialog row={row({ result_status: "confirmed" })} open onOpenChange={() => {}} />
    );
    expect(findButton("Confirm result")).toBeUndefined();
    expect(findButton("Reopen")).toBeDefined();
    expect(body.textContent).toContain("already confirmed");
  });

  it("puts reopening behind a reason and a confirmation step", async () => {
    // Reopening resets bracket progression; it must not be one stray click, and
    // the journal row it writes needs the organizer's reason.
    await mount(
      <ResolveResultDialog row={row({ result_status: "confirmed" })} open onOpenChange={() => {}} />
    );
    expect(findButton("Reopen")?.disabled).toBe(true);
    await typeInto(byLabel("Reason to reopen"), "wrong log was parsed");
    await act(async () => {
      findButton("Reopen")?.click();
    });
    expect(reopenEncounterResult).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Reopen this result?");
  });

  it("does not carry one encounter's reopen reason over to the next", async () => {
    // The reason is written verbatim into the audit journal: a stale one would
    // be filed against an encounter it was never typed for.
    function Switcher() {
      const [id, setId] = useState(10);
      return (
        <>
          <button type="button" id="next-row" onClick={() => setId(11)} />
          <ResolveResultDialog row={row({ id, result_status: "confirmed" })} open onOpenChange={() => {}} />
        </>
      );
    }
    await mount(<Switcher />);
    await typeInto(byLabel("Reason to reopen"), "wrong log was parsed");
    expect(findButton("Reopen")?.disabled).toBe(false);

    await act(async () => {
      document.getElementById("next-row")?.click();
    });
    expect(byLabel("Reason to reopen").value).toBe("");
    expect(findButton("Reopen")?.disabled).toBe(true);
  });

  it("says so when an encounter predates the audit trail", async () => {
    // An empty box reads as a failed fetch.
    await mount(<ResolveResultDialog row={row()} open onOpenChange={() => {}} />);
    await act(async () => {
      findButton("Change history")?.click();
    });
    // React Query settles across both microtasks and timers before committing.
    for (let turn = 0; turn < 5; turn += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(document.body.textContent).toContain("No recorded changes");
  });

  it("cannot submit when nobody reported and no score was typed", async () => {
    const empty = row({
      reports: [],
      reported_count: 0,
      standings_match: null,
      result_status: "none"
    });
    const body = await mount(<ResolveResultDialog row={empty} open onOpenChange={() => {}} />);
    await typeInto(byLabel("Reason"), "why");
    expect(body.textContent).toContain("No score selected yet");
    expect(findButton("Confirm result")?.disabled).toBe(true);
  });
});
