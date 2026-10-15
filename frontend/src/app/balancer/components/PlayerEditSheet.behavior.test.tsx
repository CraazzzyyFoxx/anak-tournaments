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
import balancerAdminService from "@/services/balancer-admin.service";
import userService from "@/services/user.service";
import workspaceService from "@/services/workspace.service";
import { useWorkspaceStore } from "@/stores/workspace.store";
import type {
  BalancerPlayerRecord,
  RegistrationRankAutofillResponse
} from "@/types/balancer-admin.types";
import type { User, UserTournament } from "@/types/user.types";
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
function sheet(
  discipline: string | undefined,
  divisionGridVersionId: number | null | undefined = null,
  divisionGridVersion?: DivisionGridVersion
) {
  return (
    <PlayerEditModal
      player={player}
      discipline={discipline}
      divisionGridVersionId={divisionGridVersionId}
      divisionGridVersion={divisionGridVersion}
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
async function clickButton(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
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

  it("loads and edits a tournament pin without a workspace LoL default", async () => {
    const pinned = version(3, "LoL Pin", [200, 900]);
    const pending = Promise.withResolvers<DivisionGridVersion>();
    vi.spyOn(workspaceService, "getDivisionGridVersion").mockReturnValue(pending.promise);
    useWorkspaceStore.setState({
      workspaces: [
        {
          ...workspace,
          default_division_grid_versions: { overwatch: ow.id },
          effective_division_grid_versions: { overwatch: ow }
        }
      ]
    });
    await render(sheet(undefined, undefined));
    expect(document.querySelector('input[type="range"]')).toBeNull();
    await render(sheet("lol", pinned.id));
    expect(document.querySelector('input[type="range"]')).toBeNull();
    expect(crestNames()).toEqual([]);
    await act(async () => pending.resolve(pinned));
    await render(sheet("lol", pinned.id));
    expect(crestNames()).toContain("LoL Pin 1");
    const slider = document.querySelector<HTMLInputElement>('input[type="range"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "1");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(crestNames()).toContain("LoL Pin 2");
    await clickButton("Save");
    expect(onSave.mock.calls[0][1].role_entries_json[0]).toMatchObject({
      rank_value: 900,
      division_number: 2
    });
  });

  it("never substitutes the workspace grid while a different owner pin is pending or failed", async () => {
    const pinned = version(3, "LoL Pin", [200, 900]);
    const pending = Promise.withResolvers<DivisionGridVersion>();
    vi.spyOn(workspaceService, "getDivisionGridVersion").mockReturnValue(pending.promise);
    await render(sheet("lol", pinned.id, pinned));
    expect(crestNames()).toContain("LoL Pin 1");
    await render(sheet("lol", 4));
    expect(document.querySelector('input[type="range"]')).toBeNull();
    expect(crestNames()).toEqual([]);
    await act(async () => pending.reject(new Error("Pinned version unavailable")));
    await render(sheet("lol", 4));
    expect(document.querySelector('input[type="range"]')).toBeNull();
    expect(crestNames()).toEqual([]);
    expect(onSave).not.toHaveBeenCalled();
  });

  it.each([
    { max: null, expected: 1500 },
    { max: undefined, expected: 1500 },
    { max: 600, expected: 600 }
  ])("commits numeric rank entry using the real upper bound ($max)", async ({ max, expected }) => {
    // Embedded tournament responses omit null maxima; tier order is not rank order.
    const bounded = { ...lol, tiers: [{ ...lol.tiers[1], rank_max: max }, lol.tiers[0]] };
    useWorkspaceStore.setState({
      workspaces: [
        { ...workspace, effective_division_grid_versions: { overwatch: ow, lol: bounded } }
      ]
    });
    await render(sheet("lol"));
    const input = document.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "1500"
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.blur());
    expect(input.value).toBe(String(expected));
    expect(crestNames()).toContain("LoL 2");
    await clickButton("Save");
    expect(onSave.mock.calls[0][1].role_entries_json[0]).toMatchObject({
      rank_value: expected,
      division_number: 2
    });
  });

  it("keeps history normalized to the workspace while editing and applying into a different pin", async () => {
    const pinned = version(3, "LoL Pin", [200, 900]);
    vi.spyOn(userService, "getUserByName").mockResolvedValue({ id: 42 } as User);
    vi.spyOn(balancerAdminService, "getUserBalancerRankHistory").mockResolvedValue([]);
    vi.spyOn(userService, "getUserTournaments").mockResolvedValue([
      {
        id: 10,
        name: "Past pinned tournament",
        role: { dimension: "position", role: "support" },
        division_grid_version: pinned,
        players: [{ user_id: 42, rank: 250 }]
      }
    ] as UserTournament[]);
    vi.spyOn(workspaceService, "getDivisionGridMapping").mockResolvedValue({
      id: 9,
      source_version_id: pinned.id,
      target_version_id: lol.id,
      name: "Pinned to workspace",
      is_complete: true,
      rules: [
        {
          source_tier_id: pinned.tiers[0].id!,
          target_tier_id: lol.tiers[1].id!,
          weight: 1,
          is_primary: true
        }
      ]
    });
    await render(sheet("lol", pinned.id, pinned));
    await clickButton("Load from history");
    expect(document.body.textContent).toContain("Past pinned tournament");
    expect(crestNames()).toContain("LoL Pin 1");
    expect(crestNames()).toContain("LoL 2");
    expect(crestNames()).not.toContain("LoL Pin 2");
    expect(crestNames()).not.toContain("OW 2");
    await clickButton("Apply history values");
    expect(document.querySelector<HTMLInputElement>('input[inputmode="numeric"]')?.value).toBe(
      "400"
    );
    expect(crestNames()).toContain("LoL Pin 1");
    await clickButton("Save");
    expect(onSave.mock.calls[0][1].role_entries_json[0]).toMatchObject({
      rank_value: 400,
      division_number: 1
    });
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
