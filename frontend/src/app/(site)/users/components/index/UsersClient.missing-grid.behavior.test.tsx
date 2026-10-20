// @vitest-environment happy-dom
//
// A game with no division grid on the browsed axis (League on the all-workspaces axis, or a workspace that never
// published one) is refused by the server with 422 `division_grid_required`. The index has to say what is missing
// and who can fix it — through the app's own QueryClient, so the refusal is neither retried nor toasted as the
// server's raw text.
import { QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { makeQueryClient } from "@/app/providers";
import en from "@/i18n/messages/en.json";
import { useAuthProfileStore } from "@/stores/auth-profile.store";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";
import type { StatsScope } from "@/lib/site/stats-scope";

import UsersClient from "./UsersClient";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { apiError } = vi.hoisted(() => ({ apiError: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/users",
  useSearchParams: () => new URLSearchParams("discipline=lol"),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}));
vi.mock("@/hooks/useCurrentWorkspace", () => ({
  useCurrentWorkspaceId: () => 1,
  useDivisionGrid: () => ({ tiers: [] })
}));
// `vi.mock` factories are hoisted above the static imports, so the fixture is imported inside the factory.
vi.mock("@/services/discipline.service", async () => (await import("@/test/discipline-metadata")).disciplineServiceMock);
vi.mock("@/lib/notify", () => ({ notify: { apiError, error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

/** The gateway's relay of the worker's `HTTPException(422, "division_grid_required: …")`. */
const REFUSAL = "division_grid_required: 'lol' needs a division grid of its own with tiers";
const fetchMock = vi.fn(async (url: string) => {
  if (url.startsWith("/api/v1/users/overview")) {
    return new Response(JSON.stringify({ detail: REFUSAL, code: "unprocessable" }), {
      status: 422,
      headers: { "Content-Type": "application/json" }
    });
  }
  throw new Error(`unexpected request ${url}`);
});

let container: HTMLDivElement;
let root: Root;

const settle = async () => {
  for (let i = 0; i < 12; i += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
};

beforeEach(() => {
  fetchMock.mockClear();
  apiError.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useAuthProfileStore.setState({ status: "idle", user: undefined });
  vi.unstubAllGlobals();
});

const renderIndex = async (scope: StatsScope, axis: WorkspaceAxis) => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={makeQueryClient()}>
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <UsersClient scope={scope} initial={{ stored: "all", lastGame: null, axis, hostLockedWorkspaceId: null, disciplines: null }} />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  await settle();
};

const overviewReads = () =>
  fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith("/api/v1/users/overview?"));

it("tells the all-communities view to choose a community instead of printing the server's refusal", async () => {
  await renderIndex("all", "all");

  const notice = container.querySelector('[role="alert"]');
  expect(notice?.textContent).toBe(en.common.discipline.gridMissingAcross.replaceAll("{game}", "League of Legends"));
  // No workspace grid applies across communities: no organizer line, no settings link.
  expect(notice?.querySelector("a")).toBeNull();
  expect(container.textContent).not.toContain("division_grid_required");
  expect(container.textContent).not.toContain(en.users.list.errors.overview);
  // Asked once, on the axis the page browses; never retried, never toasted.
  expect(overviewReads()).toHaveLength(1);
  expect(overviewReads()[0]).toContain("workspace_id=all");
  expect(apiError).not.toHaveBeenCalled();
});

it("sends an organizer of the workspace to this game's grid settings", async () => {
  useAuthProfileStore.setState({
    status: "authenticated",
    user: {
      isSuperuser: false,
      roles: [],
      permissions: [],
      denies: [],
      workspaces: [{ workspace_id: 1, permissions: ["division_grid.update"] }]
    } as never
  });

  await renderIndex("workspace", 1);

  const notice = container.querySelector('[role="alert"]');
  expect(notice?.textContent).toContain(en.common.discipline.gridMissing);
  const link = notice?.querySelector<HTMLAnchorElement>("a");
  expect(link?.getAttribute("href")).toBe("/admin/settings/divisions?discipline=lol");
  expect(link?.textContent).toBe(en.common.discipline.gridMissingAction.replace("{game}", "League of Legends"));
  expect(overviewReads()[0]).toContain("workspace_id=1");
});
