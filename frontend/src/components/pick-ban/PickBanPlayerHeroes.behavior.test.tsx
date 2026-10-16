// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import { PickBanPlayerHeroes } from "@/components/pick-ban/PickBanPlayerHeroes";
import { encounterQueryKeys } from "@/lib/encounters/query-keys";
import type { MatchParticipationWithStats, MatchWithStats } from "@/types/encounter.types";
import type { Hero } from "@/types/hero.types";
import type { Team } from "@/types/team.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const createdAt = new Date("2026-10-01T00:00:00Z");
const mounted: { root: Root; client: QueryClient; container: HTMLDivElement }[] = [];

function hero(id: number, name: string): Hero {
  return {
    id,
    created_at: createdAt,
    updated_at: null,
    name,
    slug: name.toLowerCase(),
    image_path: "",
    role: "support",
    color: "#ffffff",
    aliases: []
  };
}

function team(id: number, registrationId: number, userId: number): Team {
  return {
    id,
    created_at: createdAt,
    updated_at: null,
    name: `Team ${id}`,
    image_url: null,
    avg_sr: 2000,
    total_sr: 2000,
    captain_id: userId,
    tournament_id: 1,
    players: [
      {
        id: registrationId,
        created_at: createdAt,
        updated_at: null,
        name: "Shared roster name",
        rank: 2000,
        division: 1,
        role: null,
        tournament_id: 1,
        user_id: userId,
        team_id: id,
        is_newcomer: false,
        is_newcomer_role: false,
        is_substitution: false,
        related_player_id: null,
        user: null
      }
    ],
    tournament: null,
    placement: null,
    group: null
  };
}

function match(reverse: boolean): MatchWithStats {
  // Each registration id equals the OTHER player's global id. Member ids also
  // collide, so neither raw numeric equality nor names identify the target.
  const teams = [team(1, 17, 41), team(2, 41, 17)];
  const ana = hero(1, "Ana");
  const participations: MatchParticipationWithStats[] = teams.map((source, index) => ({
    id: 100 + index,
    slot: index + 1,
    team_id: source.id,
    name: source.name,
    seed: null,
    score: 0,
    placement: null,
    active: true,
    players: [
      {
        workspace_member_id: index === 0 ? 17 : 41,
        user_id: index === 0 ? 41 : 17,
        name: `Observed handle ${index}`,
        stats: {},
        heroes: index === 0 ? { 1: [ana], 2: [ana, hero(2, "Baptiste")] } : { 1: [hero(3, "D.Va")] }
      }
    ]
  }));
  if (reverse) {
    teams.reverse();
    participations.reverse();
  }
  return {
    id: 77,
    created_at: createdAt,
    updated_at: null,
    home_team_id: teams[0].id,
    away_team_id: teams[1].id,
    score: { home: 0, away: 0 },
    time: 300,
    encounter_id: 9,
    map_id: 4,
    map_index: 1,
    log_name: "previous-map.txt",
    raw_status: "available",
    raw_available: true,
    map: null,
    home_participation: participations[0],
    away_participation: participations[1],
    home_team: teams[0],
    away_team: teams[1],
    encounter: null,
    rounds: 2
  };
}

async function mount(data: MatchWithStats, playerIds: number[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  client.setQueryData(encounterQueryKeys.matchDetail(data.id), data);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, client, container });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        {playerIds.map((playerId) => (
          <section key={playerId} data-player={playerId}>
            <PickBanPlayerHeroes playerId={playerId} matchId={data.id} />
          </section>
        ))}
      </QueryClientProvider>
    );
  });
  return container;
}

afterEach(async () => {
  for (const { root, client, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});

describe("PickBanPlayerHeroes", () => {
  it.each([false, true])(
    "resolves registrations before reading observed heroes (reversed: %s)",
    async (reverse) => {
      const container = await mount(match(reverse), [17, 41]);
      expect(
        Array.from(
          container.querySelectorAll('[data-player="17"] li > span:last-child'),
          (element) => element.textContent
        )
      ).toEqual(["Ana", "Baptiste"]);
      expect(
        Array.from(
          container.querySelectorAll('[data-player="41"] li > span:last-child'),
          (element) => element.textContent
        )
      ).toEqual(["D.Va"]);
    }
  );

  it("does not treat an unresolved registration id as an observed identity", async () => {
    const data = match(false);
    data.home_team = null;
    data.home_team_id = null;
    const container = await mount(data, [17, 999]);
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(container.querySelectorAll("section p")).toHaveLength(2);
  });
});
