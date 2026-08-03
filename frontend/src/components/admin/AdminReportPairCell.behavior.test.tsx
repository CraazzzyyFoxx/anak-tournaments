// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { AdminReportPairCell } from "@/components/admin/AdminReportPairCell";
import type { AdminCaptainReport } from "@/types/admin.types";

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

function report(overrides: Partial<AdminCaptainReport> = {}): AdminCaptainReport {
  return {
    id: 1,
    encounter_id: 10,
    team_id: 1,
    side: "home",
    reporter_user_id: 5,
    reporter_name: "captain",
    home_score: 2,
    away_score: 1,
    closeness: 7,
    map_codes: [],
    created_at: null,
    updated_at: null,
    ...overrides
  };
}

describe("AdminReportPairCell", () => {
  it("says a side has not reported instead of leaving the slot blank", async () => {
    // An empty cell reads as a rendering bug; the admin needs to know the slot
    // is genuinely empty.
    const container = await mount(
      <AdminReportPairCell
        homeReport={report()}
        awayReport={null}
        scoresMatch={null}
        seriesScoreValid
      />
    );
    expect(container.textContent).toContain("no report");
  });

  it("distinguishes awaiting from disagreeing", async () => {
    // The whole point of the three-valued flag: one captain outstanding is a
    // reminder, two divergent reports are an adjudication. Collapsing them
    // would send an admin to settle a dispute that does not exist.
    const awaiting = await mount(
      <AdminReportPairCell
        homeReport={report()}
        awayReport={null}
        scoresMatch={null}
        seriesScoreValid
      />
    );
    expect(awaiting.textContent).toContain("Awaiting second report");
    expect(awaiting.textContent).not.toContain("disagree");

    const disagree = await mount(
      <AdminReportPairCell
        homeReport={report()}
        awayReport={report({ id: 2, team_id: 2, side: "away", home_score: 0, away_score: 2 })}
        scoresMatch={false}
        seriesScoreValid
      />
    );
    expect(disagree.textContent).toContain("Reports disagree");
    expect(disagree.textContent).not.toContain("Awaiting");
  });

  it("marks agreement explicitly", async () => {
    const container = await mount(
      <AdminReportPairCell
        homeReport={report()}
        awayReport={report({ id: 2, team_id: 2, side: "away" })}
        scoresMatch
        seriesScoreValid
      />
    );
    expect(container.textContent).toContain("Reports agree");
  });

  it("never encodes the verdict in colour alone", async () => {
    // Accessibility floor: the state must survive greyscale and a screen
    // reader, so each verdict carries a word and an icon, not just a tone class.
    for (const [scoresMatch, expected] of [
      [null, "Awaiting second report"],
      [true, "Reports agree"],
      [false, "Reports disagree"]
    ] as const) {
      const container = await mount(
        <AdminReportPairCell
          homeReport={report()}
          awayReport={scoresMatch === null ? null : report({ id: 2, team_id: 2, side: "away" })}
          scoresMatch={scoresMatch}
          seriesScoreValid
        />
      );
      expect(container.textContent).toContain(expected);
      expect(container.querySelector("svg")).not.toBeNull();
    }
  });

  it("flags an impossible series score without calling the row invalid", async () => {
    // Advisory only — reports predate per-round best-of, so this is a hint that
    // sits beside the verdict rather than replacing it.
    const container = await mount(
      <AdminReportPairCell
        homeReport={report({ home_score: 3, away_score: 0 })}
        awayReport={report({ id: 2, team_id: 2, side: "away", home_score: 3, away_score: 0 })}
        scoresMatch
        seriesScoreValid={false}
      />
    );
    expect(container.textContent).toContain("Score outside best-of");
    expect(container.textContent).toContain("Reports agree");
  });

  it("omits the best-of warning when the score is possible", async () => {
    const container = await mount(
      <AdminReportPairCell
        homeReport={report()}
        awayReport={report({ id: 2, team_id: 2, side: "away" })}
        scoresMatch
        seriesScoreValid
      />
    );
    expect(container.textContent).not.toContain("Score outside best-of");
  });
});
