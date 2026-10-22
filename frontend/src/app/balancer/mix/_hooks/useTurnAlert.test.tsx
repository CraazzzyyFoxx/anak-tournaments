// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTurnAlert } from "./useTurnAlert";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ active }: { active: boolean }) {
  useTurnAlert(active, "Your ban");
  return null;
}

async function mount(active: boolean) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<Probe active={active} />));
  return { rerender: (next: boolean) => act(async () => root.render(<Probe active={next} />)) };
}

afterEach(() => {
  document.title = "";
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
});
