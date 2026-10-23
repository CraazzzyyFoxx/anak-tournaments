import type { Page } from "@playwright/test";
import { type Api, poll } from "./api";
import { seedBracket, type BracketSeed } from "./flows";
import { uniq } from "./seed";
import type { TestUser } from "./users";

export type Kind = "map" | "hero";
export type Ruleset = Record<string, unknown>;
export type CatalogItem = { id: number; name: string };
/** One side of the encounter: the tournament team, its participation (`EncounterTeam.id`) and its captain. */
export type Seat = { teamId: number; participationId: number; name: string; captain: TestUser };
export type Room = BracketSeed & { encounterId: number; a: Seat; b: Seat; maps: CatalogItem[]; heroes: CatalogItem[] };
export type PoolEntry = { item_id: number; status: string; picked_by_team_id: number | null; action_index: number | null };
export type Game = { id: number; position: number; map_id: number | null; state: string; result_version: number };
export type Submission = {
  step_index: number;
  encounter_team_id: number;
  attempt: number;
  state: string;
  items: { item_id: number; target_player_id: number | null }[];
};
export type PickBanState = {
  session: { id: number; status: string; first_team_id: number; awaiting_choice: boolean; pending_chooser_team_id: number | null; paused_at: string | null } | null;
  reason?: string;
  readiness: Record<string, boolean>;
  viewer_team_id: number | null;
  viewer_can_act: boolean;
  current_step_index: number | null;
  current_round: number | null;
  acting_team_ids: number[];
  expected_action: string | null;
  step_deadline: string | null;
  is_complete: boolean;
  pool: PoolEntry[];
  games: Game[];
  sequence: { index: number; round: number | null; action: string; actors: (number | null)[]; blind: boolean }[];
  step_progress: Record<string, { locked: boolean; filled: number }> | null;
  submissions: Submission[];
  dispute: { available: boolean; step_index: number | null; attempts_used: number; max: number };
  undo: { requested_by_team_id: number | null; item_ids: number[] };
};

// A step's clock long enough that a cold `next dev` compile never lets it time
// out (and random-fill) under a test that is still loading the room.
const TIMER = 900;

/** The `map_bracket` preset: the bracket generator derives the steps from best-of and pool size. */
export function mapRuleset(timer = TIMER): Ruleset {
  return {
    version: 2,
    timer_seconds: timer,
    on_timeout: "random_fill",
    phases: [{ id: "main", name: null, when: {}, pool_filter: {}, generator: "bracket", steps: [] }],
  };
}

type Step = { id: string; action: "ban" | "pick" | "protect"; actors: "first" | "second" | "both"; count?: number; blind?: boolean; dispute?: number };

/** A custom hero ruleset; `dispute` > 0 enables captain disputes with that attempt budget. */
export function heroRuleset(steps: Step[], timer = TIMER): Ruleset {
  return {
    version: 2,
    timer_seconds: timer,
    on_timeout: "random_fill",
    phases: [
      {
        id: "main",
        name: null,
        when: {},
        pool_filter: {},
        generator: null,
        steps: steps.map((s) => ({
          id: s.id,
          action: s.action,
          actors: s.actors,
          count: s.count ?? 1,
          min: null,
          blind: s.blind ?? false,
          target: null,
          lifetime: 1,
          timer_seconds: null,
          on_timeout: null,
          dispute: { enabled: (s.dispute ?? 0) > 0, max: s.dispute ?? 0 },
          eligible: {},
          constraints: [],
        })),
      },
    ],
  };
}

/** `hero_classic`: one open ban per side per map. */
export const HERO_CLASSIC: Step[] = [
  { id: "ban1", action: "ban", actors: "first" },
  { id: "ban2", action: "ban", actors: "second" },
];

/**
 * Fresh overwatch catalog rows (the e2e DB starts with an empty catalog, and
 * a map needs its mode as parent). Names are unique so parallel specs never
 * collide on the global catalog.
 */
export async function seedCatalog(admin: Api, maps = 5, heroes = 6): Promise<{ maps: CatalogItem[]; heroes: CatalogItem[] }> {
  const tag = uniq("E2E");
  const mode = await admin.post<CatalogItem>("/api/v1/admin/catalog/overwatch/mode", { name: `${tag} Control` });
  const mapRows: CatalogItem[] = [];
  for (let i = 1; i <= maps; i++) {
    mapRows.push(await admin.post<CatalogItem>("/api/v1/admin/catalog/overwatch/map", { name: `${tag} Map ${i}`, parent_id: mode.id }));
  }
  const classes = ["tank", "damage", "support"];
  const heroRows: CatalogItem[] = [];
  for (let i = 1; i <= heroes; i++) {
    heroRows.push(
      await admin.post<CatalogItem>("/api/v1/admin/catalog/overwatch/character", {
        name: `${tag} Hero ${i}`,
        attrs: { class: classes[(i - 1) % classes.length] },
      })
    );
  }
  return { maps: mapRows, heroes: heroRows };
}

