// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RankAutofillPreviewTables } from "@/components/balancer/rank-autofill/_components/RankAutofillPreviewTables";
import { PickBanTargetBoard } from "@/components/pick-ban/PickBanTargetBoard";
import messages from "@/i18n/messages/en.json";
import adminService from "@/services/admin.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type {
  BalancerPlayerRecord,
  RegistrationRankAutofillResponse
} from "@/types/balancer-admin.types";
import type { DivisionGridVersion, Workspace } from "@/types/workspace.types";
import { PlayerEditModal } from "./PlayerEditSheet";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Rank interaction stays real; drag transport is unrelated and can load a second React copy.
vi.mock("@/components/kit/SortableRows", () => ({
  SortableRows: ({
    items,
    children
  }: {
    items: readonly unknown[];
    children: (item: unknown, index: number) => ReactNode;
  }) => <div>{items.map(children)}</div>,
  useSortableRow: () => ({ ref: () => {}, style: {}, handleProps: {}, isDragging: false }),
  SortableGrip: () => null
}));

function version(id: number, game: string, floors: number[]): DivisionGridVersion {
  return {
    id,
    grid_id: id,
    version: 1,
    label: game,
    status: "published",
    created_from_version_id: null,
    published_at: null,
    tiers: floors.map((rank_min, index) => ({
      id: id * 10 + index,
      slug: `${game}-${index}`,
      number: index + 1,
      name: `${game} ${index + 1}`,
      sort_order: index,
      rank_min,
      rank_max: floors[index + 1] == null ? null : floors[index + 1] - 1,
      icon_url: `/${game.toLowerCase()}-${index + 1}.png`
    }))
  };
}
const ow = version(1, "OW", [1000, 3000]);
const lol = version(2, "LoL", [200, 400]);
const workspace = {
  id: 1,
  slug: "mixed",
  name: "Mixed",
  timezone: "UTC",
  is_active: true,
  disciplines_enabled: ["overwatch", "lol"],
  default_division_grid_versions: { overwatch: 1, lol: 2 },
  effective_division_grid_versions: { overwatch: ow, lol }
} as Workspace;
const player: BalancerPlayerRecord = {
  id: 7,
  tournament_id: 11,
  application_id: 8,
  battle_tag: "Support#1",
  battle_tag_normalized: "support#1",
  user_id: null,
  role_entries_json: [
    {
      role: "support",
      subtype: null,
      priority: 1,
      rank_value: 200,
      division_number: 1,
      is_active: true,
      is_declared_active: true,
      ow_rank_value: null
    }
  ],
  is_flex: false,
  is_in_pool: true,
  ready_blocked: false,
  admin_notes: null
};
const onSave = vi.fn();
const initialStore = useWorkspaceStore.getState();
let root: Root;
let client: QueryClient;

async function render(children: ReactNode) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
          {children}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
}
function sheet(discipline: string | undefined) {
  return (
    <PlayerEditModal
      player={player}
      discipline={discipline}
      open
      onOpenChange={() => {}}
      onSave={onSave}
    />
  );
}
function crestNames() {
  return [...document.querySelectorAll("img")]
    .filter((image) => /^(LoL|OW) /.test(image.alt))
    .map((image) => image.alt);
}
beforeEach(() => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  useWorkspaceStore.setState({
    workspaces: [workspace],
    currentWorkspaceId: 1,
    entityWorkspaceId: null,
    hostLockedWorkspaceId: null
  });
  vi.spyOn(adminService, "getPlayerSubRoles").mockResolvedValue([]);
  onSave.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  useWorkspaceStore.setState(initialStore, true);
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("owner-grid receiving controls", () => {
  it("slides the LoL support tier and sends its floor, never the OW floor", async () => {
    await render(sheet("lol"));
    const slider = document.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider).not.toBeNull();
    expect(crestNames()).toContain("LoL 1");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "1");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSave).not.toHaveBeenCalled();
    expect(crestNames()).toContain("LoL 2");
    expect(document.querySelector<HTMLInputElement>('input[inputmode="numeric"]')?.value).toBe(
      "400"
    );
    const save = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Save"
    )!;
    await act(async () => save.click());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toBe(7);
    expect(onSave.mock.calls[0][1].role_entries_json[0]).toMatchObject({
      role: "support",
      rank_value: 400,
      division_number: 2
    });
  });

  it("exposes no OW controls while owner metadata is unresolved or unavailable", async () => {
    await render(sheet(undefined));
    expect(document.querySelector('input[type="range"]')).toBeNull();
    expect(crestNames()).toEqual([]);
    await render(sheet("lol"));
    expect(crestNames()).toContain("LoL 1");
    await render(sheet(undefined));
    expect(document.querySelector('input[type="range"]')).toBeNull();
    expect(crestNames()).toEqual([]);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not expose an OW slider when the known LoL owner's payload is missing", async () => {
    useWorkspaceStore.setState({
      workspaces: [{ ...workspace, effective_division_grid_versions: { overwatch: ow } }]
    });
    await render(sheet("lol"));
    expect(document.querySelector('input[type="range"]')).toBeNull();
    expect(crestNames()).toEqual([]);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("owner-grid nested crests", () => {
  it("uses LoL crests for both sides of an autofill rank transition", async () => {
    const preview: RegistrationRankAutofillResponse = {
      total_registrations: 1,
      updatable_registrations: 1,
      applied_registrations: 0,
      skipped_registrations: 0,
      unchanged_registrations: 0,
      unverified_registrations: 0,
      role_updates: 1,
      overwrite_existing: true,
      add_to_balancer: false,
      balancer_additions: 0,
      ow_value: null,
      players: [
        {
          registration_id: 8,
          display_name: "Support",
          battle_tag: null,
          status: "will_update",
          reason: null,
          will_add_to_balancer: false,
          balancer_reason: null,
          roles: [
            {
              role: { dimension: "position", role: "support" },
              current_rank_value: 200,
              parsed_rank_value: 400,
              action: "overwrite",
              reason: null,
              platform: null,
              division: null,
              tier: null,
              season: null,
              captured_at: null,
              source: "balancer",
              division_history_rank_value: 400,
              ow_rank_value: null,
              ow_current_rank_value: null,
              ow_peak_rank_value: null,
              analytics_rank_value: null,
              used_source: "division_history"
            }
          ]
        }
      ]
    };
    await render(
      <RankAutofillPreviewTables
        discipline="lol"
        preview={preview}
        loading={false}
        search=""
        mismatchOnly={false}
        selectedIds={new Set([8])}
        onToggle={() => {}}
        onToggleAll={() => {}}
      />
    );
    expect(crestNames()).toEqual(["LoL 1", "LoL 2"]);
    expect([...document.querySelectorAll("img")].some((image) => image.src.includes("ow-"))).toBe(
      false
    );
  });

  it("uses the LoL target crest rather than the same-number OW tier", async () => {
    await render(
      <PickBanTargetBoard
        discipline="lol"
        targets={[
          {
            player_id: 7,
            name: "Support",
            role: { dimension: "position", role: "support" },
            division: 2,
            is_substitution: false
          }
        ]}
        previousMatchId={null}
        selectedPlayerId={null}
        assignedByPlayer={{}}
        itemsById={{}}
        onSelect={() => {}}
        teamName="LoL team"
      />
    );
    expect(crestNames()).toEqual(["LoL 2"]);
    expect([...document.querySelectorAll("img")].some((image) => image.src.includes("ow-"))).toBe(
      false
    );
  });
});
