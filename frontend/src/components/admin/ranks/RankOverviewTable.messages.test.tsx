// @vitest-environment happy-dom
//
// The native-ladder layer is named by its game through an ICU variable (`layers.ow` = "{game}"). The behavior
// suite mocks translations as key echoes, which cannot see a consumer that forgets the variable — so this one runs
// the table against the REAL bundles and reads the text a person would.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RankOverviewTable } from "@/components/admin/ranks/RankOverviewTable";
import en from "@/i18n/messages/en.json";
import ru from "@/i18n/messages/ru.json";
import type { RankOverviewRow } from "@/services/workspace-player.service";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/ranks",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search)
}));

vi.mock("@/hooks/useCurrentWorkspace", () => ({
  useDivisionGrid: () => ({
    tiers: [{ number: 1, name: "Bronze", rank_min: 500, rank_max: null, icon_url: "" }]
  })
}));

vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (selector: (state: { currentWorkspaceId: number }) => unknown) =>
    selector({ currentWorkspaceId: 7 })
}));

vi.mock("@/hooks/useGameScope", async () => {
  const { gameScopeStub } = await import("@/test/game-scope");
  return { useGameScope: () => gameScopeStub({ kind: "game", code: "overwatch", source: "default" }, { axis: 7 }) };
});
vi.mock("@/hooks/useDisciplineMetadata", async () => {
  const { OW_METADATA } = await import("@/test/discipline-metadata");
  return {
    useDisciplineMetadata: () => ({ data: OW_METADATA, isError: false, refetch: vi.fn() }),
    useDisciplines: () => ({ data: [OW_METADATA.discipline], isError: false, refetch: vi.fn() })
  };
});

vi.mock("@/services/workspace-player.service", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    workspacePlayerService: {
      listRanks: async () => ({
        page: 1,
        per_page: 30,
        total: 1,
        results: [
          {
            layer: "ow",
            discipline: "overwatch",
            player_id: 42,
            member_id: 9,
            display_name: "Alice",
            identity: { provider: "battlenet", handle: "Alice#2100" },
            author_user_id: null,
            author_name: null,
            role: "tank",
            rank_value: 3100,
            division: 1,
            source: "native",
            sigma: null,
            delta: null,
            canon_diff: null,
            ow_division: null,
            ow_tier: null,
            context: null,
            at: "2026-01-02T03:04:05Z"
          } satisfies RankOverviewRow
        ]
      }),
      listAuthors: async () => ({ authors: [] })
    }
  };
});

let container: HTMLElement;
let root: Root;

async function render(locale: "en" | "ru", messages: typeof en) {
  window.history.replaceState(null, "", "/admin/ranks");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <QueryClientProvider client={client}>
          <RankOverviewTable />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  await act(async () => {
    const settled = Promise.withResolvers<void>();
    setTimeout(settled.resolve, 0);
    await settled.promise;
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("rank overview table with the real bundles", () => {
  it.each([
    ["en", en],
    ["ru", ru]
  ] as const)("names the native-ladder layer and source by the game in %s", async (locale, messages) => {
    await render(locale, messages as typeof en);

    const text = container.textContent ?? "";
    // The game's own name, never the bundle key or an unresolved placeholder.
    expect(text).toContain("Overwatch");
    expect(text).not.toContain("{game}");
    expect(text).not.toContain("layers.ow");
    expect(text).not.toContain("sources.native");
  });
});