export async function upsertConfig(
  admin: Api,
  tournamentId: number,
  kind: Kind,
  ruleset: Ruleset,
  itemIds: number[],
  extra: Record<string, unknown> = {}
) {
  return admin.put(`/api/v1/admin/tournaments/${tournamentId}/pick-ban-configs`, { kind, mode: "pool", ruleset, item_ids: itemIds, ...extra });
}

/**
 * A LIVE overwatch tournament with a published single-elimination bracket of
 * two teams captained by `captainA` (top seed) / `captainB`, map + hero
 * pick-ban configured over a fresh catalog. `map`/`hero: null` leaves that
 * kind unconfigured.
 */
export async function seedRoom(
  admin: Api,
  captainA: TestUser,
  captainB: TestUser,
  opts: { map?: Ruleset | null; hero?: Ruleset | null; heroRotation?: string; bestOf?: number } = {}
): Promise<Room> {
  const seed = await seedBracket(admin, { captains: [captainA, captainB], bestOf: opts.bestOf });
  const encounter = seed.encounters[0];
  const catalog = await seedCatalog(admin);
  if (opts.map !== null) await upsertConfig(admin, seed.tournament.id, "map", opts.map ?? mapRuleset(), catalog.maps.map((m) => m.id));
  if (opts.hero !== null) {
    await upsertConfig(
      admin,
      seed.tournament.id,
      "hero",
      opts.hero ?? heroRuleset(HERO_CLASSIC),
      catalog.heroes.map((h) => h.id),
      opts.heroRotation ? { first_ban_rotation: opts.heroRotation } : {}
    );
  }
  const seat = (index: 0 | 1): Seat => {
    const team = seed.teams[index];
    const participation = encounter.teams.find((t) => t.team_id === team.id);
    if (!participation || !team.captain) throw new Error(`${team.name} is not seated in encounter ${encounter.id}`);
    return { teamId: team.id, participationId: participation.id, name: team.name, captain: team.captain };
  };
  return { ...seed, ...catalog, encounterId: encounter.id, a: seat(0), b: seat(1) };
}

/** The public pre-game room of the seeded encounter. */
export function roomUrl(room: Room): string {
  return `/tournaments/${room.tournament.slug}/pregame/${room.encounterId}`;
}

export function getState(api: Api, encounterId: number, kind: Kind) {
  return api.get<PickBanState>(`/api/v1/encounters/${encounterId}/pick-ban/${kind}/state`);
}

export function waitForSession(api: Api, encounterId: number, kind: Kind) {
  return poll(
    async () => {
      const state = await getState(api, encounterId, kind);
      return state.session?.status === "active" ? state : undefined;
    },
    `${kind} pick-ban session to open`,
    // The post-commit reconcile opens it within seconds; the one-minute backstop sweep covers a lost trigger.
    75_000
  );
}

/** Both captains confirm, then waits for the session the reconciler opens asynchronously after the second one. */
export async function readyBoth(room: Room, kind: Kind = "map"): Promise<PickBanState> {
  await room.a.captain.api.post(`/api/v1/encounters/${room.encounterId}/ready`);
  await room.b.captain.api.post(`/api/v1/encounters/${room.encounterId}/ready`);
  return waitForSession(room.a.captain.api, room.encounterId, kind);
}

export function act(user: TestUser, encounterId: number, kind: Kind, item_id: number, action: string) {
  return user.api.post<PickBanState>(`/api/v1/encounters/${encounterId}/pick-ban/${kind}/act`, { item_id, action });
}

/** The side whose turn it is (open steps have one actor), read from the room state. */
export function actingSeat(room: Room, state: PickBanState): Seat {
  const id = state.acting_team_ids[0];
  if (id === undefined) throw new Error(`no side is acting at step ${state.current_step_index}`);
  return room.a.participationId === id ? room.a : room.b;
}

/** Topics of the realtime event frames this page receives over the gateway WebSocket. */
export function recordRealtimeTopics(page: Page): string[] {
  const topics: string[] = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") return;
      try {
        const frame = JSON.parse(payload) as { op?: string; topic?: string };
        if (frame.op === "event" && frame.topic) topics.push(frame.topic);
      } catch {
        // not a JSON frame
      }
    });
  });
  return topics;
}
