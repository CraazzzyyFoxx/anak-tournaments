// @vitest-environment happy-dom
//
// The history's dossier reads an event's run lazily, once: going back to an event already opened reads nothing.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type { TournamentGroup } from "@/app/(site)/users/components/tournaments/tournaments-history.helpers";
import type { UserTournament } from "@/types/user.types";

import TournamentsHistory from "./TournamentsHistory";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { getUserTournamentEncounters } = vi.hoisted(() => ({
  getUserTournamentEncounters: vi.fn(async (_userId: number, tournamentId: number) =>
    Array.from({ length: tournamentId }, (_, index) => ({ id: index }))
  )
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/services/user.service", () => ({ default: { getUserTournamentEncounters } }));
vi.mock("@/hooks/useDisciplineMetadata", () => ({
  useDisciplineMetadata: () => ({ data: undefined, isError: false, refetch: vi.fn() })
}));
vi.mock("@/app/(site)/users/components/tournaments/TournamentsPlacementTimeline", () => ({ default: () => null }));
// The dossier as what it is handed: the selected event and its run, or the loading state.
vi.mock("@/app/(site)/users/components/tournaments/TournamentDossier", () => ({
  default: ({ group, loadingEncounters }: { group: TournamentGroup | null; loadingEncounters: boolean }) => {
    const event = group as UserTournament | null;
    return <output>{loadingEncounters ? "loading" : `${event?.name}: ${event?.encounters?.length} encounters`}</output>;
  }
}));

const tournaments = [3, 2].map(
  (id) =>
    ({
      id,
      name: `Cup ${id}`,
      workspace_id: 1,
      discipline: "overwatch",
      is_league: false,
      team: "T",
      placement: 1,
      count_teams: 8,
      won: 1,
      lost: 0,
      draw: 0,
      maps_won: 2,
      maps_lost: 0,
      role: null
    }) as unknown as UserTournament
);

let container: HTMLDivElement;
let root: Root;

const settle = () =>
  act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
const dossier = () => container.querySelector("output")?.textContent;
const select = async (name: string) => {
  const row = [...container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find((node) =>
    node.textContent?.includes(name)
  );
  expect(row).toBeDefined();
  await act(async () => row!.click());
  await settle();
};

beforeEach(() => {
  getUserTournamentEncounters.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("reads each event's run once, so going back to an event reads nothing", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <TournamentsHistory tournaments={tournaments} selfUserId={7} tournamentsWon={2} />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  await settle();
  expect(dossier()).toBe("Cup 3: 3 encounters");

  await select("Cup 2");
  expect(dossier()).toBe("Cup 2: 2 encounters");

  await select("Cup 3");
  expect(dossier()).toBe("Cup 3: 3 encounters");
  expect(getUserTournamentEncounters.mock.calls).toEqual([
    [7, 3],
    [7, 2]
  ]);
});
