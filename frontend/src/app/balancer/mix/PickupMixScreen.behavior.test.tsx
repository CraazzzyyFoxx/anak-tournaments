// @vitest-environment happy-dom
//
// A lobby has a chat while its match is on (spec §7.5 amended): the encounter's room chat, docked in the lobby's
// own room and in the one-lobby overview that embeds it. Who may read it is the chat's own verdict -- a spectator's
// 403 leaves no trace of it. The panels around it are not what this pins, so they render as stubs.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/messages/en.json";
import type * as CustomGameModule from "@/services/custom-game.service";
import type { CustomGame, CustomGameLobby } from "@/services/custom-game.service";

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

const shown = vi.hoisted(() => ({ game: null as CustomGame | null }));
const getEnvelope = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ gameId: "3" }),
  useRouter: () => ({ push: vi.fn() }),
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
// Every query and write the screen reads off the hook; a write is never fired here.
vi.mock("@/app/balancer/mix/usePickupMix", () => ({
  usePickupMix: () => {
    const query = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });
    const reads: Record<string, unknown> = {
      selectedGameId: 3,
      gamesQuery: query([]),
      gameQuery: query(shown.game),
      matchesQuery: query([]),
      rotationQuery: query([]),
      mySeatQuery: query(undefined),
      myQueuePosition: null,
      voiceOptionsQuery: query(undefined),
    };
    const write = { mutate: vi.fn(), mutateAsync: vi.fn(), reset: vi.fn(), isPending: false };
    return new Proxy(reads, { get: (target, key: string) => (key in target ? target[key] : write) });
  },
}));
vi.mock("@/app/balancer/mix/PickupTeamsPanel", () => ({ PickupTeamsPanel: () => <div>teams</div> }));
vi.mock("@/app/balancer/mix/PickupLobbyPanel", () => ({ PickupLobbyPanel: () => null }));
vi.mock("@/app/balancer/mix/PickupMySeatPanel", () => ({ PickupMySeatPanel: () => null }));
vi.mock("@/app/balancer/mix/PickupVoicePanel", () => ({ PickupVoicePanel: () => null }));
vi.mock("@/app/balancer/mix/PickupMixHeader", () => ({ PickupMixHeader: () => null }));
vi.mock("@/app/balancer/mix/PickupLobbyCards", () => ({ PickupLobbyCards: () => null }));
vi.mock("@/app/balancer/mix/PickupLeaderboard", () => ({ PickupLeaderboard: () => null }));
vi.mock("@/hooks/useCatalogEntities", () => ({ useCatalogEntities: () => ({ data: [] }) }));
vi.mock("@/hooks/useDisciplineMetadata", () => ({ useDisciplineMetadata: () => ({ data: undefined }) }));
vi.mock("@/hooks/useCurrentWorkspace", () => ({ useDivisionGrid: () => ({ tiers: [] }) }));
vi.mock("@/hooks/useEntityWorkspace", () => ({ useEntityWorkspace: () => {} }));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canAccessPermission: () => false, isSuperuser: false, isWorkspaceAdmin: () => false }),
}));
vi.mock("@/hooks/useAuthProfile", () => ({
  useAuthProfile: () => ({ status: "authenticated", user: { id: 42, linkedPlayers: [] } }),
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

const ON_FLOOR = { state: "pregame", live_encounter_id: 50, live_started_at: "2026-10-22T20:00:00Z" } as const;
/** A player of the match reading its room. */
const PLAYER_ENVELOPE = {
  messages: [],
  settings: { spectators_can_read: false },
  viewer: { role: "player", can_write: true, can_moderate: false, muted_until: null },
  mutes: [],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getEnvelope.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(current: CustomGame, roomLobby: number | null) {
  shown.game = current;
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
          <PickupMixScreen roomLobby={roomLobby} />
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

const chatDocked = () => document.body.textContent?.includes(en.chat.title) ?? false;

describe("the mix's match chat", () => {
  it("docks in a lobby's own room while its match is on", async () => {
    getEnvelope.mockResolvedValue(PLAYER_ENVELOPE);
    await render(game([lobby(), lobby({ lobby_index: 1, ...ON_FLOOR })]), 1);

    expect(container.textContent).toContain("teams");
    expect(chatDocked()).toBe(true);
    expect(getEnvelope.mock.calls[0]?.[0]).toMatchObject({ topic: "encounter:50:chat" });
  });

  it("docks in the overview of a one-lobby mix, which embeds its room", async () => {
    getEnvelope.mockResolvedValue(PLAYER_ENVELOPE);
    await render(game([lobby(ON_FLOOR)]), null);

    expect(chatDocked()).toBe(true);
  });

  it("shows a spectator no match chat", async () => {
    // `getEnvelope` answers a 403 with null.
    getEnvelope.mockResolvedValue(null);
    await render(game([lobby(), lobby({ lobby_index: 1, ...ON_FLOOR })]), 1);

    expect(container.textContent).toContain("teams");
    expect(chatDocked()).toBe(false);
  });

  it("has no chat while the lobby has no match on", async () => {
    getEnvelope.mockResolvedValue(PLAYER_ENVELOPE);
    await render(game([lobby(), lobby({ lobby_index: 1 })]), 1);

    expect(chatDocked()).toBe(false);
    expect(getEnvelope).not.toHaveBeenCalled();
  });
});
