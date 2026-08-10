// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminRegistration } from "@/types/balancer-admin.types";
import RegistrationsTable from "./RegistrationsTable";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listRegistrations = vi.fn();
const getRegistrationForm = vi.fn();
const listStatusCatalog = vi.fn();
const exportRegistrationsToUsers = vi.fn();

vi.mock("@/services/balancer-admin.service", () => ({
  default: {
    listRegistrations: (...args: unknown[]) => listRegistrations(...args),
    getRegistrationForm: (...args: unknown[]) => getRegistrationForm(...args),
    listStatusCatalog: (...args: unknown[]) => listStatusCatalog(...args),
    exportRegistrationsToUsers: (...args: unknown[]) => exportRegistrationsToUsers(...args),
    createManualRegistration: vi.fn(),
    updateRegistration: vi.fn(),
    approveRegistration: vi.fn(),
    rejectRegistration: vi.fn(),
    withdrawRegistration: vi.fn(),
    restoreRegistration: vi.fn(),
    deleteRegistration: vi.fn(),
    bulkApproveRegistrations: vi.fn(),
    setBalancerStatus: vi.fn(),
    checkInRegistration: vi.fn(),
    bulkAddToBalancer: vi.fn()
  }
}));
vi.mock("@/services/registration.service", () => ({
  default: { getForm: vi.fn().mockResolvedValue(null) }
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
vi.mock("@/stores/workspace.store", () => ({
  useWorkspaceStore: (selector: (state: { currentWorkspaceId: number }) => unknown) =>
    selector({ currentWorkspaceId: 1 })
}));
vi.mock("@/lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() }
}));

function statusMeta(value: string, scope: "registration" | "balancer", excludesFromBalancer = false) {
  return {
    value,
    scope,
    is_builtin: true,
    kind: "builtin",
    is_override: false,
    can_edit: false,
    can_delete: false,
    can_reset: false,
    icon_slug: null,
    icon_color: null,
    name: value,
    description: null,
    excludes_from_balancer: excludesFromBalancer
  };
}

function registration(id: number, overrides: Partial<AdminRegistration> = {}): AdminRegistration {
  const status = overrides.status ?? "approved";
  const balancerStatus = overrides.balancer_status ?? "ready";
  return {
    id,
    tournament_id: 80,
    workspace_id: 1,
    user_id: id,
    display_name: `Player ${id}`,
    battle_tag: `Player${id}#1234`,
    smurf_tags_json: null,
    discord_nick: null,
    twitch_nick: null,
    stream_pov: false,
    roles: [],
    notes: null,
    admin_notes: null,
    custom_fields_json: null,
    status,
    status_meta: statusMeta(status, "registration"),
    balancer_status: balancerStatus,
    balancer_status_meta: statusMeta(
      balancerStatus,
      "balancer",
      balancerStatus === "not_in_balancer" || balancerStatus === "excluded"
    ),
    checked_in: false,
    profiles_open: true,
    source: "manual",
    submitted_at: "2026-07-30T17:00:00Z",
    reviewed_at: null,
    ...overrides
  } as AdminRegistration;
}

const POOL = [
  registration(1, { status: "pending", balancer_status: "not_in_balancer" }),
  ...Array.from({ length: 24 }, (_unused, index) => registration(index + 2))
];

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={{}}>
        <QueryClientProvider client={client}>
          <RegistrationsTable tournamentId={80} basePath="/admin/tournaments/80/registration" />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  });
  // React Query resolves through both microtasks and timers before committing.
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await tick();
    });
  }
  return container;
}

function click(node: Element | null | undefined) {
  if (!node) throw new Error("Expected a clickable node");
  return act(async () => {
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
  });
}

beforeEach(() => {
  listRegistrations.mockReset().mockResolvedValue(POOL);
  getRegistrationForm.mockReset().mockResolvedValue({ require_open_profile: false });
  listStatusCatalog.mockReset().mockResolvedValue([]);
  exportRegistrationsToUsers
    .mockReset()
    .mockResolvedValue({ processed: 25, skipped: 0, total: 25 });
});

describe("RegistrationsTable toolbar", () => {
  it("keeps the counts without spending a header row on them", async () => {
    const scope = await mount();

    expect(scope.textContent).not.toContain("Showing 25 of 25");
    expect(scope.textContent).toContain("1 pending");
    // Unfiltered: a single total, not a redundant "25/25".
    expect(scope.textContent).not.toContain("25/25");
    expect([...scope.querySelectorAll("span")].map((node) => node.textContent)).toContain("25");
  });

  it("turns the pending count into the pending filter", async () => {
    const scope = await mount();
    const chip = [...scope.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("1 pending")
    );

    await click(chip);

    expect(listRegistrations).toHaveBeenLastCalledWith(80, {
      status_filter: "pending",
      inclusion_filter: undefined,
      source_filter: undefined,
      include_deleted: false
    });
  });

  it("reaches the form builder and the other advanced tools behind one menu", async () => {
    const scope = await mount();
    const trigger = scope.querySelector("[aria-label='Advanced registration actions']");

    await click(trigger);

    const hrefs = [...document.querySelectorAll("a")].map((node) => node.getAttribute("href"));
    expect(hrefs).toContain("/admin/tournaments/80/registration/form");
    expect(hrefs).toContain("/admin/tournaments/80/registration/feed");
    expect(hrefs).toContain("/admin/tournaments/80/registration/rank-autofill");
    expect(document.body.textContent).toContain("Export to analytics");
  });
});
