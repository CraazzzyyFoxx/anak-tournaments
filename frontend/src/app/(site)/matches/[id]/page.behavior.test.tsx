import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import EncounterPage, { generateMetadata } from "./page";

const { getMatch } = vi.hoisted(() => ({ getMatch: vi.fn() }));

vi.mock("@/services/encounter.service", () => ({ default: { getMatch } }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    values ? `${values.home} vs ${values.away}` : key
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

describe("match page header", () => {
  const render = async (parent: { name: string; image_path: string | null } | null) => {
    getMatch.mockResolvedValue({
      workspace_id: 1,
      discipline: "lol",
      map: { id: 5, name: "Howling Abyss", image_path: "/maps/abyss.png", parent },
      map_index: 1,
      duration_s: 1800,
      log_name: null,
      raw_status: null,
      raw_available: false,
      encounter: null,
      participants: [
        { encounter_team_id: 1, slot: 1, name: "Blue", tournament_team_id: null, team_facts: {} },
        { encounter_team_id: 2, slot: 2, name: "Red", tournament_team_id: null, team_facts: {} }
      ]
    });
    const page = await EncounterPage({ params: Promise.resolve({ id: 3 }) });
    return renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{page}</QueryClientProvider>);
  };

  it("shows a map without a mode by its name and paints no image for the missing mode", async () => {
    const html = await render(null);

    expect(html).toContain("Howling Abyss");
    // Neither team has a logo, so any image here would be the mode badge with nothing to show.
    expect(html).not.toContain("<img");
  });

  it("paints no image for a mode that has none", async () => {
    expect(await render({ name: "Escort", image_path: null })).not.toContain("<img");
  });

  it("badges the map with its mode's image", async () => {
    expect(await render({ name: "Escort", image_path: "/modes/escort.png" })).toContain('alt="Escort"');
  });
});
