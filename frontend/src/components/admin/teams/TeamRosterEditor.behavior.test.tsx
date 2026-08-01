// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { Player } from "@/types/team.types";
import { TeamRosterEditor } from "./TeamRosterEditor";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getPlayerSubRoles = vi.fn();
const updatePlayer = vi.fn();
const createPlayer = vi.fn();
const deletePlayer = vi.fn();

vi.mock("@/services/admin.service", () => ({
  default: {
    getPlayerSubRoles: (...args: unknown[]) => getPlayerSubRoles(...args),
    updatePlayer: (...args: unknown[]) => updatePlayer(...args),
    createPlayer: (...args: unknown[]) => createPlayer(...args),
    deletePlayer: (...args: unknown[]) => deletePlayer(...args)
  }
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- this IS the next/image stand-in
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />
}));
vi.mock("@/hooks/useCurrentWorkspace", () => ({ useDivisionGrid: () => ({ tiers: [] }) }));
vi.mock("@/components/admin/UserSearchCombobox", () => ({
  UserSearchCombobox: () => <div data-testid="user-search" />
}));

function player(overrides: Partial<Player> & { id: number; name: string }): Player {
  return {
    created_at: new Date(0),
    updated_at: null,
    sub_role: null,
    rank: 3000,
    division: 20,
    role: "Damage",
    tournament_id: 7,
    user_id: overrides.id + 100,
    team_id: 3,
    is_newcomer: false,
    is_newcomer_role: false,
    is_substitution: false,
    related_player_id: null,
    user: null,
    ...overrides
  };
}

const SUPPORT = player({ id: 1, name: "Mercy", role: "Support", rank: 2800 });
const TANK = player({ id: 2, name: "Rein", role: "Tank", rank: 3300, sub_role: "main_heal" });
const DAMAGE = player({ id: 3, name: "Tracer", role: "Damage", rank: 3100 });
const TANK_SUB = player({
  id: 4,
  name: "Sigma",
  role: "Tank",
  rank: 3200,
  is_substitution: true,
  related_player_id: 2
});

function tick() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

async function mount(props?: { canUpdatePlayer?: boolean }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        {/* The admin layout mounts one; mirror it so tooltips resolve. */}
        <TooltipProvider>
          <TeamRosterEditor
            teamId={3}
            tournamentId={7}
            workspaceId={1}
            players={[SUPPORT, TANK, DAMAGE, TANK_SUB]}
            divisionGrid={null}
            canCreatePlayer
            canUpdatePlayer={props?.canUpdatePlayer ?? true}
            canDeletePlayer
          />
        </TooltipProvider>
      </QueryClientProvider>
    );
  });

  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await tick();
    });
  }

  return container;
}

function rankFields(scope: HTMLElement) {
  return Array.from(
    scope.querySelectorAll<HTMLInputElement>('input[aria-label^="Rank of "]')
  );
}

const nativeValueSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value"
)?.set;

async function typeAndBlur(field: HTMLInputElement, value: string) {
  await act(async () => {
    nativeValueSetter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // React implements `onBlur` on the bubbling `focusout` event.
  await act(async () => {
    field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("TeamRosterEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPlayerSubRoles.mockResolvedValue([
      {
        id: 9,
        workspace_id: 1,
        role: "tank",
        slug: "main_heal",
        label: "Main Heal",
        description: null,
        sort_order: 0,
        is_active: true
      }
    ]);
    updatePlayer.mockResolvedValue({});
  });

  it("orders the roster by role and nests a substitute under the slot it covers", async () => {
    const scope = await mount();

    expect(rankFields(scope).map((field) => field.getAttribute("aria-label"))).toEqual([
      "Rank of Rein",
      "Rank of Sigma",
      "Rank of Tracer",
      "Rank of Mercy"
    ]);
  });

  it("shows role and rank as the site-wide icons, not text", async () => {
    const scope = await mount();

    // Role: an icon-only trigger whose accessible name still carries the value.
    const roleTriggers = Array.from(
      scope.querySelectorAll<HTMLElement>('[aria-label^="Role of "]')
    );
    expect(roleTriggers.map((trigger) => trigger.getAttribute("aria-label"))).toContain(
      "Role of Rein: Tank"
    );
    expect(roleTriggers[0].querySelector("svg")).not.toBeNull();

    // Rank: a division image beside the editable number.
    const divisionIcons = scope.querySelectorAll<HTMLImageElement>("img");
    expect(divisionIcons).toHaveLength(4);
    expect(divisionIcons[0].getAttribute("src")).toContain("/divisions/");
  });

  it("persists a rank edit on blur", async () => {
    const scope = await mount();
    const rein = rankFields(scope).find(
      (field) => field.getAttribute("aria-label") === "Rank of Rein"
    )!;

    await typeAndBlur(rein, "3450");

    expect(updatePlayer).toHaveBeenCalledWith(2, { rank: 3450 });
  });

  it("persists a newcomer flag toggle", async () => {
    const scope = await mount();
    const toggle = scope.querySelector<HTMLButtonElement>('button[aria-label="Newcomer — Rein"]')!;

    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(updatePlayer).toHaveBeenCalledWith(2, { is_newcomer: true });
  });

  it("disables every roster control without player.update", async () => {
    const scope = await mount({ canUpdatePlayer: false });

    expect(rankFields(scope).every((field) => field.disabled)).toBe(true);
    expect(updatePlayer).not.toHaveBeenCalled();
  });
});
