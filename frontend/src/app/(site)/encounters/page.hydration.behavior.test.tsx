// @vitest-environment happy-dom
//
// `/encounters` streams in under the site layout, and by the time its rows hydrate the scope pill may have read the
// installed games in the browser. Under every game of a numbered community that runs both games each row names its
// game: the server's markup of the page, inside its layout, hydrates into such a browser without a mismatch.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

import messages from "@/i18n/messages/en.json";
import { disciplineQueryKeys } from "@/lib/site/discipline-query-keys";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { LOL_METADATA, OW_METADATA } from "@/test/discipline-metadata";
import { resolveServer } from "@/test/resolve-server";
import { navigation } from "@/test/url-navigation";
import type { Encounter } from "@/types/encounter.types";

import SiteLayout from "../layout";
import EncountersPage from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { page } = vi.hoisted(() => {
  const encounter = (id: number, discipline: string) =>
    ({
      id,
      discipline,
      workspace_id: 7,
      name: `Match ${id}`,
      slot_count: 2,
      scoring_preset: "wins",
      round: 1,
      best_of: 3,
      tournament_id: id,
      stage_id: null,
      stage_item_id: null,
      challonge_id: null,
      status: "completed",
      closeness: null,
      has_logs: false,
      result_status: "none",
      result_source: null,
      result_version: 0,
      scheduled_at: null,
      started_at: null,
      ended_at: null,
      current_map_index: null,
      confirmed_at: null,
      // One row stamped, one left to its tournament's dates: both hydrate.
      played_at: id === 1 ? "2026-05-01T12:00:00Z" : null,
      is_live: false,
      created_at: null,
      updated_at: null,
      matches: [],
      teams: [],
      tournament: { id, name: `Cup ${id}`, start_date: "2019-06-01T00:00:00Z", end_date: "2019-06-08T00:00:00Z" },
      stage: null,
      stage_item: null
    }) as unknown as Encounter;
  return { page: { page: 1, per_page: 15, total: 2, results: [encounter(1, "overwatch"), encounter(2, "lol")] } };
});

// `vi.mock` factories run before this file's imports, so the modules they hand out are loaded inside them.
vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => createTranslator({ locale: "en", messages }) }));
// A visitor with no saved game, in community 7, which runs both games.
vi.mock("@/lib/site/tenant-host", () => ({
  resolveStatsScope: async () => "workspace",
  resolveServerDisciplineScope: async () => ({ stored: "all", lastGame: null, axis: 7, hostLockedWorkspaceId: null })
}));
vi.mock("@/services/discipline.service", async () => (await import("@/test/discipline-metadata")).disciplineServiceMock);
vi.mock("@/services/encounter.service", async () => {
  const { EMPTY_OVERVIEW } = await import("./_components/encounters.helpers");
  return {
    default: { getAll: async () => page, getOverview: async () => EMPTY_OVERVIEW, getSavedViews: async () => [] }
  };
});
// The layout's chrome has its own suites.
vi.mock("@/components/Header", () => ({ default: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/notifications/FloatStack", () => ({ FloatStack: () => null }));
vi.mock("@/services/notification.service", () => ({ default: { activeAnnouncements: async () => [] } }));
vi.mock("@/i18n/ZoneIntlProvider", () => ({ default: ({ children }: { children: ReactNode }) => children }));
// The filter bar has its own suite; its select triggers' `[&>span]` classes also come back from happy-dom's HTML
// parser as `[&&gt;span]`, a mismatch no browser makes.
vi.mock("./_components/EncountersFilterBar", () => ({ EncountersFilterBar: () => null }));

let hydrated: Root | undefined;
let host: HTMLElement | undefined;

afterEach(async () => {
  await act(async () => hydrated?.unmount());
  host?.remove();
  hydrated = host = undefined;
});

async function settle(turns = 8) {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

it("names each row's game on the server, and hydrates the rows where the scope pill has read the games", async () => {
  navigation.reset("/encounters");
  useWorkspaceStore.setState({
    currentWorkspaceId: 7,
    statsScope: "workspace",
    hostLockedWorkspaceId: null,
    gameScope: "all",
    lastGame: null
  });
  const tree = await resolveServer(
    <SiteLayout>
      <EncountersPage searchParams={Promise.resolve({})} />
    </SiteLayout>
  );
  const withClient = (queryClient: QueryClient) => (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>
    </NextIntlClientProvider>
  );
  const html = renderToString(withClient(new QueryClient()));

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(disciplineQueryKeys.list("all"), [OW_METADATA.discipline, LOL_METADATA.discipline]);
  host = document.body.appendChild(document.createElement("div"));
  host.innerHTML = html;
  const recoverable: unknown[] = [];
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () => {
    hydrated = hydrateRoot(host as HTMLElement, withClient(client), {
      onRecoverableError: (error) => void recoverable.push(error)
    });
  });
  await settle();
  const mismatches = errors.mock.calls.filter((call) => String(call[0]).toLowerCase().includes("hydrat"));
  errors.mockRestore();

  expect(recoverable.map(String)).toEqual([]);
  expect(mismatches).toEqual([]);
  expect(html).toContain(">Overwatch<");
  expect(html).toContain(">League of Legends<");
});
