// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { AdminReportPairCell } from "@/components/admin/AdminReportPairCell";
import type { AdminCaptainReport, EncounterParticipationRef } from "@/types/admin.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return container;
}

// Deliberately out of slot order: the cell reads by slot, not by wire order.
const PARTICIPATIONS: EncounterParticipationRef[] = [
  { encounter_team_id: 2, slot: 2, team_id: 22, name: "Beta" },
  { encounter_team_id: 1, slot: 1, team_id: 11, name: "Alpha" }
];

/** A report by participation `by`, claiming `one` – `two` (slot 1 – slot 2). */
function report(
  by: 1 | 2,
  one: number,
  two: number,
  overrides: Partial<AdminCaptainReport> = {}
): AdminCaptainReport {
  return {
    id: by,
    encounter_id: 10,
    encounter_team_id: by,
    reporter_user_id: 5,
    reporter_name: "captain",
    games_played: one + two,
    basis_version: 1,
    results: [
      { encounter_team_id: 1, score: one, placement: null, wins: one },
      { encounter_team_id: 2, score: two, placement: null, wins: two }
    ],
    closeness: 7,
    comment: null,
    custom_fields: {},
    created_at: null,
    updated_at: null,
    ...overrides
  };
}

function cell(
  reports: AdminCaptainReport[],
  standingsMatch: boolean | null,
  seriesScoreValid = true
) {
  return (
    <AdminReportPairCell
      participations={PARTICIPATIONS}
      reports={reports}
      standingsMatch={standingsMatch}
      seriesScoreValid={seriesScoreValid}
    />
  );
}

describe("AdminReportPairCell", () => {
  it("names each seat by its team, slot 1 first, and shows its claimed standing", async () => {
    const container = await mount(cell([report(1, 2, 1)], null));
    const labels = Array.from(container.querySelectorAll("p"))
      .map((p) => p.textContent)
      .filter((text) => text === "Alpha" || text === "Beta");
    expect(labels).toEqual(["Alpha", "Beta"]);
    expect(container.textContent).toContain("2 – 1");
    expect(container.textContent).not.toMatch(/home|away/i);
  });

  it("says a seat has not reported instead of leaving the slot blank", async () => {
    // An empty cell reads as a rendering bug; the admin needs to know the slot
    // is genuinely empty.
    const container = await mount(cell([report(1, 2, 1)], null));
    expect(container.textContent).toContain("no report");
  });

  it("raises only a disagreement, never an awaited report", async () => {
    // One captain outstanding is a reminder the seats already show; two
    // divergent reports are an adjudication. Only the latter gets the pill.
    const awaiting = await mount(cell([report(1, 2, 1)], null));
    expect(awaiting.textContent).not.toContain("Awaiting remaining reports");
    expect(awaiting.textContent).not.toContain("disagree");

    const disagree = await mount(cell([report(1, 2, 1), report(2, 0, 2)], false));
    expect(disagree.textContent).toContain("Reports disagree");
  });

  it("says nothing extra when the reports agree", async () => {
    // The agreeing standings are right there in the cell; a pill would repeat them.
    const container = await mount(cell([report(1, 2, 1), report(2, 2, 1)], true));
    expect(container.textContent).not.toContain("Reports agree");
    expect(container.textContent).not.toContain("disagree");
  });

  it("flags an impossible series score where the caller asks for it", async () => {
    // Advisory only — reports predate per-round best-of, so this is a hint
    // rather than a verdict.
    const container = await mount(cell([report(1, 3, 0), report(2, 3, 0)], true, false));
    expect(container.textContent).toContain("Score outside best-of");
  });

  it("omits the best-of warning when the score is possible", async () => {
    const container = await mount(cell([report(1, 2, 1), report(2, 2, 1)], true));
    expect(container.textContent).not.toContain("Score outside best-of");
  });

  it("shows each captain's comment so a dispute can be read, not guessed", async () => {
    const long = "We had a disconnect on the second map and replayed the last round. ".repeat(4);
    const container = await mount(
      cell(
        [
          report(1, 2, 1, { comment: "Opponents were late by 15 minutes" }),
          report(2, 2, 1, { comment: long })
        ],
        true
      )
    );
    expect(container.textContent).toContain("Opponents were late by 15 minutes");
    // Clamped in the cell, but the full text stays reachable rather than lost.
    const titles = Array.from(container.querySelectorAll("p"))
      .filter((p) => p.className.includes("line-clamp"))
      .map((p) => p.getAttribute("title"));
    expect(titles).toEqual(["Opponents were late by 15 minutes", long]);
  });

  it("renders a report with no match quality without printing null or NaN", async () => {
    // Match quality is configurable per tournament, so an unrated report is
    // valid data — not a hole to render as "null/10".
    const container = await mount(cell([report(1, 2, 1, { closeness: null })], null));
    expect(container.textContent).toContain("captain");
    expect(container.textContent).not.toContain("/10");
    expect(container.textContent).not.toContain("null");
    expect(container.textContent).not.toContain("NaN");
  });
});
