// A player's profile in a game with no division grid on the viewed axis is refused by the server (422
// `division_grid_required`) for the profile and every tab alike. The page names the missing grid in their place —
// across communities as a choice of community, on a workspace as that workspace's missing grid — and any other
// failure still reaches the route's error boundary.
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import { ApiError } from "@/lib/api/error";
import type { WorkspaceAxis } from "@/lib/site/discipline-scope";
import type { StatsScope } from "@/lib/site/stats-scope";

import UserPage from "./page";

const { view, getUserProfile } = vi.hoisted(() => ({
  view: { scope: "all" as StatsScope, axis: "all" as WorkspaceAxis },
  getUserProfile: vi.fn()
}));

vi.mock("@/lib/site/tenant-host", () => ({ resolveStatsScope: async () => view.scope }));
vi.mock("@/lib/site/discipline-server", () => ({
  resolveServerBrowsingDiscipline: async () => ({
    init: {
      stored: null,
      axis: view.axis,
      hostLockedWorkspaceId: null,
      disciplines: [
        { code: "overwatch", name: "Overwatch", enabled: true },
        { code: "lol", name: "League of Legends", enabled: true }
      ]
    },
    resolved: { kind: "concrete", code: "lol" }
  })
}));
vi.mock("@/services/user.service", () => ({
  default: { getUserByName: async () => ({ id: 7, name: "Faker" }), getUserProfile }
}));
// The game selector above the profile is its own client surface with its own tests.
vi.mock("@/components/workspace/ServerBrowsingDiscipline", () => ({ ServerBrowsingDiscipline: () => null }));

const REFUSAL = new ApiError(422, [
  { msg: "division_grid_required: 'lol' needs a division grid of its own with tiers", code: "unprocessable" }
]);

/** Awaits every async (server) component in the tree, the way the RSC renderer does, leaving client ones to SSR. */
async function resolveServer(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServer));
  if (!isValidElement(node)) return node;
  const { type, props } = node as ReactElement<{ children?: ReactNode }>;
  if (typeof type === "function" && type.constructor.name === "AsyncFunction") {
    return resolveServer(await (type as (p: unknown) => Promise<ReactNode>)(props));
  }
  return props.children === undefined ? node : cloneElement(node, undefined, await resolveServer(props.children));
}

const renderProfile = async () =>
  renderToStaticMarkup(
    await resolveServer(
      await UserPage({
        params: Promise.resolve({ slug: "Faker" }),
        searchParams: Promise.resolve({ discipline: "lol" })
      })
    )
  );

beforeEach(() => {
  getUserProfile.mockReset().mockRejectedValue(REFUSAL);
});

it("tells the all-communities view to choose a community", async () => {
  view.scope = "all";
  view.axis = "all";

  const html = await renderProfile();

  expect(html).toContain('role="alert"');
  expect(html).toContain(en.common.discipline.gridMissingAcross.replaceAll("{game}", "League of Legends"));
  expect(html).not.toContain("division_grid_required");
  // Nothing of the profile is drawn around it: no header, no tabs.
  expect(html).not.toContain('role="tablist"');
});

it("names the workspace's missing grid on a workspace", async () => {
  view.scope = "workspace";
  view.axis = 1;

  const html = await renderProfile();

  expect(html).toContain(en.common.discipline.gridMissing);
  expect(html).not.toContain(en.common.discipline.gridMissingAcross.split("{game}")[1]);
});

it("leaves any other failure to the route's error boundary", async () => {
  getUserProfile.mockReset().mockRejectedValue(new ApiError(500, [{ msg: "boom", code: "error" }]));

  await expect(renderProfile()).rejects.toBeInstanceOf(ApiError);
});
