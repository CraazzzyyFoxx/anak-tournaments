// @vitest-environment happy-dom
//
// The admin matches screen's parsed view reads one game at a time (ruling R4): a game picked in the scope pill leaves
// that game's map and tournament scope behind and keeps the view (ruling R5).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { PillPick } from "@/test/pill-pick";
import { navigation } from "@/test/url-navigation";

import AdminMatchesPage from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("@/services/discipline.service", async () => (await import("@/test/discipline-metadata")).disciplineServiceMock);
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canAccessPermission: () => true, isLoaded: true })
}));
// The five views are lazily loaded browsers with suites of their own; the page's choice of game is the subject.
vi.mock("next/dynamic", () => ({ default: () => () => <div data-view /> }));
vi.mock("@/components/kit/LinkTabs", () => ({ LinkTabs: () => null }));
vi.mock("@/components/admin/AdminPageHeader", () => ({ AdminPageHeader: () => null }));

let root: Root;
let container: HTMLDivElement;

async function mount(url: string) {
  navigation.reset(url);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <AdminMatchesPage />
          <PillPick code="lol" />
        </NextIntlClientProvider>
      </QueryClientProvider>
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
  useWorkspaceStore.setState({
    currentWorkspaceId: 1,
    workspaces: [{ id: 1, name: "OWT", disciplines_enabled: ["overwatch", "lol"] }] as never,
    statsScope: "workspace",
    hostLockedWorkspaceId: null,
    gameScope: "all",
    lastGame: null
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("admin matches, parsed view", () => {
  it("a game picked in the scope pill drops the view's map and tournament scope and keeps the view", async () => {
    await mount("/admin/matches?view=parsed&tournament=4&stage=2&map_id=9&unlinked_only=true");

    await act(async () => {
      container.querySelector("[data-pill-pick=lol]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const url = new URL(navigation.pushes.at(-1)!, "http://x");
    expect(url.pathname).toBe("/admin/matches");
    expect(url.searchParams.get("view")).toBe("parsed");
    expect(url.searchParams.get("discipline")).toBe("lol");
    for (const param of ["map_id", "tournament", "stage"]) expect(url.searchParams.has(param), param).toBe(false);
    expect(url.searchParams.get("unlinked_only")).toBe("true");
  });
});
