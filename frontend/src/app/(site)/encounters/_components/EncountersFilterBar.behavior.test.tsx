// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { ScopePill } from "@/components/workspace/ScopePill";
import { useScopePillOpen } from "@/components/workspace/scope-pill-store";
import { navigation } from "@/test/url-navigation";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type { DisciplineDescriptor } from "@/types/discipline.types";
import type { Workspace } from "@/types/workspace.types";

import { DEFAULT_FILTERS, EMPTY_OVERVIEW } from "./encounters.helpers";
import { EncountersFilterBar } from "./EncountersFilterBar";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

// `vi.mock` factories run before the file's static imports exist, hence the import inside.
vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("next/link", () => ({
  default: ({ prefetch: _prefetch, ...rest }: ComponentProps<"a"> & { prefetch?: boolean | null }) => <a {...rest} />
}));
vi.mock("@/services/discipline.service", () => ({ default: { list: mocks.list } }));

const GAMES = [
  { code: "overwatch", name: "Overwatch", short_name: "OW", icon: null, enabled: true },
  { code: "lol", name: "League of Legends", short_name: "LoL", icon: null, enabled: true }
] as DisciplineDescriptor[];

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  navigation.reset("/encounters");
  mocks.list.mockReset().mockResolvedValue(GAMES);
  useScopePillOpen.setState({ open: false, gameBoundParams: [] });
  useWorkspaceStore.setState({
    workspaces: [
      { id: 1, slug: "w1", name: "Both Games", icon_url: null, disciplines_enabled: ["overwatch", "lol"] } as Workspace
    ],
    currentWorkspaceId: 1,
    statsScope: "all",
    hostLockedWorkspaceId: null,
    entityWorkspaceId: null,
    entityDiscipline: null,
    gameScope: "all",
    lastGame: null,
    fetchWorkspaces: async () => undefined
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
});

/** The filter bar beside the site's scope pill, as the page shows them. */
async function mount(gameBound: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <QueryClientProvider client={client}>
          <ScopePill variant="site" />
          <EncountersFilterBar
            filters={DEFAULT_FILTERS}
            searchValue=""
            kpis={EMPTY_OVERVIEW.kpis}
            tournaments={[{ id: 11, name: "OW Cup" }]}
            gameBound={gameBound}
            onSearchChange={vi.fn()}
            onPatch={vi.fn()}
          />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  await act(() => new Promise<void>((done) => setTimeout(done, 0)));
}

const tournamentPicker = () => container.querySelector(`[aria-label="${en.common.tournament}"]`);
const hint = () =>
  [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === en.common.discipline.filterHint);

describe("the encounters filter bar's game-bound filters", () => {
  it("under every game gives the tournament picker's place to a hint that opens the scope pill", async () => {
    await mount(false);
    expect(tournamentPicker()).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => hint()?.click());

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("under one game offers the tournament picker and no hint", async () => {
    await mount(true);
    expect(tournamentPicker()?.textContent).toBe(en.encounters.filter.tournamentAny);
    expect(hint()).toBeUndefined();
  });
});
