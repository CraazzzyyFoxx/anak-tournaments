import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateMetadata } from "./page";

const { getMatch } = vi.hoisted(() => ({ getMatch: vi.fn() }));

vi.mock("@/services/encounter.service", () => ({ default: { getMatch } }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (_key: string, values: Record<string, unknown>) =>
    `${values.home} vs ${values.away}`
}));

beforeEach(() => getMatch.mockReset());

describe("match page metadata", () => {
  it("names the participations by their snapshots, in seat order, after the source teams are gone", async () => {
    getMatch.mockResolvedValue({
      map: null,
      participants: [
        {
          encounter_team_id: 2,
          slot: 2,
          name: "Archived B",
          tournament_team_id: null,
          team_facts: {}
        },
        {
          encounter_team_id: 1,
          slot: 1,
          name: "Archived A",
          tournament_team_id: null,
          team_facts: {}
        }
      ]
    });
    const metadata = await generateMetadata({ params: Promise.resolve({ id: 7 }) });
    expect(metadata.title).toContain("Archived A vs Archived B");
    expect(metadata.description).toBe("Archived A vs Archived B");
  });
});
