// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useRealtimeCoalescedRefetch,
  type RealtimeCoalescedRefetchOptions,
} from "@/hooks/useRealtimeCoalescedRefetch";
import { useRealtimeStore } from "@/stores/realtime.store";
import type { RealtimeEventEnvelope } from "@/types/realtime.types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** What the real `useRealtimeTopic` wires up per topic; captured so a test can
 * fire what the realtime client would. Mocked rather than driven through the
 * real websocket client -- this file tests the coalescing/reconnect
 * orchestration, not subscription plumbing (already covered elsewhere). */
type TopicSubscription = {
  onEvent: (event: RealtimeEventEnvelope) => void;
  onSubscribed?: () => void;
};
const subscriptions = new Map<string, TopicSubscription>();

vi.mock("@/hooks/useRealtimeTopic", () => ({
  useRealtimeTopic: (
    topic: string | null | undefined,
    onEvent: (event: RealtimeEventEnvelope) => void,
    _deps: unknown[],
    onSubscribed?: () => void,
  ) => {
    if (!topic) return;
    subscriptions.set(topic, { onEvent, onSubscribed });
  },
}));

function fireEvent(topic: string, data: Record<string, unknown> = {}): void {
  const subscription = subscriptions.get(topic);
  if (!subscription) throw new Error(`no subscription registered for topic "${topic}"`);
  act(() => {
    subscription.onEvent({
      event_id: 1,
      event_type: "test.event",
      schema_version: 1,
      occurred_at: "2026-08-24T00:00:00Z",
      actor_user_id: null,
      data,
    });
  });
}

function fireSubscribed(topic: string): void {
  const subscription = subscriptions.get(topic);
  act(() => subscription?.onSubscribed?.());
}

function Harness({
  topic,
  options,
}: {
  topic: string | null;
  options: RealtimeCoalescedRefetchOptions<Record<string, unknown>>;
}) {
  useRealtimeCoalescedRefetch(topic, options);
  return null;
}

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  subscriptions.clear();
  useRealtimeStore.setState({ connectionState: "idle" });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mount(
  topic: string | null,
  options: RealtimeCoalescedRefetchOptions<Record<string, unknown>>,
): void {
  root = createRoot(container);
  act(() => {
    root?.render(createElement(Harness, { topic, options }));
  });
}

describe("useRealtimeCoalescedRefetch", () => {
  it("flushes immediately with no coalescing when minDelayMs and jitterMs are both 0", () => {
    const onFlush = vi.fn();
    mount("topic:zero-delay", {
      onEvent: (_event, schedule) => schedule(),
      onFlush,
      minDelayMs: 0,
      jitterMs: 0,
    });

    fireEvent("topic:zero-delay");
    expect(onFlush).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("draws jitter once per mount and collapses a burst of events into one flush", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.4);
    const onFlush = vi.fn();
    mount("topic:jitter", {
      onEvent: (_event, schedule) => schedule(),
      onFlush,
      minDelayMs: 100,
      jitterMs: 1000,
    });
    // Drawn once while building the trailing coalescer in the mount effect --
    // not once per event below.
    expect(randomSpy).toHaveBeenCalledTimes(1);

    fireEvent("topic:jitter");
    fireEvent("topic:jitter");
    fireEvent("topic:jitter");
    expect(randomSpy).toHaveBeenCalledTimes(1);
    expect(onFlush).not.toHaveBeenCalled();

    // delay = minDelayMs + floor(random * jitterMs) = 100 + floor(0.4*1000) = 500
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(onFlush).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onFlush).toHaveBeenCalledTimes(1);

    randomSpy.mockRestore();
  });

  it("omits the leading catch-up coalescer entirely when catchUpMs is not provided", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const onFlush = vi.fn();
    mount("topic:no-catchup", {
      onEvent: () => {},
      onFlush,
      minDelayMs: 100,
    });
    setTimeoutSpy.mockClear();

    fireSubscribed("topic:no-catchup");
    expect(onFlush).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it("runs the leading catch-up coalescer on (re)subscribe when catchUpMs is provided", () => {
    const onFlush = vi.fn();
    mount("topic:catchup", {
      onEvent: () => {},
      onFlush,
      minDelayMs: 100,
      catchUpMs: 50,
    });

    fireSubscribed("topic:catchup");
    expect(onFlush).toHaveBeenCalledTimes(1);

    // Within the leading window: suppressed.
    fireSubscribed("topic:catchup");
    expect(onFlush).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(50);
    });
    fireSubscribed("topic:catchup");
    expect(onFlush).toHaveBeenCalledTimes(2);
  });

  it("schedules the reconnect safety-net flush through the same jittered trailing coalescer, never immediately", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const onFlush = vi.fn();
    mount("topic:reconnect", {
      onEvent: () => {},
      onFlush,
      minDelayMs: 250,
      jitterMs: 2500,
    });

    act(() => {
      useRealtimeStore.setState({ connectionState: "reconnecting" });
    });
    act(() => {
      useRealtimeStore.setState({ connectionState: "connected" });
    });
    // Not an immediate bypass -- must route through the delay like any other flush.
    expect(onFlush).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(onFlush).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onFlush).toHaveBeenCalledTimes(1);

    randomSpy.mockRestore();
  });

  it("does not schedule a flush for connection transitions other than reconnecting -> connected", () => {
    const onFlush = vi.fn();
    mount("topic:no-reconnect", {
      onEvent: () => {},
      onFlush,
      minDelayMs: 100,
    });

    act(() => {
      useRealtimeStore.setState({ connectionState: "connecting" });
    });
    act(() => {
      useRealtimeStore.setState({ connectionState: "connected" });
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("runs onCatchUp instead of onFlush for the leading catch-up coalescer when provided", () => {
    const onFlush = vi.fn();
    const onCatchUp = vi.fn();
    mount("topic:on-catchup", {
      onEvent: () => {},
      onFlush,
      onCatchUp,
      minDelayMs: 100,
      catchUpMs: 50,
    });

    fireSubscribed("topic:on-catchup");
    expect(onCatchUp).toHaveBeenCalledTimes(1);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("falls back to onFlush for catch-up when onCatchUp is omitted", () => {
    const onFlush = vi.fn();
    mount("topic:catchup-fallback", {
      onEvent: () => {},
      onFlush,
      minDelayMs: 100,
      catchUpMs: 50,
    });

    fireSubscribed("topic:catchup-fallback");
    expect(onFlush).toHaveBeenCalledTimes(1);
  });
});
