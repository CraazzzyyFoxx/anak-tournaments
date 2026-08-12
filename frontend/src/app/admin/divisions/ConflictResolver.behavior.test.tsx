import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DivisionGridReadinessSource, DivisionTier } from "@/types/workspace.types";

import { DivisionGridConflictResolver } from "./ConflictResolver";

const targetTiers: DivisionTier[] = [
  { id: 11, slug: "bronze", number: 1, name: "Bronze", rank_min: 1000, rank_max: 1099, icon_url: "/b.png" },
  { id: 12, slug: "silver", number: 2, name: "Silver", rank_min: 1100, rank_max: 1199, icon_url: "/s.png" }
];

const sources: DivisionGridReadinessSource[] = [
  {
    version_id: 100,
    version_label: "v1",
    grid_name: "Ladder",
    tournament_count: 2,
    tournament_names: ["Cup A", "Cup B"],
    status: "incomplete",
    conflict_tiers: [{ source_tier_id: 101, slug: "old", name: "Old Tier" }]
  }
];

function render(canEdit: boolean) {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <DivisionGridConflictResolver
        workspaceId={9}
        targetVersionId={200}
        targetTiers={targetTiers}
        sources={sources}
        canEdit={canEdit}
        onResolved={() => {}}
      />
    </QueryClientProvider>
  );
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}

describe("DivisionGridConflictResolver", () => {
  it("lists each unmatched source tier and its origin", () => {
    const doc = render(true);
    expect(doc.body.textContent).toContain("Old Tier");
    expect(doc.body.textContent).toContain("Ladder");
    expect(doc.body.textContent).toContain("0/1 resolved");
  });

  it("keeps activation disabled until every conflict is resolved", () => {
    const doc = render(true);
    const button = Array.from(doc.querySelectorAll("button")).find((element) =>
      element.textContent?.includes("Resolve")
    );
    expect(button?.hasAttribute("disabled")).toBe(true);
  });
});
