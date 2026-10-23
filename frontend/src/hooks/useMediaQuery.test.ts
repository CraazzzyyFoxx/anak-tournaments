// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useMediaQuery } from "@/hooks/useMediaQuery";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUERY = "(min-width: 1024px)";
const originalMatchMedia = window.matchMedia;

let matches: boolean;
let listeners: Set<() => void>;
let container: HTMLDivElement;
let root: Root;

function Probe({ serverDefault }: { serverDefault?: boolean }) {
  return createElement("output", null, String(useMediaQuery(QUERY, serverDefault)));
}

beforeEach(() => {
  matches = false;
  listeners = new Set();
  window.matchMedia = ((media: string) => ({
    get matches() {
      return matches;
    },
    media,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener)
  })) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.matchMedia = originalMatchMedia;
});

describe("useMediaQuery", () => {
  it("reads the current match, follows change events, and unsubscribes on unmount", () => {
    matches = true;
    act(() => root.render(createElement(Probe)));
    expect(container.textContent).toBe("true");
    expect(listeners.size).toBe(1);

    matches = false;
    act(() => listeners.forEach((listener) => listener()));
    expect(container.textContent).toBe("false");

    act(() => root.unmount());
    expect(listeners.size).toBe(0);
  });

  it.each([true, false])("answers serverDefault=%s on the server", (serverDefault) => {
    matches = !serverDefault;
    expect(renderToString(createElement(Probe, { serverDefault }))).toContain(
      String(serverDefault)
    );
  });
});
