// @vitest-environment happy-dom
//
// `useRealtimePatchedQuery` has no consumer yet (Task 12 of the realtime
// shared-library plan) — this is its standalone contract test. It composes
// `useRealtimeTopic` and `applyResourcePatch`, both mocked here so the test
// can fire exactly what the hub would push and control the patch outcome.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRealtimePatchedQuery } from "@/hooks/useRealtimePatchedQuery";
import { useRealtimeStore } from "@/stores/realtime.store";
import type { RealtimeEventEnvelope } from "@/types/realtime.types";

const applyResourcePatch = vi.fn();
vi.mock("@/services/realtime-patch", () => ({
  applyResourcePatch: (...args: unknown[]) => applyResourcePatch(...args)
}));

/** Topic -> the hook's handler, so a test can fire what the hub would push. */
const realtimeHandlers = new Map<string, (event: RealtimeEventEnvelope) => void>();
vi.mock("@/hooks/useRealtimeTopic", () => ({
  useRealtimeTopic: (
    topic: string | null | undefined,
    onEvent: (event: RealtimeEventEnvelope) => void
  ) => {
    if (topic) realtimeHandlers.set(topic, onEvent);
  }
}));

const TOPIC = "tournament:1:draft";
const RESOURCE = "draft.board";
const QUERY_KEY: QueryKey = ["draft", "board", 1];

function fakeEvent(overrides: Partial<RealtimeEventEnvelope> = {}): RealtimeEventEnvelope {
  return {
    event_id: 1,
    event_type: "draft.pick",
    schema_version: 1,
    occurred_at: new Date().toISOString(),
    actor_user_id: null,
    data: {},
    ...overrides
  };
}

function Harness({ queryKey }: { queryKey: QueryKey }) {
  useRealtimePatchedQuery(TOPIC, { resource: RESOURCE, queryKey });
  return null;
}

let container: HTMLElement;
let root: Root;
let client: QueryClient;

beforeEach(() => {
  applyResourcePatch.mockReset();
  realtimeHandlers.clear();
  useRealtimeStore.setState({ connectionState: "idle" });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(queryKey: QueryKey = QUERY_KEY): Promise<void> {
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client }, createElement(Harness, { queryKey }))
    );
  });
}

function fire(event: RealtimeEventEnvelope = fakeEvent()): void {
  const handler = realtimeHandlers.get(TOPIC);
  expect(handler).toBeDefined();
  act(() => handler!(event));
}

describe("useRealtimePatchedQuery", () => {
  it("patches the cache without invalidating when the outcome is applied", async () => {
    client.setQueryData(QUERY_KEY, { some: "snapshot" });
    applyResourcePatch.mockReturnValue("applied");
    const invalidateQueries = vi.spyOn(client, "invalidateQueries");
    await mount();

    fire();

    expect(applyResourcePatch).toHaveBeenCalledWith(client, {
      resource: RESOURCE,
      queryKey: QUERY_KEY,
      event: expect.objectContaining({ event_id: 1 })
    });
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it.each(["uncached", "unregistered"] as const)(
    "falls back to invalidateQueries when the outcome is %s",
    async (outcome) => {
      applyResourcePatch.mockReturnValue(outcome);
      const invalidateQueries = vi.spyOn(client, "invalidateQueries");
      await mount();

      fire();

      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: QUERY_KEY });
    }
  );

  it("invalidates unconditionally on a reconnecting -> connected transition", async () => {
    applyResourcePatch.mockReturnValue("applied");
    const invalidateQueries = vi.spyOn(client, "invalidateQueries");
    await mount();

    act(() => useRealtimeStore.getState().setConnectionState("reconnecting"));
    expect(invalidateQueries).not.toHaveBeenCalled();

    act(() => useRealtimeStore.getState().setConnectionState("connected"));

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: QUERY_KEY });
  });

  it("does not invalidate on transitions other than reconnecting -> connected", async () => {
    applyResourcePatch.mockReturnValue("applied");
    const invalidateQueries = vi.spyOn(client, "invalidateQueries");
    await mount();

    act(() => useRealtimeStore.getState().setConnectionState("connecting"));
    act(() => useRealtimeStore.getState().setConnectionState("connected"));

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
