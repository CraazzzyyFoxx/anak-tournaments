import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OW_METADATA } from "@/test/discipline-metadata";
import type { TournamentHistoryEntry } from "@/types/registration.types";

import TournamentHistoryCell from "./TournamentHistoryCell";

// Radix mounts tooltip content only while open; the history list is what is under test.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>
}));

const messages = {
  common: { roles: { flex: "Flex" }, roleOntology: { unknown: "Unknown role: {role}", retired: "Retired role: {role}" }, divisionWithId: "Division {id}", more: "more" },
  tournamentDetail: { newBadge: "New", previousTournaments: "{count} previous" }
};

/** The viewed game's dictionary plus one workspace child of `damage` with its own name and artwork. */
const ontology = {
  ...OW_METADATA,
  workspace_id: 7,
  roles: [
    ...OW_METADATA.roles,
    {
      id: 20,
      dimension: "player_role",
      code: "damage_hitscan",
      name: "Hitscan",
      parent_id: 2,
      workspace_id: 7,
      active: true,
      selectable: true,
      sort_order: 20,
      attrs: { icon: "/test-roles/hitscan.svg" }
    }
  ]
};

function render(role: TournamentHistoryEntry["role"], dictionary: typeof ontology | null) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TournamentHistoryCell
        history={[{ tournament_id: 1, tournament_name: "Autumn Cup", role, division: null }]}
        ontology={dictionary}
      />
    </NextIntlClientProvider>
  );
}

describe("TournamentHistoryCell", () => {
  it("names and draws the exact historical leaf, not its parent", () => {
    const markup = render({ dimension: "player_role", role: "damage_hitscan", parent: "damage" }, ontology);

    expect(markup).toContain("Hitscan");
    expect(markup).toContain("/test-roles/hitscan.svg");
    // The parent's own name and artwork are not what this participation was played as.
    expect(markup).not.toContain(">Damage<");
    expect(markup).not.toContain("/test-roles/damage.svg");
  });

  it("still resolves a plain root assignment through the dictionary", () => {
    const markup = render({ dimension: "player_role", role: "damage" }, ontology);

    expect(markup).toContain(">Damage<");
    expect(markup).toContain("/test-roles/damage.svg");
  });

  it("keeps a leaf the dictionary does not know visibly unknown, by its own code", () => {
    const markup = render({ dimension: "position", role: "mid" }, ontology);

    expect(markup).toContain(">mid<");
    expect(markup).toContain("Unknown role: mid");
  });
});
