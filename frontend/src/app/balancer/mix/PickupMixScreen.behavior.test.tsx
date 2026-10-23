// @vitest-environment happy-dom
//
// The mix overview is the host's desk; what plays out in a lobby's room lives on the room's own page. Pinned:
//  1. the overview docks no chat, even while a match is on: chat lives only in the room;
//  2. a several-lobby overview shows the cards alone until `?lobby=<letter>` picks a desk, which then sits under the
//     cards with no history of its own (the standalone history card lists every lobby); a card's toggle writes and
//     clears that param; a one-lobby mix always shows lobby A's desk;
//  3. a host's Draft goes to the lobby's room once the draft is seeded;
//  4. a seated player whose lobby plays out in the room is taken there, and their own panel links it.
// The panels around it are not what this pins, so they render as stubs that keep their props.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type * as CustomGameModule from "@/services/custom-game.service";
import type { CustomGame, CustomGameLobby, MixSelfState } from "@/services/custom-game.service";

import { PickupMixScreen } from "./PickupMixScreen";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

type Props = Record<string, unknown>;

const shown = vi.hoisted(() => ({
  game: null as CustomGame | null,
  search: "",
  seat: undefined as MixSelfState | undefined,
}));
const captured = vi.hoisted(() => ({ teams: null as Props | null, cards: null as Props | null, seat: null as Props | null }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const seedDraft = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, variables: undefined }));
const getEnvelope = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ gameId: "3" }),
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(shown.search),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/services/custom-game.service", async (importOriginal) => {
  const actual = await importOriginal<typeof CustomGameModule>();
  return {
    ...actual,
    customGameService: {
      ...actual.customGameService,
      getById: async () => shown.game,
      stats: async () => ({ members: [] }),
    },
  };
});
// Every query and write the screen reads off the hook; only Draft is watched here.
vi.mock("@/app/balancer/mix/usePickupMix", () => ({
  usePickupMix: () => {
    const query = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });
    const reads: Record<string, unknown> = {
      selectedGameId: 3,
      activeLobby: 0,
      setActiveLobby: vi.fn(),
      gamesQuery: query([]),
      gameQuery: query(shown.game),
      matchesQuery: query([]),
      rotationQuery: query([]),
      mySeatQuery: query(shown.seat),
      myQueuePosition: null,
      voiceOptionsQuery: query(undefined),
      seedDraft,
    };
    const write = { mutate: vi.fn(), mutateAsync: vi.fn(), reset: vi.fn(), isPending: false };
    return new Proxy(reads, { get: (target, key: string) => (key in target ? target[key] : write) });
  },
}));
vi.mock("@/app/balancer/mix/PickupTeamsPanel", () => ({
  PickupTeamsPanel: (props: Props) => {
    captured.teams = props;
    return <div>teams</div>;
  },
}));
vi.mock("@/app/balancer/mix/PickupLobbyCards", () => ({
  PickupLobbyCards: (props: Props) => {
    captured.cards = props;
    return <div>cards</div>;
  },
}));
vi.mock("@/app/balancer/mix/PickupMySeatPanel", () => ({
  PickupMySeatPanel: (props: Props) => {
    captured.seat = props;
    return null;
  },
}));
vi.mock("@/app/balancer/mix/PickupLobbyPanel", () => ({ PickupLobbyPanel: () => null }));
vi.mock("@/app/balancer/mix/PickupVoicePanel", () => ({ PickupVoicePanel: () => null }));
vi.mock("@/app/balancer/mix/PickupMixHeader", () => ({ PickupMixHeader: () => null }));
vi.mock("@/hooks/useCatalogEntities", () => ({ useCatalogEntities: () => ({ data: [] }) }));
vi.mock("@/hooks/useDisciplineMetadata", () => ({ useDisciplineMetadata: () => ({ data: undefined }) }));
vi.mock("@/hooks/useCurrentWorkspace", () => ({ useDivisionGrid: () => ({ tiers: [] }) }));
vi.mock("@/hooks/useEntityWorkspace", () => ({ useEntityWorkspace: () => {} }));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canAccessPermission: () => false, isSuperuser: false, isWorkspaceAdmin: () => false }),
}));
vi.mock("@/services/roomChat.service", () => ({
  default: { getEnvelope: (...args: unknown[]) => getEnvelope(...args), postMessage: vi.fn() },
}));
vi.mock("@/hooks/useRealtimeTopic", () => ({ useRealtimeTopic: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notify: { error: vi.fn(), apiError: vi.fn(), success: vi.fn() } }));

function lobby(overrides: Partial<CustomGameLobby> = {}): CustomGameLobby {
  return {
    lobby_index: 0,
    balance_result: null,
    selected_variant_index: 0,
    next_map_id: null,
    balanced_at: null,
    team1_voice_channel_id: null,
    team2_voice_channel_id: null,
    live_encounter_id: null,
    state: "ready",
    lineup_recorded: true,
    matches_count: 0,
    ...overrides,
  };
}

function game(lobbies: CustomGameLobby[]): CustomGame {
  return {
    id: 3,
    workspace_id: 7,
    discipline: "overwatch",
    host_user_id: 9,
    co_hosts: [],
    host_display_name: null,
    name: "Thursday scrim",
    status: "balanced",
    settings: { points_per_win: 0, team_names: {}, workspace_discord_channel_id: null },
    created_at: null,
    lobby_count: lobbies.length,
    lobbies,
    roster_shape: null,
    matches_count: 0,
    last_match_at: null,
    self_signup: "closed",
    self_role_edit: false,
    general_voice_channel_id: null,
    hero_ban_preset: "hero_bo1_simple",
    players: [],
  };
}

