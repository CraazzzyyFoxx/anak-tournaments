// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDraftBoardQuery, useDraftPickOptionsQuery, useDraftRealtime } from "@/hooks/useDraftData";
import { draftChatRoom, roomChatQueryKey } from "@/lib/realtime/chat-rooms";
import { tournamentQueryKeys } from "@/lib/tournament/query-keys";
import { useRealtimeStore } from "@/stores/realtime.store";
import type { DraftBoard, DraftEventData } from "@/types/draft.types";
import type { RealtimeEventEnvelope } from "@/types/realtime.types";

const getSessionBoard = vi.fn();
const getPickOptions = vi.fn();
vi.mock("@/services/draft.service", () => ({
  default: {
    getSessionBoard: (...args: unknown[]) => getSessionBoard(...args),
    getPickOptions: (...args: unknown[]) => getPickOptions(...args)
  }
}));

// The socket itself is the seam: the real `useRealtimeTopic` subscribes through it, so a re-subscription shows here.
let handler: ((event: RealtimeEventEnvelope<DraftEventData>) => void) | undefined;
let subscribedTopic: string | null = null;
const subscribe = vi.fn((topic: string, onEvent: (event: RealtimeEventEnvelope<DraftEventData>) => void) => {
  subscribedTopic = topic;
  handler = onEvent;
  return () => {};
});
vi.mock("@/services/realtime.service", () => ({
  realtimeClient: {
    resubscribe: vi.fn(),
    subscribe: (topic: string, onEvent: (event: RealtimeEventEnvelope<DraftEventData>) => void) => subscribe(topic, onEvent)
  }
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SESSION_ID = 1;

/** Team 10's captain is on the clock with pick 1, the draft's last. Only what the room reads. */
function board(): DraftBoard {
  const onClock = { id: 1, draft_team_id: 10, status: "on_clock", version: 0 };
  return {
    session: { id: 1, status: "live", current_pick_id: 1 },
    teams: [{ id: 10 }],
    picks: [onClock],
    players: [{ id: 50, status: "available", drafted_by_team_id: null }],
    current_pick: onClock,
    last_event_id: 0
  } as unknown as DraftBoard;
}

let eventId = 0;
function event(event_type: string, data: Partial<DraftEventData>): RealtimeEventEnvelope<DraftEventData> {
  eventId += 1;
  return {
    event_id: eventId,
    event_type,
    schema_version: 1,
    occurred_at: new Date().toISOString(),
    actor_user_id: null,
    data: { session_id: 1, ...data }
  };
}

/** The captain's seat of the room: the board, its realtime feed, and the options of the pick on the clock. */
function Harness() {
  const current = useDraftBoardQuery(SESSION_ID).data ?? null;
  const { presence } = useDraftRealtime(tournamentQueryKeys.draftSessionBoard(SESSION_ID), current);
  useDraftPickOptionsQuery(current?.current_pick?.id ?? null, current?.session.status === "live");
  return <output>{presence.anonymous_viewer_count}</output>;
}

function mountHarness() {
  root.render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  );
}

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

async function settle() {
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
}

async function fire(next: RealtimeEventEnvelope<DraftEventData>) {
  act(() => handler!(next));
  await settle();
}

beforeEach(async () => {
  vi.clearAllMocks();
  handler = undefined;
  subscribedTopic = null;
  useRealtimeStore.setState({ connectionState: "connected" });
  getSessionBoard.mockResolvedValue(board());
  getPickOptions.mockImplementation(async (pickId: number) => ({ pick_id: pickId, pick_version: 0, options: [] }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => mountHarness());
  await settle();
  expect(getPickOptions.mock.calls).toEqual([[1]]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useDraftRealtime pick options", () => {
  it("never re-reads the options of a pick the event resolved", async () => {
    // The server answers 409 for anything but the current pick, and the room
    // still holds pick 1's options query until it re-renders off the patch.
    await fire(event("draft.pick_made", { pick_id: 1, draft_team_id: 10, picked_player_id: 50, pick_version: 1 }));
    await fire(event("draft.completed", { status: "completed" }));

    expect(getPickOptions.mock.calls).toEqual([[1]]);
  });

  it("re-reads the options of the pick still on the clock", async () => {
    await fire(event("draft.clock_extended", { pick_id: 1, clock_expires_at: "2026-10-22T00:01:00Z", pick_version: 1 }));

    expect(getPickOptions.mock.calls).toEqual([[1], [1]]);
  });
});

describe("useDraftRealtime topic", () => {
  it("follows the session's own board topic, whoever owns the draft", () => {
    expect(subscribedTopic).toBe("draft:1:board");
  });

  it("stays on one subscription across a presence update and a re-render", async () => {
    await fire(event("draft.presence", { user_ids: [], anonymous_viewer_count: 4 }));
    await act(async () => mountHarness());
    await settle();

    expect(container.textContent).toBe("4");
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});

describe("useDraftRealtime chat", () => {
  it("re-reads who the viewer is in the room's chat when the seats or captains change", async () => {
    // A replaced captain arrives as `session_updated`: the new captain's envelope still says spectator (no write
    // controls) and the old one's still says captain, until the envelope is read again.
    const chatKey = roomChatQueryKey(draftChatRoom(SESSION_ID));
    client.setQueryData(chatKey, { messages: [] });

    await fire(event("draft.session_updated", { status: "live" }));

    expect(client.getQueryState(chatKey)?.isInvalidated).toBe(true);
  });
});
