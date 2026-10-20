// @vitest-environment happy-dom
//
// "Create tournament" hands the list's game filter to the wizard, which defaults its game field to it.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { useWorkspaceStore } from "@/stores/workspace.store";
import { navigation } from "@/test/url-navigation";

import TournamentsPage from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", async () => (await import("@/test/url-navigation")).nextNavigationMock);
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>
}));
vi.mock("@/services/discipline.service", async () => (await import("@/test/discipline-metadata")).disciplineServiceMock);
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canAccessPermission: () => true }) }));
vi.mock("@/components/admin/tournaments/list/TournamentsBrowser", () => ({ TournamentsBrowser: () => null }));

let root: Root;
let container: HTMLDivElement;

async function createHref(url: string) {
  navigation.reset(url);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <TournamentsPage />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
  return [...container.querySelectorAll("a")]
    .find((link) => link.textContent?.trim() === en.adminTournaments.list.create)
    ?.getAttribute("href");
}

beforeEach(() => {
  useWorkspaceStore.setState({
    currentWorkspaceId: 1,
    workspaces: [{ id: 1, name: "OWT", disciplines_enabled: ["overwatch", "lol"] }] as never,
    statsScope: "workspace",
    hostLockedWorkspaceId: null
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("admin tournaments page", () => {
  it("carries the filtered game into the wizard link", async () => {
    expect(await createHref("/admin/tournaments?discipline=lol")).toBe("/admin/tournaments/new?discipline=lol");
  });

  it("links the plain wizard with no game filtered, or one the community does not run", async () => {
    expect(await createHref("/admin/tournaments")).toBe("/admin/tournaments/new");
    expect(await createHref("/admin/tournaments?discipline=starcraft")).toBe("/admin/tournaments/new");
  });
});