/** A signed-in player seated in `lobbyIndex`, writing nothing. */
function seated(lobbyIndex: number): MixSelfState {
  return {
    custom_game_id: 3,
    name: "Thursday scrim",
    status: "balanced",
    self_signup: "closed",
    self_role_edit: false,
    lobby_count: 2,
    seat: {
      participation: "pool",
      roles: null,
      is_flex: false,
      ranks: {},
      current_lobby: lobbyIndex,
      workspace_member_id: 5,
      away: false,
      voice_url: null,
    },
    unranked_roles: [],
    policy: {
      can_join: false,
      can_leave: true,
      can_edit_roles: false,
      can_set_away: true,
      join_blocker: "already_joined",
      edit_blocker: null,
      away_blocker: null,
    },
  };
}

const ON_FLOOR = { state: "pregame", live_encounter_id: 50, live_started_at: "2026-10-22T20:00:00Z" } as const;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getEnvelope.mockReset();
  router.push.mockReset();
  router.replace.mockReset();
  seedDraft.mutate.mockReset();
  window.sessionStorage.clear();
  shown.search = "";
  shown.seat = undefined;
  captured.teams = null;
  captured.cards = null;
  captured.seat = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(current: CustomGame) {
  shown.game = current;
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <PickupMixScreen />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });
  }
}

describe("the mix overview", () => {
  it("docks no chat, even while a match is on: chat lives in the room", async () => {
    await render(game([lobby(ON_FLOOR)]));

    expect(container.textContent).toContain("teams");
    expect(document.body.textContent).not.toContain(en.chat.title);
    expect(getEnvelope).not.toHaveBeenCalled();
  });

  it("shows a one-lobby mix's desk and its room, whatever the URL asks", async () => {
    shown.search = "lobby=B";
    await render(game([lobby()]));

    expect(container.textContent).not.toContain("cards");
    expect(captured.teams).toMatchObject({ lobbyIndex: 0, roomHref: "/balancer/mix/3/lobby/A" });
  });

  it("shows several lobbies' cards alone until a desk is picked", async () => {
    await render(game([lobby(), lobby({ lobby_index: 1 })]));

    expect(container.textContent).toContain("cards");
    expect(container.textContent).not.toContain("teams");
    expect(captured.cards).toMatchObject({ selectedLobby: null });
  });

  it("puts the picked lobby's desk under the cards, its history left to the mix's own card", async () => {
    shown.search = "lobby=B";
    await render(game([lobby(), lobby({ lobby_index: 1 })]));

    expect(container.textContent).toContain("cards");
    expect(captured.cards).toMatchObject({ selectedLobby: 1 });
    expect(captured.teams).toMatchObject({ lobbyIndex: 1, matches: [], roomHref: "/balancer/mix/3/lobby/B" });
  });

  it("ignores a desk letter the mix does not run", async () => {
    shown.search = "lobby=E";
    await render(game([lobby(), lobby({ lobby_index: 1 })]));

    expect(container.textContent).not.toContain("teams");
    expect(captured.cards).toMatchObject({ selectedLobby: null });
  });

  it("writes the picked desk into the URL and clears it again, without scrolling", async () => {
    await render(game([lobby(), lobby({ lobby_index: 1 })]));
    const onSelectLobby = captured.cards?.onSelectLobby as (index: number | null) => void;

    act(() => onSelectLobby(1));
    expect(router.replace).toHaveBeenLastCalledWith("/balancer/mix/3?lobby=B", { scroll: false });
    act(() => onSelectLobby(null));
    expect(router.replace).toHaveBeenLastCalledWith("/balancer/mix/3", { scroll: false });
  });

  it("takes the host to the lobby's room once their Draft is seeded", async () => {
    await render(game([lobby(), lobby({ lobby_index: 1, state: "idle" })]));

    act(() => (captured.cards?.onDraft as (index: number) => void)(1));
    expect(router.push).not.toHaveBeenCalled();
    const [index, options] = seedDraft.mutate.mock.calls[0] as [number, { onSuccess: () => void }];
    expect(index).toBe(1);
    act(() => options.onSuccess());

    expect(router.push).toHaveBeenCalledWith("/balancer/mix/3/lobby/B");
  });

  it("takes a seated player into their lobby's room while its bans run, and links it from their panel", async () => {
    shown.seat = seated(1);
    await render(game([lobby(), lobby({ lobby_index: 1, ...ON_FLOOR })]));

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/balancer/mix/3/lobby/B");
    expect(captured.seat).toMatchObject({ roomHref: "/balancer/mix/3/lobby/B" });
  });

  it("links a live match's room from the seated player's panel without moving them", async () => {
    shown.seat = seated(1);
    await render(game([lobby(), lobby({ lobby_index: 1, state: "live", live_encounter_id: 51 })]));

    expect(router.push).not.toHaveBeenCalled();
    expect(captured.seat).toMatchObject({ roomHref: "/balancer/mix/3/lobby/B" });
  });

  it("gives a seated player no room link while their lobby is only ready", async () => {
    shown.seat = seated(1);
    await render(game([lobby(), lobby({ lobby_index: 1 })]));

    expect(router.push).not.toHaveBeenCalled();
    expect(captured.seat).toMatchObject({ roomHref: null });
  });
});
