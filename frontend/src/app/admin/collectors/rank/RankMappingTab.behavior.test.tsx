// @vitest-environment happy-dom
//
// The collector's mapping tab is a platform surface (spec §3.7): its tabs list only the games that declare the
// collector's capability, and a game outside them is named, never replaced by another game's panel.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/messages/en.json";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { navigation } from "@/test/url-navigation";

import { RankMappingTab } from "./RankMappingTab";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
// Both installed games collect native ranks (the shared fixture's capabilities).
vi.mock("@/services/discipline.service", async () => (await import("@/test/discipline-metadata")).disciplineServiceMock);
vi.mock("@/disciplines/DisciplineWidget", () => ({
  DisciplineWidget: ({ discipline }: { discipline: string }) => <div data-widget={discipline} />
}));

let root: Root;
let container: HTMLDivElement;

async function mount(url: string) {
  navigation.reset(url);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <RankMappingTab />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  for (let turn = 0; turn < 6; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

beforeEach(() => {
  useWorkspaceStore.setState({ hostLockedWorkspaceId: null, currentWorkspaceId: null, gameScope: "all", lastGame: null });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("rank mapping tab", () => {
  it("opens the first game that collects ranks, with a tab for each", async () => {
    await mount("/admin/collectors/rank?tab=mapping");

    expect(container.querySelector("[data-widget]")?.getAttribute("data-widget")).toBe("overwatch");
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
  });

  it("names a game that does not collect ranks and draws no mapping for it", async () => {
    await mount("/admin/collectors/rank?tab=mapping&discipline=chess");

    expect(container.querySelector("[data-widget]")).toBeNull();
    expect(container.textContent).toContain('"chess"');
  });
});
