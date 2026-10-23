// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTurnAlert } from "./useTurnAlert";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ active, turn = "1:0:1" }: { active: boolean; turn?: string }) {
  useTurnAlert(active, "Your ban", turn);
  return null;
}

/**
 * Web Audio as a browser hands it out before any user gesture: suspended, so its tone never plays and never ends.
 * It records whether the alert closed it.
 */
class SuspendedAudioContext {
  static made: SuspendedAudioContext[] = [];
  state = "suspended";
  currentTime = 0;
  destination = {};
  closed = 0;
  constructor() {
    SuspendedAudioContext.made.push(this);
  }
  createOscillator() {
    return { frequency: { value: 0 }, connect: (node: unknown) => node, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { value: 0 }, connect: (node: unknown) => node };
  }
  close() {
    this.closed += 1;
    this.state = "closed";
    return Promise.resolve();
  }
}

async function mount(active: boolean) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<Probe active={active} />));
  return {
    rerender: (next: boolean, turn?: string) => act(async () => root.render(<Probe active={next} turn={turn} />)),
    unmount: () => act(async () => root.unmount()),
  };
}

beforeEach(() => {
  SuspendedAudioContext.made = [];
  vi.stubGlobal("AudioContext", SuspendedAudioContext);
});

afterEach(() => {
  document.title = "";
  vi.unstubAllGlobals();
});

describe("useTurnAlert", () => {
  it("names the turn in the tab title and buzzes while it is the viewer's", async () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    document.title = "Mix";
    const probe = await mount(false);
    expect(document.title).toBe("Mix");

    await probe.rerender(true);
    expect(document.title).toBe("Your ban");
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("gives the title back when the turn passes", async () => {
    document.title = "Mix";
    const probe = await mount(true);
    await probe.rerender(false);
    expect(document.title).toBe("Mix");
  });

  it("releases the sound and stops the buzz when the turn passes", async () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    const probe = await mount(true);
    expect(SuspendedAudioContext.made.map((context) => context.closed)).toEqual([0]);

    await probe.rerender(false);
    expect(SuspendedAudioContext.made.map((context) => context.closed)).toEqual([1]);
    expect(vibrate).toHaveBeenLastCalledWith(0);
  });

  it("releases the sound and stops the buzz when the board goes mid-turn", async () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    document.title = "Mix";
    const probe = await mount(true);

    await probe.unmount();
    expect(SuspendedAudioContext.made.map((context) => context.closed)).toEqual([1]);
    expect(vibrate).toHaveBeenLastCalledWith(0);
    expect(document.title).toBe("Mix");
  });

  it("alerts again on the viewer's next turn right after this one, and still gives the title back", async () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    document.title = "Mix";
    const probe = await mount(true);

    await probe.rerender(true, "1:1:1");
    expect(document.title).toBe("Your ban");
    expect(vibrate.mock.calls.filter(([ms]) => ms === 200)).toHaveLength(2);
    expect(SuspendedAudioContext.made.map((context) => context.closed)).toEqual([1, 0]);

    await probe.rerender(false, "1:1:1");
    expect(document.title).toBe("Mix");
  });
});
