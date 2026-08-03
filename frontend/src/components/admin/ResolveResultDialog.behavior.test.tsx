// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
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

function report(overrides: Partial<AdminCaptainReport> = {}): AdminCaptainReport {
  return {
    id: 1,
    encounter_id: 10,
    team_id: 1,
    side: "home",
    reporter_user_id: null,
    reporter_name: "cap",
    home_score: 2,
    away_score: 1,
    closeness: 6,
    map_codes: [],
    created_at: null,
    updated_at: null,
    ...overrides
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
    home_team: { id: 1, name: "A" },
    away_team: { id: 2, name: "B" },
    home_report: report(),
    away_report: report({ id: 2, team_id: 2, side: "away", home_score: 0, away_score: 2 }),
    reported_count: 2,
    scores_match: false,
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

describe("ResolveResultDialog", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setEncounterResult.mockReset().mockResolvedValue({});
    reopenEncounterResult.mockReset().mockResolvedValue({});
    getEncounterResultAudit.mockReset().mockResolvedValue([]);
  });

  it("previews the adopted report's score, not the encounter's", async () => {
    // The admin is choosing between two claims; the preview must show the claim
    // that will be recorded, or the choice is unverifiable before submitting.
    const body = await mount(
      <ResolveResultDialog row={row()} open onOpenChange={() => {}} />
    );
    expect(body.textContent).toContain("2 – 1");
  });

  it("adopts a side by team id rather than by copying its numbers", async () => {
    // The audit records which side was believed. Sending the bare score would
    // settle the encounter but lose why.
    await mount(<ResolveResultDialog row={row()} open onOpenChange={() => {}} />);
    await act(async () => {
      findButton("Confirm result")?.click();
    });
    expect(setEncounterResult).toHaveBeenCalledWith(10, {
      adopt_report_team_id: 1,
      closeness: undefined
    });
  });

  it("refuses a draw on an elimination stage before sending it", async () => {
    // The finalizer 400s on this. Catching it client-side keeps the score in
    // front of the admin instead of bouncing them through a round trip.
    const drawn = row({
      stage_type: "single_elimination",
      home_report: report({ home_score: 1, away_score: 1 }),
      away_report: report({ id: 2, team_id: 2, side: "away", home_score: 1, away_score: 1 }),
      scores_match: true
    });
    const body = await mount(<ResolveResultDialog row={drawn} open onOpenChange={() => {}} />);
    expect(body.textContent).toContain("elimination bracket needs a winner");
    expect(findButton("Confirm result")?.disabled).toBe(true);
  });

  it("allows a draw when the stage is not an elimination bracket", async () => {
    const drawn = row({
      stage_type: "round_robin",
      home_report: report({ home_score: 1, away_score: 1 }),
      away_report: report({ id: 2, team_id: 2, side: "away", home_score: 1, away_score: 1 }),
      scores_match: true
    });
    const body = await mount(<ResolveResultDialog row={drawn} open onOpenChange={() => {}} />);
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

  it("puts reopening behind a confirmation step", async () => {
    // Reopening resets bracket progression; it must not be one stray click.
    await mount(
      <ResolveResultDialog row={row({ result_status: "confirmed" })} open onOpenChange={() => {}} />
    );
    await act(async () => {
      findButton("Reopen")?.click();
    });
    expect(reopenEncounterResult).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Reopen this result?");
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

  it("cannot submit when neither side reported and no score was typed", async () => {
    const empty = row({
      home_report: null,
      away_report: null,
      reported_count: 0,
      scores_match: null,
      result_status: "none"
    });
    const body = await mount(<ResolveResultDialog row={empty} open onOpenChange={() => {}} />);
    expect(body.textContent).toContain("No score selected yet");
    expect(findButton("Confirm result")?.disabled).toBe(true);
  });
});
