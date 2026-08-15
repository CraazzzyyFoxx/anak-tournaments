// @vitest-environment happy-dom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HoverPrefetchLink } from "./HoverPrefetchLink";

// next/link swallows `prefetch` — it never reaches the DOM — so the only way to
// observe the one thing this component exists to control is to stand in for
// Link and surface the prop. Everything else (href, class, handlers) is passed
// straight through, exactly as the real Link would.
vi.mock("next/link", () => ({
  default: ({
    prefetch,
    children,
    ...rest
  }: { prefetch?: boolean | null; children?: ReactNode } & ComponentProps<"a">) => (
    <a data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  )
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;

function render(ui: ReactNode) {
  const root = createRoot(container);
  act(() => root.render(ui));
  return () => act(() => root.unmount());
}

function anchor() {
  const el = container.querySelector("a");
  if (!el) throw new Error("no anchor rendered");
  return el;
}

function hover() {
  act(() => {
    anchor().dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })
    );
  });
}

function focus() {
  act(() => {
    anchor().dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

describe("HoverPrefetchLink", () => {
  // The whole point: on first paint the link must NOT be prefetchable, or it
  // behaves exactly like the default Link that caused the 2026-08-15 incident —
  // every link in the viewport triggering a server render nobody asked for.
  it("renders unprefetchable until the reader shows intent", () => {
    render(<HoverPrefetchLink href="/tournaments/84/bracket">Bracket</HoverPrefetchLink>);

    expect(anchor().getAttribute("data-prefetch")).toBe("false");
  });

  it("arms prefetching on hover", () => {
    render(<HoverPrefetchLink href="/tournaments/84/bracket">Bracket</HoverPrefetchLink>);
    hover();

    // `null`, not `true`: Next's default mode, which for a dynamic route stops
    // at the nearest loading boundary instead of pulling the whole page.
    expect(anchor().getAttribute("data-prefetch")).toBe("null");
  });

  // Keyboard users never fire a hover. Without this they would be the only
  // readers who always pay a cold navigation.
  it("arms prefetching on keyboard focus", () => {
    render(<HoverPrefetchLink href="/tournaments/84/teams">Teams</HoverPrefetchLink>);
    focus();

    expect(anchor().getAttribute("data-prefetch")).toBe("null");
  });

  // The nav rail passes its own handlers through this component, and Radix's
  // NavigationMenuLink asChild injects more. Swallowing them would break the
  // menu silently, so arming must compose rather than replace.
  it("still calls a caller's own hover and focus handlers", () => {
    const onMouseEnter = vi.fn();
    const onFocus = vi.fn();
    render(
      <HoverPrefetchLink href="/users" onMouseEnter={onMouseEnter} onFocus={onFocus}>
        Users
      </HoverPrefetchLink>
    );

    hover();
    focus();

    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it("passes href and presentation through untouched", () => {
    render(
      <HoverPrefetchLink href="/privacy" className="nav-item" aria-current="page">
        Privacy
      </HoverPrefetchLink>
    );

    expect(anchor().getAttribute("href")).toBe("/privacy");
    expect(anchor().getAttribute("class")).toBe("nav-item");
    expect(anchor().getAttribute("aria-current")).toBe("page");
  });
});
