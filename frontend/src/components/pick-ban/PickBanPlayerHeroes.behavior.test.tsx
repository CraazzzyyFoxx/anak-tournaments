// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PickBanPlayerHeroes } from "@/components/pick-ban/PickBanPlayerHeroes";
import { encounterQueryKeys } from "@/lib/encounters/query-keys";
import { disciplineQueryKeys } from "@/lib/site/discipline-query-keys";
import { catalogEntity } from "@/test/catalog";
import type { DisciplineMetadata } from "@/types/discipline.types";
import type { MatchWithStats } from "@/types/encounter.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; client: QueryClient; container: HTMLDivElement }[] = [];
const metadata = {
  discipline: { code: "overwatch", capabilities: {} }
} as unknown as DisciplineMetadata;

function match(reverse: boolean): MatchWithStats {
  // Each registration id equals the OTHER player's global id. Member ids also
  // collide, so neither raw numeric equality nor names identify the target.
  const ana = catalogEntity({ id: 1, name: "Ana" });
  const baptiste = catalogEntity({ id: 2, name: "Baptiste" });
  const dva = catalogEntity({ id: 3, name: "D.Va" });
  const played = (team: number, member: number, rows: [number, number][]) =>
    rows.map(([segment, entity]) => ({
      encounter_team_id: team,
      workspace_member_id: member,
      entity_id: entity,
      segment,
      stat_code: "hero_time_played",
      value: 120
    }));
  const seats = [
    { id: 100, team: { players: [{ id: 17, user_id: 41 }] } },
    { id: 101, team: { players: [{ id: 41, user_id: 17 }] } }
  ];
  const members = [
    {
      encounter_team_id: 100,
      workspace_member_id: 17,
      player_id: 41,
      handle_snapshot: "Observed handle 0",
      observed_role: null
    },
    {
      encounter_team_id: 101,
      workspace_member_id: 41,
      player_id: 17,
      handle_snapshot: "Observed handle 1",
      observed_role: null
    }
  ];
  const facts = [
    ...played(100, 17, [
      [1, 1],
      [2, 1],
      [2, 2]
    ]),
    ...played(101, 41, [[1, 3]]),
    // A moment on another character is not "played".
    { ...played(101, 41, [[1, 1]])[0], value: 30 }
  ];
  if (reverse) {
    seats.reverse();
    members.reverse();
  }
  return {
    id: 77,
    workspace_id: 1,
    discipline: "overwatch",
    encounter: { teams: seats },
    statistics: { members, segments: [], facts, entities: [ana, baptiste, dva] }
  } as unknown as MatchWithStats;
}

async function mount(data: MatchWithStats, playerIds: number[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  client.setQueryData(encounterQueryKeys.matchDetail(data.id), data);
  client.setQueryData(disciplineQueryKeys.metadata(data.workspace_id, data.discipline), metadata);
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

const names = (container: HTMLElement, playerId: number) =>
  Array.from(
    container.querySelectorAll(`[data-player="${playerId}"] li > span:last-child`),
    (element) => element.textContent
  );

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
      await vi.waitFor(() => expect(names(container, 17)).toEqual(["Ana", "Baptiste"]));
      expect(names(container, 41)).toEqual(["D.Va"]);
    }
  );

  it("does not treat an unresolved registration id as an observed identity", async () => {
    const data = match(false);
    data.encounter!.teams[0].team = null;
    const container = await mount(data, [17, 999]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(container.querySelectorAll("section p")).toHaveLength(2);
  });
});
